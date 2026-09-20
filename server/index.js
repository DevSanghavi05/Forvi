import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { scrape } from './engine/scrape.js';
import { runRules } from './engine/rules.js';
import { scoreFindings } from './engine/score.js';
import { judge } from './engine/humanize.js';
import { patchSite } from './engine/patch.js';
import { buildFixPrompt } from './engine/fixprompt.js';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  APP_BASE_URL = 'http://localhost:3001',
  PORT = 8787,
} = process.env;

const GOOGLE_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
if (!GOOGLE_ENABLED) {
  console.warn(
    '\n[forvi] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google sign-in is disabled ' +
      '(guest mode + scanning still work). Add them to .env to enable it.\n'
  );
}

// The public origin of THIS request — so OAuth works on localhost AND on the
// deployed domain with no hardcoded URL. Honors reverse-proxy headers (the app
// is deployed as one service behind a host's proxy). Falls back to APP_BASE_URL.
function requestOrigin(req) {
  const xfHost = req.headers['x-forwarded-host'];
  const host = (xfHost || req.headers.host || '').toString().split(',')[0].trim();
  if (!host) return APP_BASE_URL;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0].trim();
  return `${proto}://${host}`;
}
// Google redirects the browser to this exact URL after consent — it must be
// listed under "Authorized redirect URIs" for the OAuth client in Google Cloud
// Console (for every origin you use: http://localhost:3001 and your live domain).
function oauthRedirectUri(req) {
  return `${requestOrigin(req)}/api/auth/callback/google`;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// Stateless signed-cookie sessions. Required for serverless (no shared memory or
// writable disk across function invocations) and it makes "stay signed in"
// survive restarts/deploys for free. The cookie is `<base64url(payload)>.<hmac>`;
// we verify the HMAC + expiry on every request — no server-side store.
const SESSION_SECRET = process.env.SESSION_SECRET || GOOGLE_CLIENT_SECRET || 'forvi-dev-secret-change-me';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function signSession(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

// Return the user for a signed session cookie, or null if missing/tampered/expired.
function sessionUser(sid) {
  if (!sid || typeof sid !== 'string' || !sid.includes('.')) return null;
  const [payload, sig] = sid.split('.');
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!sig || sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || !data.u || !data.exp || Date.now() > data.exp) return null;
    return data.u;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAge) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  // Add `Secure` when served over https (deployed) — harmless to omit on http localhost.
  if (APP_BASE_URL.startsWith('https://') || process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Step 1 — kick off the OAuth flow: set a CSRF state cookie and bounce the
// browser to Google's consent screen.
app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_ENABLED) {
    return res.redirect(`${requestOrigin(req)}/?auth=disabled`);
  }
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'oauth_state', state, 600);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: oauthRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2 — Google sends the browser back here with a one-time code. Verify
// state, exchange the code for tokens (this is where the client secret is
// used, server-side only), read the profile, and open a session.
app.get('/api/auth/callback/google', async (req, res) => {
  const fail = (reason) => {
    console.error('[forvi] auth callback failed:', reason);
    res.redirect(`${requestOrigin(req)}/?auth=error`);
  };

  try {
    const { code, state } = req.query;
    const cookies = parseCookies(req);

    if (!code || !state || state !== cookies.oauth_state) {
      return fail('missing code or state mismatch');
    }
    clearCookie(res, 'oauth_state');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: oauthRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return fail(`token exchange ${tokenRes.status}: ${await tokenRes.text()}`);
    const tokens = await tokenRes.json();

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userRes.ok) return fail(`userinfo ${userRes.status}: ${await userRes.text()}`);
    const profile = await userRes.json();

    const user = {
      id: profile.sub,
      email: profile.email,
      name: profile.name || profile.email,
      picture: profile.picture || null,
    };

    setCookie(res, 'sid', signSession(user), 60 * 60 * 24 * 30); // 30 days — stay signed in

    res.redirect(`${requestOrigin(req)}/?auth=success`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
});

// The frontend calls this on load to learn who (if anyone) is signed in.
app.get('/api/auth/me', (req, res) => {
  const { sid } = parseCookies(req);
  const user = sessionUser(sid);
  if (!user) return res.status(401).json({ user: null });
  res.json({ user });
});

app.post('/api/auth/logout', (_req, res) => {
  clearCookie(res, 'sid');
  res.json({ ok: true });
});

// ===========================================================================
// Forvi engine — scan + humanize
// ===========================================================================

// Server-held Anthropic key: warn loudly at boot but don't exit — the
// deterministic scan still works without it (Claude judgment/rewrite degrade
// gracefully), and auth is unaffected.
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '\n[forvi] ANTHROPIC_API_KEY is not set. Deterministic scanning still works, ' +
      'but AI judgment and humanizing are disabled until you add it to server .env.\n'
  );
}

