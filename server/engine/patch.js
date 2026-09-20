// Surgical humanizer — patches the ORIGINAL page in place, removing the AI tells
// while leaving the design/brand/content intact. Deterministic transforms handle
// the mechanical/visual tells exactly; one scoped Claude pass rewrites the flagged
// copy. Every tell it can safely fix in place, it fixes. Fully automatic.
//
// Output: { html, changes, fixedCount } where `changes` is a human-readable list
// of the DISTINCT fixes applied (10 em dashes replaced is ONE fix, not ten) and
// `fixedCount` is changes.length — the number of separate fixes.

import { getClient, MODEL } from './anthropic.js';
import { FIELD_GUIDE_SYSTEM } from '../tells/fieldguide.js';

// Rewrite every class="..."/class='...' attribute token-by-token.
function editClassAttrs(html, rewriteCls) {
  const apply = (cls, q) => `class=${q}${rewriteCls(cls)}${q}`;
  return html
    .replace(/class="([^"]*)"/gi, (_m, c) => apply(c, '"'))
    .replace(/class='([^']*)'/gi, (_m, c) => apply(c, "'"));
}

// Apply one Claude copy replacement to the HTML. Tries an exact match first,
// then a whitespace-tolerant match (HTML collapses/înserts whitespace and line
// breaks that a verbatim copy won't have) so rewrites actually land instead of
// silently failing to string-match.
function applyCopyReplacement(html, find, replace) {
  if (html.includes(find)) return { html: html.split(find).join(replace), ok: true };
  const esc = find.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  try {
    const re = new RegExp(esc);
    if (re.test(html)) return { html: html.replace(re, () => replace), ok: true };
  } catch {
    // bad regex from an odd find string — skip
  }
  return { html, ok: false };
}

// ---- purple → blue recolor --------------------------------------------------
// Dev's rule: "if the theme is purple, make it blue." We swap the HUE of every
// purple/indigo/violet/fuchsia color VALUE in the CSS to blue, keeping its
// saturation and lightness — so a light lavender pill stays light, a deep purple
// button stays deep, they just turn blue. Done on the color VALUE (not by
// renaming Tailwind classes) because JIT-inlined CSS only ships the utilities the
// page actually used, so renaming `bg-purple-500`→`bg-blue-500` would leave an
// element with no rule at all.
const BLUE_HUE = 217; // Tailwind blue-500 hue
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
// Purple family = hue 225–320. Tailwind's indigo ramp runs ~226° (indigo-50) to
// ~243° (indigo-600), violet ~258, purple ~271, fuchsia ~292 — so 225 catches the
// whole indigo/violet/purple/fuchsia set including its light tints. True blue
// (blue-500 217°, blue-600 221°, blue-700 224°), cyan/sky (<210), pink/rose
// (>320) and grays (low S) are left alone.
function isPurpleHsl(h, s, l) {
  return s > 0.12 && l > 0.08 && l < 0.985 && h >= 225 && h <= 320;
}
function bluifyRgb(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (!isPurpleHsl(h, s, l)) return null;
  return hslToRgb(BLUE_HUE, s, l);
}
function hx(n) { return n.toString(16).padStart(2, '0'); }
// Rewrite every #hex / rgb() / hsl() purple in `css` to blue. Returns { css, n }.
function recolorPurpleToBlue(css) {
  let n = 0;
  // Handles #rgb, #rgba, #rrggbb, #rrggbbaa (alpha preserved). Longest match first
  // so an 8-digit value isn't mis-read as 6 + trailing chars.
  css = css.replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g, (m, hex) => {
    let rgb;
    let alpha = '';
    if (hex.length === 3) rgb = hex.split('').map((c) => c + c).join('');
    else if (hex.length === 4) { rgb = hex.slice(0, 3).split('').map((c) => c + c).join(''); alpha = hex[3] + hex[3]; }
    else if (hex.length === 6) rgb = hex;
    else { rgb = hex.slice(0, 6); alpha = hex.slice(6); }
    const num = parseInt(rgb, 16);
    const out = bluifyRgb((num >> 16) & 255, (num >> 8) & 255, num & 255);
    if (!out) return m;
    n++;
    return `#${hx(out[0])}${hx(out[1])}${hx(out[2])}${alpha}`;
  });
  css = css.replace(/rgba?\(([^)]+)\)/gi, (m, inner) => {
    const parts = inner.split(/[\s,/]+/).filter(Boolean);
    const r = parseFloat(parts[0]), g = parseFloat(parts[1]), b = parseFloat(parts[2]);
    if ([r, g, b].some((v) => Number.isNaN(v))) return m;
    const out = bluifyRgb(r, g, b);
    if (!out) return m;
    n++;
    const alpha = parts[3] !== undefined ? `,${parts[3]}` : '';
    return `rgb${alpha ? 'a' : ''}(${out[0]},${out[1]},${out[2]}${alpha})`;
  });
  css = css.replace(/hsla?\(([^)]+)\)/gi, (m, inner) => {
    const parts = inner.split(/[\s,/]+/).filter(Boolean);
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    if ([h, s, l].some((v) => Number.isNaN(v)) || !isPurpleHsl(h, s, l)) return m;
    n++;
    const alpha = parts[3] !== undefined ? ` / ${parts[3]}` : '';
    return `hsl${alpha ? 'a' : ''}(${BLUE_HUE} ${parts[1]} ${parts[2]}${alpha})`;
  });
  return { css, n };
}

