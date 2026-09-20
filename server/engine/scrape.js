// Fetch-based scraper — pulls a page's HTML over plain HTTP (no headless
// browser), then extracts everything the rules engine and Claude need: title,
// class attributes, visible text, all CSS (inline <style> + fetched linked
// stylesheets), the fonts referenced, and a few CSS-derived signals. This runs
// anywhere Node runs — including Vercel serverless functions — because it never
// launches a browser.
//
// Trade-off vs a headless browser: fully client-rendered SPAs that ship an empty
// <div id="root"> and paint via JS will only expose their shell here. Server-
// rendered / static / mostly-static pages scan fully.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36 ForviBot/1.0';

// Normalize user input into a fetchable URL, with SSRF guards (this server
// fetches the URL itself).
export function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('No URL provided.');
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u;
  try {
    u = new URL(withProto);
  } catch {
    throw new Error(`"${input}" is not a valid URL.`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are supported.');
  const host = u.hostname.toLowerCase();
  const isLocal =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isLocal) throw new Error('Refusing to scan a private/localhost address.');
  return u.toString();
}

async function fetchText(url, timeoutMs, accept) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: ac.signal,
    });
    return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' };
  } finally {
    clearTimeout(timer);
  }
}

const attrValues = (html, re) =>
  [...html.matchAll(re)].map((m) => (m[2] !== undefined ? m[2] : m[3])).filter((v) => v != null);

/**
 * Fetch `url` and return a ScrapeResult:
 *   { url, title, html, text, css, classAttrs[], fonts[], signals{}, screenshot, snapshot }
 * `screenshot` is always null here (no browser); the dashboard renders the
 * original + humanized HTML in iframes instead.
 */
export async function scrape(url, { timeoutMs = 15000 } = {}) {
  const target = normalizeUrl(url);

  const page = await fetchText(target, timeoutMs, 'text/html,application/xhtml+xml');
  if (!page.ok) throw new Error(`Couldn't fetch that page (HTTP ${page.status}).`);
  const html = page.text || '';
  if (!html.trim()) throw new Error('That page returned no HTML.');

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const classAttrs = attrValues(html, /class=("([^"]*)"|'([^']*)')/gi);
  const inlineStyleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const inlineStyleAttrs = attrValues(html, /style=("([^"]*)"|'([^']*)')/gi).join('\n');

  // Fetch linked stylesheets (best-effort, bounded) so class/CSS detection and
  // the CSS-level humanizer transforms have the real styles to work with.
  const linkTags = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((t) => t[0])
    .filter((t) => /rel=["']?stylesheet/i.test(t))
    .map((t) => (t.match(/href=("([^"]*)"|'([^']*)')/i) || [])[0] && (t.match(/href=("([^"]*)"|'([^']*)')/i)[2] ?? t.match(/href=("([^"]*)"|'([^']*)')/i)[3]))
    .filter(Boolean)
    .slice(0, 10);

  let linkedCss = '';
  await Promise.all(
    linkTags.map(async (href) => {
      let abs;
      try {
        abs = new URL(href, target).toString();
      } catch {
        return;
      }
      try {
        const r = await fetchText(abs, Math.min(timeoutMs, 10000), 'text/css,*/*');
        if (r.ok && r.text && r.text.length < 800000) linkedCss += '\n' + r.text;
      } catch {
        // unreachable/cross-origin sheet — skip
      }
    })
  );

  const css = `${inlineStyleBlocks}\n${linkedCss}\n${inlineStyleAttrs}`;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const fonts = [...css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)].map((m) => m[1].trim()).slice(0, 60);

  // CSS-derived signals (no computed styles without a browser, so approximate
  // from the stylesheet text — enough to drive the gradient/blur/shadow rules).
  const gradientEls = (css.match(/(linear|radial|conic)-gradient/gi) || []).length;
  const blurEls = (css.match(/backdrop-filter\s*:\s*[^;}]*blur/gi) || []).length;
  const coloredShadowEls = (css.match(/box-shadow\s*:[^;}]*(#|rgb|hsl|oklch)[^;}]*/gi) || []).filter(
    (s) => !/rgba?\(\s*0\s*,\s*0\s*,\s*0/.test(s) && !/#000\b/.test(s)
  ).length;
  const signals = { gradientEls, blurEls, coloredShadowEls, fixedRoundBtns: 0 };

  // Self-contained snapshot the humanizer patches: the fetched HTML with linked
  // <link> stylesheets replaced by the inlined CSS (so the CSS-level transforms
  // can edit it and the preview iframe needs no external loads), plus a <base>
  // so any remaining relative images/fonts still resolve.
  let snapshot = html.replace(/<link\b[^>]*rel=["']?stylesheet[^>]*>/gi, '');
  const headInject = `<base href="${target}"><style data-forvi-inlined>\n${inlineStyleBlocks}\n${linkedCss}\n</style>`;
  if (/<head[^>]*>/i.test(snapshot)) snapshot = snapshot.replace(/<head[^>]*>/i, (m) => m + headInject);
  else if (/<\/head>/i.test(snapshot)) snapshot = snapshot.replace(/<\/head>/i, headInject + '</head>');
  else snapshot = headInject + snapshot;

  return { url: target, title, html, text, css, classAttrs, fonts, signals, screenshot: null, snapshot };
}

// No browser to tear down anymore — kept as a no-op so existing imports/shutdown
// hooks don't break.
export async function closeBrowser() {}
