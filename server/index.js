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

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  APP_BASE_URL = 'http://localhost:5173',
  PORT = 8787,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error(
    '\n[forvi] Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.\n' +
      'Copy .env.example to .env and fill in your Google OAuth credentials.\n'
  );
  process.exit(1);
}

// Google redirects the browser here after consent. This exact URL must be
// listed under "Authorized redirect URIs" for the OAuth client in the
// Google Cloud Console.
const REDIRECT_URI = `${APP_BASE_URL}/api/auth/callback/google`;

const app = express();
app.use(express.json({ limit: '1mb' }));

// Session store, persisted to a file on disk so a past login survives server
// restarts — users stay signed in when they come back instead of re-logging in
// every time. Fine for local dev; swap for a real store (Redis/DB) in prod.
const SESSIONS_FILE = fileURLToPath(new URL('../.forvi-sessions.json', import.meta.url));
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const sessions = new Map();

try {
  const stored = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  const now = Date.now();
  for (const [sid, entry] of Object.entries(stored)) {
    // Back-compat: older entries were the bare user object (no createdAt).
    if (entry && entry.user) {
      if (!entry.createdAt || now - entry.createdAt < SESSION_TTL_MS) sessions.set(sid, entry);
    } else if (entry) {
      sessions.set(sid, { user: entry, createdAt: now });
    }
  }
  if (sessions.size) console.log(`[forvi] restored ${sessions.size} saved session(s)`);
} catch {
  // no file yet, or unreadable — start empty
}

function persistSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)));
  } catch (err) {
    console.warn('[forvi] could not persist sessions:', err.message);
  }
}

// Return the user for a session id (entries store { user, createdAt }).
function sessionUser(sid) {
  const entry = sid ? sessions.get(sid) : null;
  return entry ? entry.user : null;
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
  // Add `Secure` automatically when served over https in production.
  if (APP_BASE_URL.startsWith('https://')) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Step 1 — kick off the OAuth flow: set a CSRF state cookie and bounce the
// browser to Google's consent screen.
app.get('/api/auth/google', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'oauth_state', state, 600);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
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
    res.redirect(`${APP_BASE_URL}/?auth=error`);
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
        redirect_uri: REDIRECT_URI,
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

    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { user, createdAt: Date.now() });
    persistSessions();
    setCookie(res, 'sid', sid, 60 * 60 * 24 * 30); // 30 days — stay signed in

    res.redirect(`${APP_BASE_URL}/?auth=success`);
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

app.post('/api/auth/logout', (req, res) => {
  const { sid } = parseCookies(req);
  if (sid && sessions.delete(sid)) persistSessions();
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

    res.json({
      scanId: id,
      url: site.url,
      title: site.title,
      screenshot: site.screenshot,
      aiJudgment,
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
  const entry = scans.get(scanId);
  if (!entry) return res.status(404).json({ error: 'Scan expired or not found. Run the scan again.' });

  try {
    const result = await patchSite(entry.scrape, entry.findings);
    if (!result.html) return res.status(502).json({ error: 'The humanized page came back empty. Try again.' });
    entry.humanized = result.html;
    res.json({ scanId, html: result.html, changes: result.changes, fixedCount: result.fixedCount });
  } catch (err) {
    console.error('[forvi] humanize failed:', err.message);
    res.status(502).json({ error: 'The humanizer failed. Try again.' });
  }
});

// GET /api/humanize/:id/download -> the rewritten site as a file download
app.get('/api/humanize/:id/download', (req, res) => {
  const entry = scans.get(req.params.id);
  if (!entry || !entry.humanized) return res.status(404).send('Not found. Humanize the scan first.');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="humanized-site.html"');
  res.send(entry.humanized);
});

app.listen(PORT, () => {
  console.log(`[forvi] auth server on http://localhost:${PORT}`);
  console.log(`[forvi] add this redirect URI in Google Cloud Console: ${REDIRECT_URI}`);
});