// Copy tells the LLM rewrites (find/replace on exact phrases).
const COPY_TELLS = new Set([
  'buzzword-soup',
  'stacked-superlatives',
  'todays-fast-paced',
  'ai-cliche-phrases',
  'category-abstraction-headline',
  'now-with-ai-pill',
  'everything-you-need',
  'generic-cta',
  'ready-to-cta',
  'join-thousands',
  'trust-badges-unproven',
  'no-credit-card',
  'not-just-x-its-y',
  'whether-youre',
]);

const COPY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    replacements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { find: { type: 'string' }, replace: { type: 'string' } },
        required: ['find', 'replace'],
      },
    },
  },
  required: ['replacements'],
};

async function rewriteCopy(scrape, copyFindings) {
  const tells = copyFindings.length
    ? `Detectors flagged these specific copy tells (fix them first):\n${copyFindings.map((f) => `- ${f.label}: ${f.fix}`).join('\n')}\n`
    : '';
  const prompt = `Below is the visible copy from a web page. Rewrite the lines that read as AI-written so the page sounds like a real human wrote it.
${tells}
Rewrite any copy that shows these AI tells: buzzword soup (empower/seamless/effortless/unlock/elevate/leverage/supercharge/transform your…), stacked superlatives (revolutionary/cutting-edge/world-class/next-generation…), filler openers ("In today's fast-paced world", "Whether you're…"), the "it's not just X, it's Y" template, category-abstraction headlines that would fit any company, generic CTAs ("Get Started"/"Learn More"), vague social proof, and em dashes.

Return a list of exact-string replacements. Rules:
- "find" MUST be a SHORT, contiguous substring copied VERBATIM from the visible copy below (a single sentence, headline, subhead, or CTA label — NOT a whole paragraph), so it can be string-matched in the page.
- "replace" is a concrete, specific, human rewrite: no buzzwords, no filler, no em dashes, similar length. Use ONLY facts the page already states — do NOT invent facts, stats, features, names, or claims. For a generic CTA use action + outcome.
- Only include a replacement when it genuinely improves the line. If a line already reads human and specific, leave it out. Aim for the 5-15 highest-impact lines (headline, subhead, CTAs, section intros).

VISIBLE COPY:
${(scrape.text || '').slice(0, 8000)}`;

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 3000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: COPY_SCHEMA } },
    system: FIELD_GUIDE_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = res.content.find((b) => b.type === 'text');
  try {
    return JSON.parse(block ? block.text : '{"replacements":[]}').replacements || [];
  } catch {
    return [];
  }
}

