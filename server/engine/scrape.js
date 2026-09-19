// Playwright scraper — renders a URL headless and extracts everything the
// rules engine and Claude need: the rendered HTML, all CSS (inline + linked),
// every class attribute, the fonts actually used, a handful of computed-style
// signals, the visible copy, and a full-page screenshot.
//
// A single shared browser instance is reused across scans; it launches lazily
// and is torn down on process exit.

import { chromium } from 'playwright';

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((err) => {
      // Reset so a later scan can retry (e.g. after `playwright install`).
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch {
      // ignore — we're shutting down
    }
    browserPromise = null;
  }
}

for (const sig of ['SIGINT', 'SIGTERM', 'exit']) {
  process.on(sig, () => {
    // best-effort; don't await on exit
    closeBrowser();
  });
}

// Normalize user input into a fetchable URL.
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
  // Block obvious SSRF targets — this server calls the URL itself.
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

/**
 * Render `url` and return a ScrapeResult:
 *   { url, title, html, text, css, classAttrs[], fonts[], signals{}, screenshot }
 * screenshot is a base64 PNG data URI (viewport-clamped, not full page, so it
 * stays a reasonable size for the browser).
 */
export async function scrape(url, { timeoutMs = 30000 } = {}) {
  const target = normalizeUrl(url);
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0 Safari/537.36 ForviBot/1.0',
    // Don't inherit a locale that hides content.
    locale: 'en-US',
  });

  const page = await context.newPage();
  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(async (err) => {
      // networkidle can hang on sites with long-poll/analytics; fall back.
      if (String(err).includes('Timeout')) {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      } else {
        throw err;
      }
    });
    // Give lazy hero content a moment to settle.
    await page.waitForTimeout(800);

    const extracted = await page.evaluate(() => {
      const out = {};
      out.title = document.title || '';
      out.html = document.documentElement.outerHTML || '';
      out.text = (document.body && document.body.innerText) || '';

      // Every class attribute on the page → the rules engine's richest signal.
      const classAttrs = [];
      for (const el of document.querySelectorAll('[class]')) {
        const c = el.getAttribute('class');
        if (c) classAttrs.push(c);
      }
      out.classAttrs = classAttrs;

      // All CSS text we can legally read: <style> blocks + same-origin sheets +
      // inline style="" attributes.
      let css = '';
      for (const st of document.querySelectorAll('style')) css += '\n' + (st.textContent || '');
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) css += '\n' + rule.cssText;
        } catch {
          // cross-origin sheet — skip, its classes still show up in classAttrs
        }
      }
      for (const el of document.querySelectorAll('[style]')) {
        const s = el.getAttribute('style');
        if (s) css += '\n' + s;
      }
      out.css = css;

      // Fonts actually applied to visible text.
      const fonts = new Set();
      const sample = document.querySelectorAll('h1,h2,h3,p,a,button,span,li');
      let i = 0;
      for (const el of sample) {
        if (i++ > 400) break;
        const ff = getComputedStyle(el).fontFamily;
        if (ff) fonts.add(ff);
      }
      out.fonts = Array.from(fonts);

      // Computed-style signals the class scan can miss (CSS-in-JS, custom CSS).
      const signals = { gradientEls: 0, blurEls: 0, coloredShadowEls: 0, fixedRoundBtns: 0 };
      const all = document.querySelectorAll('*');
      let j = 0;
      for (const el of all) {
        if (j++ > 5000) break;
        const cs = getComputedStyle(el);
        const bg = cs.backgroundImage || '';
        if (/linear-gradient|radial-gradient|conic-gradient/.test(bg)) signals.gradientEls++;
        if ((cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none'))
          signals.blurEls++;
        const sh = cs.boxShadow || '';
        if (sh && sh !== 'none' && /rgb|#/.test(sh) && !/rgba?\(\s*0\s*,\s*0\s*,\s*0/.test(sh) && !/rgb\(0, 0, 0/.test(sh))
          signals.coloredShadowEls++;
        if (cs.position === 'fixed' && parseFloat(cs.borderTopLeftRadius) > 20 && el.getBoundingClientRect().width < 90)
          signals.fixedRoundBtns++;
      }
      out.signals = signals;
      return out;
    });

    let screenshot = null;
    try {
      const buf = await page.screenshot({ type: 'png', fullPage: false });
      screenshot = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      // non-fatal — the report still works without a screenshot
    }

    return { url: target, screenshot, ...extracted };
  } finally {
    await context.close().catch(() => {});
  }
}