// Identify the requester for rate limiting: the signed-in user, or the client IP
// for guests.
function requesterId(req) {
  const { sid } = parseCookies(req);
  const user = sessionUser(sid);
  if (user) return { key: `u:${user.id}`, authed: true };
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
  return { key: `ip:${ip}`, authed: false };
}

// Fixed-window rate limiter. Signed-in users get a higher ceiling than guests.
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_AUTHED = 20;
const RATE_LIMIT_GUEST = 5;
const rateWindows = new Map(); // key -> { count, resetAt }

function checkRate(req) {
  const { key, authed } = requesterId(req);
  const limit = authed ? RATE_LIMIT_AUTHED : RATE_LIMIT_GUEST;
  const now = Date.now();
  let win = rateWindows.get(key);
  if (!win || now >= win.resetAt) {
    win = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateWindows.set(key, win);
  }
  if (win.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((win.resetAt - now) / 1000), limit };
  }
  win.count += 1;
  return { ok: true, remaining: limit - win.count, limit };
}

// Short-lived store of scan results so /humanize can reuse the scrape without
// re-rendering the page. Pruned lazily.
const SCAN_TTL_MS = 60 * 60 * 1000;
const scans = new Map(); // id -> { createdAt, ownerKey, scrape, findings, report }

function pruneScans() {
  const cutoff = Date.now() - SCAN_TTL_MS;
  for (const [id, entry] of scans) if (entry.createdAt < cutoff) scans.delete(id);
}

// POST /api/scan { url } -> deterministic + AI findings, score, screenshot
app.post('/api/scan', async (req, res) => {
  const rate = checkRate(req);
  if (!rate.ok) {
    res.set('Retry-After', String(rate.retryAfter));
    return res.status(429).json({
      error: `Scan limit reached (${rate.limit}/hour). Try again in ${Math.ceil(rate.retryAfter / 60)} min, or sign in for a higher limit.`,
    });
  }

  const url = (req.body && req.body.url ? String(req.body.url) : '').trim();
  if (!url) return res.status(400).json({ error: 'Provide a url to scan.' });

  try {
    const site = await scrape(url);
    const ruleFindings = runRules(site);

    // AI judgment is best-effort — a missing key or transient error must not
    // fail the whole scan.
    let aiFindings = [];
    let aiJudgment = true;
    try {
      aiFindings = await judge(site, ruleFindings);
    } catch (err) {
      aiJudgment = false;
      if (err.code !== 'NO_API_KEY') console.error('[forvi] judge failed:', err.message);
    }

    // Merge, de-duplicating by id (rules win on count for mechanical tells).
    const byId = new Map();
    for (const f of [...ruleFindings, ...aiFindings]) {
      if (!byId.has(f.id)) byId.set(f.id, f);
    }
    const findings = [...byId.values()].sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity) || (b.count || 0) - (a.count || 0)
    );

    const report = scoreFindings(findings);
    const id = crypto.randomBytes(9).toString('hex');
    pruneScans();
    scans.set(id, {
      createdAt: Date.now(),
      ownerKey: requesterId(req).key,
      scrape: site,
      findings,
      report,
    });

    // The deliverable: a ready-to-paste prompt for Claude built from this site's
    // exact tells + the universal de-AI rules. Included in the scan response so
    // the "Copy fix prompt" button copies synchronously (no extra round-trip).
    const fixPrompt = buildFixPrompt({
      url: site.url,
      findings,
      score: report.score,
      verdict: report.verdict,
      totalInstances: report.totalInstances,
    });

    res.json({
      scanId: id,
      url: site.url,
      title: site.title,
      screenshot: site.screenshot,
      // The self-contained original page (fetched HTML + inlined CSS + <base>).
      // The scraper no longer runs a browser, so there's no screenshot — the
      // dashboard renders this in the "Before" iframe instead, which also lines
      // up pixel-for-pixel with the humanized "After" iframe.
      originalHtml: site.snapshot,
      aiJudgment,
      fixPrompt,
      ...report,
      findings: findings.map((f) => ({
        id: f.id,
        label: f.label,
        category: f.category,
        severity: f.severity,
        count: f.count,
        why: f.why,
        fix: f.fix,
        samples: f.samples,
        source: f.source,
      })),
    });
  } catch (err) {
    console.error('[forvi] scan failed:', err.message);
    res.status(422).json({ error: err.message || 'Could not scan that URL.' });
  }
});