// Remove whole hero announcement / "Powered by …" badge pills (icon + text),
// not just their text. Size-guarded so it can only ever eat a short badge, never
// a real section.
// Remove whole hero announcement / "Powered by …" badge pills (icon AND text).
// Uses a proper open/close STACK, never a backreference regex — a backreference
// mis-nests and can swallow a parent wrapper (which once deleted a hero's dark
// `bg-slate-950` background). For each element we accumulate its descendant text;
// on close, an element whose visible text is short (<=60 chars) and matches a
// badge phrase is a removal candidate. We then delete the OUTERMOST such element
// so the icon chip inside the pill goes with it — but the <=60 guard stops it
// from ever eating a real section.
function stripBadges(html) {
  const patterns = [/\bpowered by\b/i, /\bintroducing\b/i, /\bnow with\b/i, /\bcoming soon\b/i, /\bjoin the waitlist\b/i];
  // Gratuitous status badges — removed only when the element's WHOLE text is one
  // of these in all-caps (so "new" inside real prose is never touched).
  const BADGE_WORDS = new Set(['NEW', 'FLAGSHIP', 'AI-POWERED', 'BETA', 'COMING SOON', 'HOT', 'PRO', 'SOON']);
  const isBadgeWord = (t) => t.length <= 12 && t === t.toUpperCase() && BADGE_WORDS.has(t);
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const tokRe = /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>|([^<]+)/g;
  const stack = [];
  const ranges = [];
  let m;
  while ((m = tokRe.exec(html))) {
    const closeTag = m[1];
    const openTag = m[2];
    const selfClose = m[4];
    const textRun = m[5];
    if (textRun !== undefined) {
      const t = textRun.replace(/\s+/g, ' ');
      for (const f of stack) f.text += t;
      continue;
    }
    if (openTag !== undefined) {
      const tag = openTag.toLowerCase();
      if (!selfClose && !VOID.has(tag)) stack.push({ tag, start: m.index, text: '' });
      continue;
    }
    if (closeTag !== undefined) {
      const tag = closeTag.toLowerCase();
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tag !== tag) i--;
      if (i < 0) continue; // stray close tag — ignore
      const el = stack.splice(i)[0];
      const text = el.text.trim();
      if (text.length > 0 && text.length <= 60 && (patterns.some((p) => p.test(text)) || isBadgeWord(text))) {
        ranges.push({ start: el.start, end: m.index + m[0].length });
      }
    }
  }
  if (!ranges.length) return { html, removed: 0 };
  // Keep only outermost, non-overlapping ranges (drop the inner text-span when
  // the whole pill is already being removed).
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const keep = [];
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.start >= lastEnd) {
      keep.push(r);
      lastEnd = r.end;
    }
  }
  keep.sort((a, b) => b.start - a.start); // delete back-to-front so indices hold
  let out = html;
  for (const r of keep) out = out.slice(0, r.start) + out.slice(r.end);
  return { html: out, removed: keep.length };
}

export async function patchSite(scrape, findings = []) {
  const present = new Set(findings.map((f) => f.id));
  const has = (id) => present.has(id);

  // Patch the self-contained snapshot (CSS inlined) so the output renders with no
  // JS and no external loads.
  let html = scrape.snapshot || scrape.html || '';
  const changes = [];
  // `tally` accumulates INSTANCE counts per fix key so a change line can read
  // "Stopped 21 pulsing animations" — but each key is ONE distinct fix.
  const tally = {};
  const bump = (key, n = 1) => { tally[key] = (tally[key] || 0) + n; };

  // ---- class-token transforms -------------------------------------------------
  const doGradient = has('purple-indigo-gradient') || has('computed-gradients') || has('gradient-icon-tile');
  const anyClassFix =
    has('animate-pulse') || has('animate-ping') || doGradient || has('gradient-clip-text') ||
    has('bare-indigo-accent') || has('tracked-uppercase-eyebrow') || has('gratuitous-infinite-motion') ||
    has('hover-scale-everything') || has('transition-all') || has('glassmorphism-everywhere') ||
    has('colored-glow-shadow') || has('rounded-2xl-card') || has('left-border-accent') ||
    has('gradient-blob-orb') || has('logo-marquee') || has('scroll-reveal-everything') ||
    has('sticky-everything') || has('pill-badge-overuse');

  if (anyClassFix) {
    html = editClassAttrs(html, (cls) => {
      const hasEyebrow =
        has('tracked-uppercase-eyebrow') &&
        /\buppercase\b/.test(cls) &&
        (/\btracking-(wide|wider|widest)\b/.test(cls) ||
          (/\btext-(xs|sm)\b/.test(cls) && /\bfont-(mono|semibold|bold)\b/.test(cls)));
      const out = [];
      for (const t of cls.split(/\s+/)) {
        if (!t) continue;
        if ((has('animate-pulse') || has('animate-ping')) && /^animate-(pulse|ping)$/.test(t)) { bump('pulse'); continue; }
        if (has('gratuitous-infinite-motion') && /^animate-(bounce|spin|float|wiggle|gradient)$/.test(t)) { bump('loopmotion'); continue; }
        if (has('logo-marquee') && /^animate-(marquee|scroll)$/.test(t)) { bump('marquee'); continue; }
        if (has('scroll-reveal-everything') && /^(animate-fade|animate-in|fade-up|fade-in-up)$/.test(t)) { bump('reveal'); continue; }
        if (has('sticky-everything') && /^sticky$/.test(t)) { bump('sticky'); continue; }
        if (has('gradient-blob-orb') && /^(blur-(2xl|3xl)|animate-blob)$/.test(t)) { bump('blob'); continue; }
        if (has('hover-scale-everything') && /^hover:scale-(105|110|125)$/.test(t)) { bump('hoverscale'); continue; }
        if (has('transition-all') && /^transition-all$/.test(t)) { bump('transall'); continue; }
        if (has('glassmorphism-everywhere') && /^backdrop-blur(-\w+)?$/.test(t)) { bump('glass'); continue; }
        if (has('colored-glow-shadow') && /^shadow-(indigo|blue|purple|violet|fuchsia|primary|cyan|pink)-\d{3}$/.test(t)) { bump('glow'); continue; }
        if (doGradient && /^(bg-gradient-to-\w+|from-\S+|via-\S+|to-\S+)$/.test(t)) { bump('gradient'); continue; }
        if (has('gradient-clip-text') && /^(bg-clip-text|text-transparent)$/.test(t)) { bump('cliptext'); continue; }
        if (has('left-border-accent') && /^border-l-(2|4|8)$/.test(t)) { bump('leftborder'); continue; }
        if (has('rounded-2xl-card') && /^rounded-2xl$/.test(t)) { bump('radius'); out.push('rounded-lg'); continue; }
        if (hasEyebrow && (/^uppercase$/.test(t) || /^tracking-(wide|wider|widest)$/.test(t))) { bump('eyebrow'); continue; }
        out.push(t);
      }
      return out.join(' ');
    });
  }

  // ---- attribute / structural transforms -------------------------------------
  if (has('scroll-reveal-everything')) {
    const before = (html.match(/\sdata-aos(-\w+)?="[^"]*"/gi) || []).length;
    html = html.replace(/\sdata-aos(-\w+)?="[^"]*"/gi, '');
    if (before) bump('reveal', before);
  }
  if (has('missing-lang') && !/<html\b[^>]*\blang=/i.test(html)) {
    html = html.replace(/<html\b/i, '<html lang="en"');
    changes.push('Added a language attribute to <html>');
  }
  if (has('missing-alt-text')) {
    let n = 0;
    html = html.replace(/<img\b[^>]*>/gi, (tag) => {
      if (/\balt\s*=/.test(tag)) return tag;
      n++;
      return tag.replace(/\s*\/?>$/, (end) => ` alt=""${end}`);
    });
    if (n) changes.push(`Added alt attributes to ${n} image${n === 1 ? '' : 's'}`);
  }
  if (has('default-page-title')) {
    let name = '';
    try {
      name = new URL(scrape.url).hostname.replace(/^www\./, '').split('.')[0];
    } catch {
      name = '';
    }
    if (name) {
      const nice = name.charAt(0).toUpperCase() + name.slice(1);
      if (/<title>[\s\S]*?<\/title>/i.test(html)) {
        html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${nice}</title>`);
      } else {
        html = html.replace(/<head\b[^>]*>/i, (m) => `${m}<title>${nice}</title>`);
      }
      changes.push('Replaced the default framework page title');
    }
  }

  // ---- text / punctuation / glyph transforms ---------------------------------
  if (has('em-dash')) {
    const n = (html.match(/—/g) || []).length;
    html = html.replace(/\s*—\s*/g, ', ');
    if (n) changes.push(`Replaced ${n} em dash${n === 1 ? '' : 'es'}`);
  }
  if (has('sparkles-icon')) {
    // Both the literal glyphs AND lucide/inline sparkle SVGs.
    let n = (html.match(/[✦✧✨✳✴]/g) || []).length;
    html = html.replace(/[✦✧✨✳✴]/g, '');
    html = html.replace(
      /<svg\b[^>]*\b(?:class|data-lucide|data-icon)=["'][^"']*sparkl[^"']*["'][^>]*>[\s\S]*?<\/svg>/gi,
      () => { n++; return ''; },
    );
    if (n) changes.push(`Removed ${n} sparkle icon${n === 1 ? '' : 's'}`);
  }
  // Remove ALL lucide-react / lucide icons, not just the default handful the
  // detector names. lucide-react renders every icon as <svg class="lucide
  // lucide-<name>" …>; vanilla lucide leaves <i data-lucide="…"> placeholders.
  // Runs unconditionally so no lucide icon survives a humanize pass, even when
  // the page uses icon names the `lucide-default-set` detector doesn't list.
  {
    let n = 0;
    html = html.replace(
      /<svg\b[^>]*\bclass=["'][^"']*\blucide\b[^"']*["'][^>]*>[\s\S]*?<\/svg>/gi,
      () => { n++; return ''; },
    );
    html = html.replace(/<svg\b[^>]*\bdata-lucide=["'][^"']*["'][^>]*>[\s\S]*?<\/svg>/gi, () => { n++; return ''; });
    html = html.replace(/<i\b[^>]*\bdata-lucide=["'][^"']*["'][^>]*>\s*<\/i>/gi, () => { n++; return ''; });
    if (n) changes.push(`Removed ${n} lucide icon${n === 1 ? '' : 's'}`);
  }
  if (has('placeholder-leakage')) {
    const n = (html.match(/\{\{[^}]{1,60}\}\}|\[Object Object\]/g) || []).length;
    html = html.replace(/\{\{[^}]{1,60}\}\}/g, '').replace(/\[Object Object\]/g, '');
    if (n) changes.push(`Stripped ${n} leaked placeholder${n === 1 ? '' : 's'}`);
  }
  if (has('now-with-ai-pill')) {
    const n = (html.match(/\b(now with ai|powered by ai)\b/gi) || []).length;
    html = html.replace(/\b(now with ai|powered by ai)\b/gi, '');
    if (n) changes.push(`Removed ${n} "AI" announcement label${n === 1 ? '' : 's'}`);
  }
  if (has('no-credit-card')) {
    let n = 0;
    html = html.replace(/\s*[—,;.·|]?\s*(no credit card(?: required| needed)?|free forever|cancel anytime)\s*[.!]?/gi, () => {
      n++;
      return '';
    });
    if (n) changes.push(`Removed ${n} "no credit card" style microcopy line${n === 1 ? '' : 's'}`);
  }
  if (has('stale-copyright-year')) {
    const now = new Date().getFullYear();
    let n = 0;
    html = html.replace(/((?:©|copyright)\s*)(20\d{2})/gi, (m, pre, yr) => {
      if (Number(yr) < now) { n++; return pre + now; }
      return m;
    });
    if (n) changes.push(`Updated ${n} stale copyright year${n === 1 ? '' : 's'}`);
  }
  if (has('pure-black-white')) {
    let n = 0;
    html = html.replace(/#000000\b|#000\b(?![0-9a-f])/gi, () => { n++; return '#141414'; });
    html = html.replace(/#ffffff\b|#fff\b(?![0-9a-f])/gi, () => { n++; return '#fbfbf9'; });
    if (n) changes.push(`Softened ${n} raw black/white value${n === 1 ? '' : 's'}`);
  }
  // Remove whole hero announcement / "Powered by …" badge pills (icon + text).
  {
    const stripped = stripBadges(html);
    html = stripped.html;
    if (stripped.removed) changes.push(`Removed ${stripped.removed} announcement/badge pill${stripped.removed === 1 ? '' : 's'}`);
  }

  // Class-tally → one distinct change line per fix key.
  const T = [
    ['pulse', (c) => `Stopped ${c} pulsing/pinging animation${c === 1 ? '' : 's'}`],
    ['loopmotion', (c) => `Removed ${c} looping animation${c === 1 ? '' : 's'} (bounce/spin/float)`],
    ['marquee', (c) => `Stopped ${c} marquee/auto-scroll animation${c === 1 ? '' : 's'}`],
    ['reveal', (c) => `Disabled ${c} scroll fade-in effect${c === 1 ? '' : 's'}`],
    ['blob', (c) => `Removed ${c} blurred gradient blob${c === 1 ? '' : 's'}`],
    ['hoverscale', (c) => `Removed ${c} hover-zoom effect${c === 1 ? '' : 's'}`],
    ['transall', (c) => `Scoped ${c} "transition-all" rule${c === 1 ? '' : 's'}`],
    ['glass', (c) => `Removed ${c} glassmorphism blur${c === 1 ? '' : 's'}`],
    ['glow', (c) => `Removed ${c} colored glow shadow${c === 1 ? '' : 's'}`],
    ['gradient', (c) => `Neutralized ${c} gradient class${c === 1 ? '' : 'es'}`],
    ['cliptext', (c) => `Un-clipped ${c} gradient-text element${c === 1 ? '' : 's'}`],
    ['eyebrow', (c) => `Normalized ${c} tracked-uppercase eyebrow${c === 1 ? '' : 's'}`],
    ['radius', (c) => `Toned down ${c} over-rounded card${c === 1 ? '' : 's'}`],
    ['leftborder', (c) => `Removed ${c} accent border bar${c === 1 ? '' : 's'}`],
    ['sticky', (c) => `Un-stuck ${c} sticky element${c === 1 ? '' : 's'}`],
  ];
  for (const [key, fmt] of T) if (tally[key]) changes.push(fmt(tally[key]));

  // ---- CSS-in-JS / plain-CSS level transforms --------------------------------
  // Many sites author these tells as inline styles or CSS-in-JS, not Tailwind
  // class tokens — the class scan above misses those entirely (a non-Tailwind
  // page would otherwise get almost nothing fixed). So scrub them in the inlined
  // <style> CSS and style="" attributes directly. Each only adds a change line
  // when the class pass didn't already count that fix, so counts stay honest.
  if (doGradient || has('gradient-clip-text')) {
    let n = 0;
    html = html.replace(/(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/gi, (m) => {
      const cm = m.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/i);
      n++;
      return cm ? cm[0] : 'transparent';
    });
    if (n && !tally.gradient) changes.push(`Flattened ${n} gradient${n === 1 ? '' : 's'} to a solid color`);
  }
  if (has('glassmorphism-everywhere')) {
    let n = 0;
    html = html.replace(/(-webkit-)?backdrop-filter\s*:\s*(?!none)[^;"'}]+/gi, (_m, pfx) => {
      n++;
      return `${pfx || ''}backdrop-filter:none`;
    });
    if (n && !tally.glass) changes.push(`Removed ${n} glassmorphism blur${n === 1 ? '' : 's'}`);
  }
  if (has('sticky-everything')) {
    let n = 0;
    html = html.replace(/position\s*:\s*sticky/gi, () => {
      n++;
      return 'position:static';
    });
    if (n && !tally.sticky) changes.push(`Un-stuck ${n} sticky element${n === 1 ? '' : 's'}`);
  }
  // Kill pulsating dots authored in plain CSS / CSS-in-JS (the Tailwind
  // `animate-pulse`/`animate-ping` class path is handled above). Rather than hunt
  // every `animation:` property, we empty the offending @keyframes body itself —
  // any `pulse`/`ping`/`blink`/`glow`/`throb`/`breathe` keyframe becomes a no-op,
  // so the element stays put (a static dot) no matter what class drives it. Runs
  // unconditionally so a throbbing status dot never survives a humanize pass.
  {
    let n = 0;
    html = html.replace(
      /@(-webkit-)?keyframes\s+([\w-]*(?:pulse|ping|blink|glow|throb|breathe|flash)[\w-]*)\s*\{(?:[^{}]|\{[^{}]*\})*\}/gi,
      (_m, pfx, name) => { n++; return `@${pfx || ''}keyframes ${name}{}`; },
    );
    if (n && !tally.pulse) changes.push(`Stopped ${n} pulsing animation${n === 1 ? '' : 's'}`);
  }
  // Purple theme → blue. Runs on the whole document (inlined <style>, style=""
  // attrs, and inline SVG fills), so a purple site comes out blue no matter how
  // the color was authored. No-op when there's no purple.
  {
    const { css: recolored, n } = recolorPurpleToBlue(html);
    html = recolored;
    if (n) changes.push(`Recolored ${n} purple color${n === 1 ? '' : 's'} to blue`);
  }
  if (has('emoji-in-headings')) {
    // Pictographic emoji only — deliberately excludes the arrow ranges so real
    // "→" affordances survive.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
    let n = 0;
    html = html.replace(EMOJI, () => {
      n++;
      return '';
    });
    if (n) changes.push(`Removed ${n} decorative emoji`);
  }

  // ---- defensive CSS overrides (catch CSS-in-JS the class scan missed) --------
  const overrides = [];
  if (has('animate-pulse') || has('animate-ping')) overrides.push('.animate-pulse,.animate-ping{animation:none!important}');
  if (has('gratuitous-infinite-motion')) overrides.push('.animate-bounce,.animate-spin,.animate-float,.animate-wiggle,.animate-gradient{animation:none!important}');
  if (has('logo-marquee')) overrides.push('.animate-marquee,.animate-scroll{animation:none!important}');
  if (has('gradient-clip-text'))
    overrides.push('[class*="bg-clip-text"],[class*="text-transparent"]{-webkit-text-fill-color:currentColor!important;color:inherit!important;background-image:none!important}');
  if (has('glassmorphism-everywhere')) overrides.push('[class*="backdrop-blur"]{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}');
  if (has('tracked-uppercase-eyebrow'))
    overrides.push('[class*="uppercase"][class*="tracking-"]{text-transform:none!important;letter-spacing:normal!important}');
  if (has('inter-geist-default')) {
    // Switch off the default Inter/Geist AI-era face. `[class]` (specificity
    // 0,1,0) ties Tailwind's `.font-sans` utility and wins by source order (this
    // <style> is injected last), so it beats the page's own font without an
    // ugly universal `!important`. Monospace is preserved via a later-listed
    // rule that wins the tie for code/mono elements.
    overrides.push(
      "html,body,[class]{font-family:'Avenir Next',Avenir,'Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,sans-serif!important}" +
        'code,pre,kbd,samp,[class*="mono"]{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace!important}',
    );
    changes.push('Switched off the default Inter/Geist font');
  }
  // Square every pill. Done as a CONCRETE CSS override (not by renaming
  // `rounded-full`→`rounded-md`): with Tailwind's JIT-inlined CSS the target
  // utility's rule usually isn't in the snapshot, so a rename would leave the
  // element with NO radius rule at all. A pill = a `rounded-full` element with
  // horizontal/vertical padding (`px-*`/`py-*`) — the label/badge/CTA chip shape;
  // plus links/buttons that are rounded-full, and anything class-named
  // badge/pill/chip. Avatars (`rounded-full w-/h-`, no padding) and status dots
  // (`rounded-full h-2 w-2`) have no px/py and aren't links/badges, so they stay
  // round on purpose. `!important` + concrete .4rem beats the page's own rule.
  {
    let pillCount = 0;
    let namedPill = false;
    for (const mm of html.matchAll(/class=["']([^"']*)["']/gi)) {
      const c = mm[1];
      if (/\brounded-full\b/.test(c) && /\b(px|py)-/.test(c)) pillCount++;
      if (/\b(badge|pill|chip)\b/i.test(c) || /-(badge|pill|chip)\b/i.test(c)) namedPill = true;
    }
    const linkedPill = /<(?:a|button)\b[^>]*class=["'][^"']*\brounded-full\b/i.test(html);
    if (pillCount || namedPill || linkedPill) {
      overrides.push(
        '[class*="rounded-full"][class*="px-"],[class*="rounded-full"][class*="py-"],' +
          'a[class*="rounded-full"],button[class*="rounded-full"],[role="button"][class*="rounded-full"],' +
          '[class*="badge"],[class*="pill"],[class*="chip"]{border-radius:.4rem!important}',
      );
      changes.push(pillCount ? `Squared ${pillCount} rounded-full pill${pillCount === 1 ? '' : 's'}` : 'Squared rounded-full pills into rectangles');
    }
  }
  if (has('shadow-everywhere')) {
    overrides.push('[class*="shadow-2xl"],[class*="shadow-xl"]{box-shadow:0 1px 3px rgba(0,0,0,.07)!important}');
    changes.push('Softened heavy uniform drop shadows');
  }
  if (has('focus-outline-removed')) {
    overrides.push(':focus-visible{outline:2px solid currentColor!important;outline-offset:2px!important}');
    changes.push('Restored visible keyboard focus outlines');
  }
  const motionPresent =
    has('animate-pulse') || has('animate-ping') || has('gratuitous-infinite-motion') || has('transition-all') ||
    has('scroll-reveal-everything') || has('logo-marquee') || has('gradient-blob-orb') || has('hover-scale-everything') ||
    has('reduced-motion-missing');
  if (motionPresent) {
    overrides.push('@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}');
    if (has('reduced-motion-missing')) changes.push('Added a reduced-motion accessibility guard');
  }

  // ---- copy humanization (Claude) — ALWAYS runs so every humanize does real,
  // visible text work (rewriting AI-sounding copy), not just mechanical scrubbing.
  const copyFindings = findings.filter((f) => COPY_TELLS.has(f.id));
  if ((scrape.text || '').trim().length > 40) {
    let reps = [];
    try {
      reps = await rewriteCopy(scrape, copyFindings);
    } catch (err) {
      if (err.code !== 'NO_API_KEY') console.error('[forvi] copy rewrite failed:', err.message);
    }
    let applied = 0;
    for (const r of reps) {
      if (!r || !r.find || !r.replace || r.find === r.replace) continue;
      const res = applyCopyReplacement(html, r.find, r.replace);
      if (res.ok) {
        html = res.html;
        applied++;
      }
    }
    if (applied) changes.push(`Rewrote ${applied} line${applied === 1 ? '' : 's'} of AI copy`);
  }

  // Inject <base> (so relative CSS/images still resolve) + the Forvi overrides.
  const headInject =
    `<base href="${scrape.url}">` + (overrides.length ? `<style data-forvi>${overrides.join('')}</style>` : '');
  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${headInject}</head>`);
  else html = headInject + html;

  if (!/^\s*<!doctype/i.test(html)) html = '<!doctype html>\n' + html;

  // fixedCount = number of DISTINCT fixes (10 em dashes = one fix).
  return { html, changes, fixedCount: changes.length };
}