function severityRank(s) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s] || 0;
}

// POST /api/humanize { scanId } -> rewritten, tell-free HTML document
app.post('/api/humanize', async (req, res) => {
  const rate = checkRate(req);
  if (!rate.ok) {
    res.set('Retry-After', String(rate.retryAfter));
    return res.status(429).json({
      error: `Rate limit reached (${rate.limit}/hour). Try again in ${Math.ceil(rate.retryAfter / 60)} min.`,
    });
  }

  const scanId = req.body && req.body.scanId ? String(req.body.scanId) : '';
  const url = req.body && req.body.url ? String(req.body.url) : '';

  try {
    // Use the cached scan when available (warm local process); otherwise
    // re-scrape from the url so this works statelessly on serverless (where the
    // in-memory scan store isn't shared across function invocations).
    let entry = scanId ? scans.get(scanId) : null;
    if (!entry) {
      if (!url) return res.status(400).json({ error: 'Provide the url to humanize.' });
      const site = await scrape(url);
      const ruleFindings = runRules(site);
      let aiFindings = [];
      try {
        aiFindings = await judge(site, ruleFindings);
      } catch (err) {
        if (err.code !== 'NO_API_KEY') console.error('[forvi] judge failed:', err.message);
      }
      const byId = new Map();
      for (const f of [...ruleFindings, ...aiFindings]) if (!byId.has(f.id)) byId.set(f.id, f);
      entry = { scrape: site, findings: [...byId.values()] };
    }
    const result = await patchSite(entry.scrape, entry.findings);
    if (!result.html) return res.status(502).json({ error: 'The humanized page came back empty. Try again.' });
    res.json({ scanId, html: result.html, changes: result.changes, fixedCount: result.fixedCount });
  } catch (err) {
    console.error('[forvi] humanize failed:', err.message);
    res.status(502).json({ error: err.message || 'The humanizer failed. Try again.' });
  }
});


// On a persistent host / local dev we serve the built frontend and listen. On
// Vercel (serverless) the platform serves dist/ statically and invokes the
// exported `app` per request, so we skip both there.
if (!process.env.VERCEL) {
  const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));
  if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    // SPA fallback: any non-/api path returns index.html so client routing works.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url)));
    });
    console.log('[forvi] serving frontend from dist/ (single-service mode)');
  } else {
    console.warn('[forvi] dist/ not found — run `npm run build` so this server can serve the frontend too.');
  }

  app.listen(PORT, () => {
    console.log(`[forvi] server on http://localhost:${PORT}`);
    console.log('[forvi] OAuth redirect URI is derived per-request; register these in Google Cloud Console:');
    console.log('        http://localhost:3001/api/auth/callback/google  (local dev via Vite proxy)');
    console.log('        https://YOUR-DOMAIN/api/auth/callback/google     (your deployed domain)');
  });
}

export default app;
