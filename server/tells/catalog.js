// The tell catalog — the deterministic half of Forvi's hybrid engine.
//
// Every entry is one *type* of AI tell distilled from the field guide. The
// deterministic detectors below find an unbounded number of *instances* of each
// type in a real page (thousands, across a real site) — the catalog itself is
// the finite vocabulary of what "vibe coded" looks like.
//
// A tell either carries a `detect(scrape)` function (mechanical: exact, cheap,
// runs on every scan) or is marked `claudeOnly` (judgment: layout skeleton,
// tone, contrast — handed to Claude with the field guide as its ruleset).
//
// detect(scrape) returns { count, samples } where samples is a short list of
// human-readable evidence strings. scrape is the object from engine/scrape.js:
//   { url, html, text, css, classAttrs[], fonts[], signals{} }

// ---------------------------------------------------------------------------
// matcher helpers
// ---------------------------------------------------------------------------

function countRegex(text, re, cap = 6) {
  if (!text) return { count: 0, samples: [] };
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const samples = [];
  let m;
  let n = 0;
  while ((m = g.exec(text)) !== null) {
    n++;
    const hit = (m[0] || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (samples.length < cap && hit && !samples.includes(hit)) samples.push(hit);
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return { count: n, samples };
}

// Count Tailwind-style class tokens across every class attribute on the page.
// This is the single most reliable deterministic signal: the field guide's
// mechanical tells are, overwhelmingly, literal utility class names.
function countClass(classAttrs, re, cap = 6) {
  const samples = [];
  let n = 0;
  for (const attr of classAttrs || []) {
    for (const tok of String(attr).split(/\s+/)) {
      if (tok && re.test(tok)) {
        n++;
        if (samples.length < cap && !samples.includes(tok)) samples.push(tok);
      }
    }
  }
  return { count: n, samples };
}

// Count class attributes whose WHOLE string matches a regex (for co-occurring
// tokens on one element, e.g. uppercase + tracking on the same eyebrow label).
function countAttr(classAttrs, re, cap = 6) {
  const samples = [];
  let n = 0;
  for (const attr of classAttrs || []) {
    if (re.test(attr)) {
      n++;
      if (samples.length < cap) samples.push(String(attr).slice(0, 60));
    }
  }
  return { count: n, samples };
}

// Count class attributes where EVERY regex matches somewhere in the same
// attribute string (token co-occurrence on one element).
function countAttrAll(classAttrs, regexes, cap = 6) {
  const samples = [];
  let n = 0;
  for (const attr of classAttrs || []) {
    if (regexes.every((r) => r.test(attr))) {
      n++;
      if (samples.length < cap) samples.push(String(attr).slice(0, 60));
    }
  }
  return { count: n, samples };
}

// Merge several {count, samples} results into one.
function merge(...results) {
  const out = { count: 0, samples: [] };
  for (const r of results) {
    if (!r) continue;
    out.count += r.count;
    for (const s of r.samples) if (out.samples.length < 6 && !out.samples.includes(s)) out.samples.push(s);
  }
  return out;
}

// A crude emoji detector (covers the common pictographic ranges).
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}✨✳✴✖]/u;

// ---------------------------------------------------------------------------
// severity weights (used by scoring)
// ---------------------------------------------------------------------------
// critical: a hard project rule or a smoking gun that alone flunks the page.
// high:     a diagnostic tell — near-certain sign of an untouched default.
// medium:   a strong smell in isolation, damning in a cluster.
// low:      minor, contributes when it piles up.

export const SEVERITY_WEIGHT = { critical: 12, high: 6, medium: 3, low: 1 };

// Display groups map many granular tells onto the coarse buckets the dashboard
// shows, so the report reads cleanly while detection stays precise.
export const CATEGORY_LABELS = {
  color: 'Color & gradients',
  type: 'Typography',
  layout: 'Layout & structure',
  components: 'Components & chrome',
  icon: 'Icons & imagery',
  motion: 'Motion & animation',
  states: 'Missing states',
  copy: 'Copy & tone',
  responsive: 'Responsive / mobile',
  a11y: 'Accessibility',
  deploy: 'Deployment & trust',
  placeholder: 'Placeholder leakage',
};

// ---------------------------------------------------------------------------
// the catalog
// ---------------------------------------------------------------------------

export const TELLS = [
  // ---- COLOR & GRADIENT ---------------------------------------------------
  {
    id: 'purple-indigo-gradient',
    category: 'color',
    severity: 'high',
    label: 'Purple / indigo hero gradient',
    why: 'The ~135deg violet-to-blue gradient is the single most reliable AI tell.',
    fix: 'Replace with one brand hue used with intent, or drop the gradient entirely.',
    detect: (s) =>
      merge(
        countClass(s.classAttrs, /^(bg|from|via|to)-(indigo|violet|purple|fuchsia)-\d{3}$/),
        countRegex(s.css, /linear-gradient\([^)]*(#(6|7|8)[0-9a-f]{2}[0-9a-f]{2}f[0-9a-f]|indigo|violet|purple|rebeccapurple|blueviolet)[^)]*\)/i),
        countClass(s.classAttrs, /^bg-gradient-to-(r|br|tr|b)$/),
      ),
  },
  {
    id: 'bare-indigo-accent',
    category: 'color',
    severity: 'high',
    label: 'Untouched framework accent (indigo/blue-500)',
    why: 'bg-indigo-500 / blue-600 shipped raw is the literal Tailwind default — no decision was made.',
    fix: 'Define a custom brand token and use it instead of the stock utility.',
    detect: (s) => countClass(s.classAttrs, /^(bg|text|ring|border)-(indigo|blue|violet)-(500|600)$/),
  },
  {
    id: 'gradient-clip-text',
    category: 'color',
    severity: 'high',
    label: 'Gradient-clipped text',
    why: 'Gradient headline/stat text kills contrast and scannability, and has no measurable a11y ratio.',
    fix: 'Use a solid color for headings and numbers.',
    detect: (s) =>
      merge(
        countClass(s.classAttrs, /^(bg-clip-text|text-transparent)$/),
        countRegex(s.css, /background-clip:\s*text|-webkit-background-clip:\s*text/i),
      ),
  },
  {
    id: 'glassmorphism-everywhere',
    category: 'color',
    severity: 'medium',
    label: 'Glassmorphism / backdrop-blur surfaces',
    why: 'Frosted blur used as the default surface everywhere is a canonical dark-AI look.',
    fix: 'Frost at most one real overlay (sticky nav); make everything else solid.',
    detect: (s) =>
      merge(
        countClass(s.classAttrs, /^backdrop-blur(-\w+)?$/),
        countRegex(s.css, /backdrop-filter:\s*blur/i),
      ),
  },
  {
    id: 'colored-glow-shadow',
    category: 'color',
    severity: 'medium',
    label: 'Colored / glowing shadows',
    why: 'A purple bloom under a purple button implies no consistent light source.',
    fix: 'Use a neutral low-opacity shadow implying one light source.',
    detect: (s) => countClass(s.classAttrs, /^shadow-(indigo|blue|purple|violet|fuchsia|primary|cyan|pink)-\d{3}$/),
  },
  {
    id: 'low-contrast-gray-body',
    category: 'color',
    severity: 'medium',
    label: 'Low-contrast gray-on-gray body text',
    why: 'gray-400 / slate-500 body copy is rarely contrast-checked and usually fails 4.5:1.',
    fix: 'Verify 4.5:1 on every text/background pair; darken body text.',
    detect: (s) => countClass(s.classAttrs, /^text-(gray|slate|zinc|neutral|stone)-(300|400|500)$/),
  },
  {
    id: 'hardcoded-hex-with-tokens',
    category: 'color',
    severity: 'low',
    label: 'Arbitrary hex values mixed with tokens',
    why: 'text-[#...] / bg-[#...] alongside semantic tokens means color never went through the system.',
    fix: 'Route all color through theme tokens.',
    detect: (s) => countClass(s.classAttrs, /^(text|bg|border|from|to|via|ring)-\[#([0-9a-f]{3}|[0-9a-f]{6})\]$/i),
  },
  {
    id: 'neon-on-dark',
    category: 'color',
    severity: 'medium',
    claudeOnly: true,
    label: 'Competing neon accents on dark',
    why: 'Electric blue + hot pink + acid green at full saturation with no hierarchy.',
    fix: 'One saturated accent on desaturated neutrals; establish 60/30/10.',
  },

  // ---- TYPOGRAPHY ---------------------------------------------------------
  {
    id: 'inter-geist-default',
    category: 'type',
    severity: 'medium',
    label: 'Default Inter / Geist type',
    why: 'Inter/Geist at stock weights is the "Helvetica of the LLM era" — the v0/shadcn default.',
    fix: 'Choose a face tied to the brand voice; pair a display and a text family.',
    detect: (s) => {
      const fonts = (s.fonts || []).join(' ');
      return countRegex(fonts, /\b(Inter|Geist|Geist Mono|Space Grotesk|Instrument Serif)\b/i);
    },
  },
  {
    id: 'giant-hero-tight-leading',
    category: 'type',
    severity: 'low',
    label: 'Oversized hero heading',
    why: 'text-6xl/7xl with default leading makes big display lines collide.',
    fix: 'Tighten leading and negative-track display sizes; loosen small text.',
    detect: (s) => countClass(s.classAttrs, /^(text-(6xl|7xl|8xl|9xl)|md:text-(7xl|8xl|9xl))$/),
  },
  {
    id: 'center-everything',
    category: 'type',
    severity: 'low',
    label: 'Everything center-aligned',
    why: 'Long body copy centered everywhere is an AI reflex; it hurts readability.',
    fix: 'Left-align body and most headings; center only short deliberate moments.',
    detect: (s) => countClass(s.classAttrs, /^text-center$/),
  },
  {
    id: 'all-caps-overuse',
    category: 'type',
    severity: 'low',
    label: 'ALL-CAPS eyebrows everywhere',
    why: 'A tiny uppercase tracked label over every section.',
    fix: 'Use caps sparingly with tracking; fold kickers into the headline.',
    detect: (s) => countClass(s.classAttrs, /^uppercase$/),
  },
  {
    id: 'em-dash',
    category: 'type',
    severity: 'critical',
    label: 'Em dashes in copy',
    why: 'Em dashes anywhere in copy are a hard project rule and a strong machine-writing tell.',
    fix: 'Replace with commas, periods, or a restructured sentence.',
    detect: (s) => countRegex(s.text, /—/),
  },
  {
    id: 'emoji-in-headings',
    category: 'type',
    severity: 'low',
    label: 'Emoji used as UI furniture',
    why: 'Emoji in headings/labels/bullets in place of a real icon set.',
    fix: 'Use a real vector set; keep emoji to occasional microcopy.',
    detect: (s) => countRegex(s.text, EMOJI_RE),
  },

  // ---- LAYOUT & STRUCTURE -------------------------------------------------
  {
    id: 'now-with-ai-pill',
    category: 'layout',
    severity: 'high',
    label: '"Now with AI" announcement pill',
    why: 'The sparkle + rounded pill + the word AI is a three-in-one AI fingerprint.',
    fix: 'Drop the pill; if the feature matters, put it in the headline.',
    detect: (s) =>
      countRegex(s.text, /\b(now with ai|powered by ai|ai[- ]powered|introducing|✦\s*new|new\s*✦)\b/i),
  },
  {
    id: 'three-col-feature-grid',
    category: 'layout',
    severity: 'medium',
    label: 'Symmetric 3-column feature grid',
    why: 'Three identical-height icon+title+one-liner cards is the template feature section.',
    fix: 'Break symmetry; feature one capability large with a real screenshot.',
    detect: (s) => countClass(s.classAttrs, /^(md:)?grid-cols-3$/),
  },
  {
    id: 'stat-band-round-numbers',
    category: 'layout',
    severity: 'medium',
    label: 'Unsourced round-number stat band',
    why: 'Suspiciously round, sourceless stats (99.9% uptime, 10k+ users, 5B+ data points).',
    fix: 'Use one real sourced number or cut the band.',
    detect: (s) =>
      countRegex(
        s.text,
        /\b(\d{1,3}(,\d{3})*\+|\d+(\.\d+)?\s?[kKmMbB]\+?|99\.9%|100%|\d{2,3}%)\s*(\+)?\s*(users|customers|companies|uptime|accuracy|data points|downloads|reviews|countries)?/i,
      ),
  },
  {
    id: 'gradient-blob-orb',
    category: 'layout',
    severity: 'medium',
    label: 'Glow orb / gradient blob behind hero',
    why: 'A blurred radial bloom or floating blob is meaningless ambient color theater.',
    fix: 'Use a solid tuned background; let content carry the section.',
    detect: (s) => countClass(s.classAttrs, /^(blur-(2xl|3xl)|animate-blob)$/),
  },
  {
    id: 'uniform-vertical-rhythm',
    category: 'layout',
    severity: 'low',
    label: 'Identical py-20 rhythm on every section',
    why: 'Every section the same vertical padding, centered, no focal point.',
    fix: 'Modulate rhythm; make one element per viewport dominant.',
    detect: (s) => countClass(s.classAttrs, /^(py|md:py)-(16|20|24|28|32)$/),
  },

  // ---- COMPONENTS & CHROME ------------------------------------------------
  {
    id: 'rounded-2xl-card',
    category: 'components',
    severity: 'medium',
    label: 'The v0 card (rounded-2xl + border + shadow-sm)',
    why: 'The untouched v0/Lovable card cluster applied to every surface.',
    fix: 'Most surfaces are dividers, not cards; use one deliberate radius+shadow vocabulary.',
    detect: (s) => countClass(s.classAttrs, /^rounded-2xl$/),
  },
  {
    id: 'shadow-everywhere',
    category: 'components',
    severity: 'low',
    label: 'Shadow on everything',
    why: 'shadow-sm (or harsh shadow-2xl) copy-pasted onto every element — no elevation system.',
    fix: 'Build a real elevation scale; shadow only what actually floats.',
    detect: (s) => countClass(s.classAttrs, /^shadow(-sm|-md|-lg|-xl|-2xl)?$/),
  },
  {
    id: 'pill-badge-overuse',
    category: 'components',
    severity: 'low',
    label: 'rounded-full pills on every label',
    why: 'Gratuitous NEW / FLAGSHIP / AI-POWERED badges that encode no real state.',
    fix: 'A badge must mean something; otherwise remove it.',
    detect: (s) =>
      merge(
        countClass(s.classAttrs, /^rounded-full$/),
        countRegex(s.text, /\b(NEW|FLAGSHIP|AI-POWERED|BETA|COMING SOON|HOT|PRO)\b/),
      ),
  },
  {
    id: 'uniform-radius',
    category: 'components',
    severity: 'low',
    label: 'Default 8px radius on everything',
    why: 'The shadcn --radius default applied uniformly, or mismatched radii with no logic.',
    fix: 'Use one radius scale mapped by role.',
    detect: (s) => countClass(s.classAttrs, /^rounded(-md|-lg)$/),
  },

  // ---- ICONS & IMAGERY ----------------------------------------------------
  {
    id: 'sparkles-icon',
    category: 'icon',
    severity: 'high',
    label: 'Sparkles / ✦ AI icon',
    why: 'The Sparkles glyph is the reflexive "this is AI" decoration.',
    fix: 'Drop the sparkle; use a literal icon for the actual feature.',
    detect: (s) =>
      merge(
        countRegex(s.html, /lucide-sparkles|"[^"]*[Ss]parkles?[^"]*"|<title>\s*sparkles/i),
        countRegex(s.text, /[✨✳✴✦✧]/),
      ),
  },
  {
    id: 'lucide-default-set',
    category: 'icon',
    severity: 'low',
    label: 'Default lucide icon set',
    why: 'lucide everywhere with the same handful reused (Zap, Rocket, Shield, CheckCircle, ArrowRight).',
    fix: 'Use a curated/custom set with one stroke width; one literal icon per concept.',
    detect: (s) => countRegex(s.html, /lucide[- ](zap|rocket|shield|check-circle|arrow-right|star|bolt)/gi),
  },
  {
    id: 'unsplash-stock',
    category: 'icon',
    severity: 'medium',
    label: 'Generic Unsplash / undraw imagery',
    why: 'Diverse-team-laughing, abstract-tech stock and isometric undraw scenes stand in for a real product.',
    fix: 'Show one true, high-res product view above the fold.',
    detect: (s) => countRegex(s.html, /images\.unsplash\.com|source\.unsplash|undraw\.co|storyset\.com/gi),
  },

  // ---- MOTION -------------------------------------------------------------
  {
    id: 'animate-pulse',
    category: 'motion',
    severity: 'critical',
    label: 'Pulsating dot / animate-pulse',
    why: 'HARD BAN. Any infinite-loop pulse/ping on status, live, unread, or presence is wrong — a static chip says the same thing.',
    fix: 'Make it static: a plain colored dot, chip, or number.',
    detect: (s) => countClass(s.classAttrs, /^animate-pulse$/),
  },
  {
    id: 'animate-ping',
    category: 'motion',
    severity: 'critical',
    label: 'Pinging indicator / animate-ping',
    why: 'HARD BAN alongside animate-pulse — a throbbing attention magnet while the user does nothing.',
    fix: 'Make it static.',
    detect: (s) => countClass(s.classAttrs, /^animate-ping$/),
  },
  {
    id: 'gratuitous-infinite-motion',
    category: 'motion',
    severity: 'medium',
    label: 'Gratuitous infinite animation',
    why: 'bounce / spin / float / animated gradient loops that earn nothing.',
    fix: 'Tie motion to a real state change or remove it.',
    detect: (s) => countClass(s.classAttrs, /^animate-(bounce|spin|float|wiggle|gradient)$/),
  },
  {
    id: 'hover-scale-everything',
    category: 'motion',
    severity: 'low',
    label: 'hover:scale on every card',
    why: 'Reflexive hover scale-105 on every card, plus other decorative hover jumps.',
    fix: 'Reserve effects for genuine interaction and one signature moment.',
    detect: (s) => countClass(s.classAttrs, /^hover:scale-(105|110|125)$/),
  },
  {
    id: 'transition-all',
    category: 'motion',
    severity: 'low',
    label: 'transition-all with one default curve',
    why: 'transition-all + a single default duration/ease on everything.',
    fix: 'Transition specific properties with tuned curves.',
    detect: (s) => countClass(s.classAttrs, /^transition-all$/),
  },
  {
    id: 'reduced-motion-missing',
    category: 'motion',
    severity: 'medium',
    label: 'prefers-reduced-motion never honored',
    why: 'Animations present but no reduced-motion fallback.',
    fix: 'Gate all non-essential motion behind prefers-reduced-motion.',
    detect: (s) => {
      const hasMotion =
        countClass(s.classAttrs, /^(animate-|transition)/).count > 0;
      const honored = /prefers-reduced-motion/i.test(s.css || '');
      return { count: hasMotion && !honored ? 1 : 0, samples: hasMotion && !honored ? ['no @media (prefers-reduced-motion) rule found'] : [] };
    },
  },

  // ---- COPY & TONE --------------------------------------------------------
  {
    id: 'buzzword-soup',
    category: 'copy',
    severity: 'high',
    label: 'Buzzword soup',
    why: 'Empower / Seamless / Effortless / Unlock / Elevate / Revolutionize / Leverage / Supercharge / Harness.',
    fix: 'Replace each with something verifiable; show the artifact.',
    detect: (s) =>
      countRegex(
        s.text,
        /\b(empower|seamless(ly)?|effortless(ly)?|unlock|elevate|revolutioniz\w+|leverage|supercharge|turbocharge|harness|streamline|unleash|transform your|reimagine|frictionless|skyrocket|10x|next[- ]level|boost your|accelerate your|optimize your|take .{1,20} to the next level)\b/i,
      ),
  },
  {
    id: 'stacked-superlatives',
    category: 'copy',
    severity: 'medium',
    label: 'Stacked superlatives',
    why: 'unprecedented, revolutionary, cutting-edge, world-class, production-grade, best-in-class.',
    fix: 'Replace with a real, sourced claim.',
    detect: (s) =>
      countRegex(
        s.text,
        /\b(unprecedented|revolutionary|cutting[- ]edge|world[- ]class|production[- ]grade|best[- ]in[- ]class|next[- ]generation|game[- ]chang\w+|state[- ]of[- ]the[- ]art|industry[- ]leading|enterprise[- ]grade|blazing[- ]fast|lightning[- ]fast|unrivaled|unmatched|unparalleled)\b/i,
      ),
  },
  {
    id: 'todays-fast-paced',
    category: 'copy',
    severity: 'high',
    label: 'Prose tics ("in today\'s fast-paced world")',
    why: 'Memorized filler openers with zero information.',
    fix: 'Cut them; lead with the concrete promise.',
    detect: (s) =>
      countRegex(
        s.text,
        /in today'?s (fast[- ]paced|digital|ever[- ]changing|modern) world|in an era where|now more than ever/gi,
      ),
  },
  {
    id: 'not-just-x-its-y',
    category: 'copy',
    severity: 'medium',
    label: '"It\'s not just X, it\'s Y" construction',
    why: 'A memorized rhetorical template.',
    fix: 'State the claim plainly.',
    detect: (s) => countRegex(s.text, /it'?s not just [^.,]{2,40},?\s*it'?s/gi),
  },
  {
    id: 'whether-youre',
    category: 'copy',
    severity: 'low',
    label: '"Whether you\'re A or B..." opener',
    why: 'A stock way to fake broad appeal.',
    fix: 'Speak to one real user with specifics.',
    detect: (s) => countRegex(s.text, /whether you'?re/gi),
  },
  {
    id: 'generic-cta',
    category: 'copy',
    severity: 'medium',
    label: 'Generic CTA ("Get Started" / "Learn More")',
    why: 'Every button says the same content-free thing.',
    fix: 'Use action + outcome, and read the rendered button.',
    detect: (s) => countRegex(s.text, /\b(get started( free)?|learn more|try it free|sign up free)\b/gi),
  },
  {
    id: 'exclamation-overuse',
    category: 'copy',
    severity: 'low',
    label: 'Exclamation overuse',
    why: 'Manufactured enthusiasm.',
    fix: 'Cut nearly all of them; let the claim carry weight.',
    detect: (s) => {
      const r = countRegex(s.text, /!/);
      // Only a tell past a threshold.
      return r.count >= 4 ? r : { count: 0, samples: [] };
    },
  },
  {
    id: 'category-abstraction-headline',
    category: 'copy',
    severity: 'high',
    claudeOnly: true,
    label: 'Category-abstraction headline',
    why: '"Transform your workflow" / "The future of X" — would fit any company if you swapped one noun.',
    fix: 'Lead with the concrete, testable promise unique to this product.',
  },

  // ---- PLACEHOLDER LEAKAGE (smoking gun) ----------------------------------
  {
    id: 'placeholder-leakage',
    category: 'placeholder',
    severity: 'critical',
    label: 'Unrendered placeholder leaked to production',
    why: 'Proof no human opened the render: {{TOKENS}}, [Object Object], lorem ipsum, undefined/NaN, example.com, dead href="#".',
    fix: 'Open the render and replace every slot with real content.',
    detect: (s) =>
      merge(
        countRegex(s.html, /\{\{[^}]{1,40}\}\}|\[Object Object\]|\byour company\b|\[feature\]|lorem ipsum|hello@example\.com/gi),
        countRegex(s.text, /\b(undefined|NaN)\b/g),
        countRegex(s.html, /href=["']#["']/gi),
      ),
  },

  // ---- ACCESSIBILITY ------------------------------------------------------
  {
    id: 'missing-alt-text',
    category: 'a11y',
    severity: 'medium',
    label: 'Images missing alt text',
    why: 'Invisible in the render, so AI never notices it is absent.',
    fix: 'Add real alt text, or aria-hidden on decorative graphics.',
    detect: (s) => {
      const imgs = (s.html || '').match(/<img\b[^>]*>/gi) || [];
      const missing = imgs.filter((t) => !/\balt\s*=/.test(t));
      return { count: missing.length, samples: missing.slice(0, 4).map((t) => t.slice(0, 70)) };
    },
  },
  {
    id: 'focus-outline-removed',
    category: 'a11y',
    severity: 'medium',
    label: 'Focus ring removed with no replacement',
    why: 'focus:outline-none / outline:none with no focus-visible ring breaks keyboard nav.',
    fix: 'Keep a real focus-visible ring at 4.5:1.',
    detect: (s) => {
      const removed = merge(
        countClass(s.classAttrs, /^focus:outline-none$/),
        countRegex(s.css, /outline:\s*none|outline:\s*0/gi),
      );
      const replaced = /focus-visible|focus:ring|:focus-visible/i.test((s.css || '') + ' ' + (s.classAttrs || []).join(' '));
      return replaced ? { count: 0, samples: [] } : removed;
    },
  },

  // ---- DEPLOYMENT & TRUST -------------------------------------------------
  {
    id: 'builder-subdomain',
    category: 'deploy',
    severity: 'medium',
    label: 'Lives on a builder subdomain',
    why: '*.vercel.app / *.lovable.app / *.v0.build / *.netlify.app means nobody finished it.',
    fix: 'Ship on a real domain.',
    detect: (s) =>
      merge(
        countRegex(s.url || '', /\.(vercel\.app|lovable\.app|v0\.build|netlify\.app|onrender\.com|webflow\.io)\b/i),
        countRegex(s.html, /<link[^>]+rel=["']canonical["'][^>]+\.(vercel\.app|lovable\.app|v0\.build|netlify\.app)/i),
      ),
  },

  // ---- MISSING STATES (judgment) -----------------------------------------
  {
    id: 'happy-path-only',
    category: 'states',
    severity: 'medium',
    claudeOnly: true,
    label: 'Only the happy path built',
    why: 'No empty state, no error state, no skeleton, no optimistic UI — the deepest AI tell.',
    fix: 'Build the unglamorous states: empty, error, loading skeleton, optimistic update.',
  },

  // ---- LAYOUT SKELETON (judgment) ----------------------------------------
  {
    id: 'ai-landing-skeleton',
    category: 'layout',
    severity: 'high',
    claudeOnly: true,
    label: 'The canonical AI landing skeleton',
    why: 'Sticky nav → AI pill → centered hero + two buttons → logo strip → 3-col grid → bento → stat band → testimonials → 3-tier pricing → FAQ → CTA band → fat footer.',
    fix: 'Lead with the one section that proves this specific product; cut the template rest.',
  },

  // ===== EXPANDED CATALOG =====================================================

  // ---- TYPOGRAPHY ---------------------------------------------------------
  {
    id: 'tracked-uppercase-eyebrow',
    category: 'type',
    severity: 'high',
    label: 'Tracked uppercase eyebrow / kicker',
    why: 'A small letter-spaced ALL-CAPS label sitting above the headline (often in an accent color or mono) is one of the most reflexive AI/Framer-template tells.',
    fix: 'Fold the kicker into the headline, or make it sentence case at normal tracking. At most one per page.',
    detect: (s) =>
      merge(
        countAttrAll(s.classAttrs, [/\buppercase\b/, /\btracking-(wide|wider|widest)\b/]),
        countAttrAll(s.classAttrs, [/\buppercase\b/, /\btext-(xs|sm)\b/, /\bfont-(mono|semibold|bold)\b/]),
        countRegex(s.css, /uppercase[^}]{0,120}letter-spacing|letter-spacing[^}]{0,120}uppercase/i),
      ),
  },
  {
    id: 'pure-black-white',
    category: 'color',
    severity: 'low',
    label: 'Raw #000 / #fff instead of tuned neutrals',
    why: 'Pure black on pure white (or the reverse) instead of tuned near-neutrals reads flat and harsh.',
    fix: 'Use off-white on near-black; never raw extremes.',
    detect: (s) => countRegex(s.css, /#000000\b|#ffffff\b|:\s*#000\b|:\s*#fff\b/gi),
  },

  // ---- COPY & TONE --------------------------------------------------------
  {
    id: 'ai-cliche-phrases',
    category: 'copy',
    severity: 'high',
    label: 'AI cliche phrases',
    why: 'Stock LLM connective tissue: "dive in", "delve", "when it comes to", "say goodbye to", "look no further", "imagine a world", "the truth is".',
    fix: 'Cut them; say the specific thing.',
    detect: (s) =>
      countRegex(
        s.text,
        /\b(dive in|dive into|delve|let'?s face it|when it comes to|say goodbye to|look no further|imagine a world|the truth is|here'?s the thing|at the end of the day|rest assured|needless to say)\b/gi,
      ),
  },
  {
    id: 'ready-to-cta',
    category: 'copy',
    severity: 'medium',
    label: '"Ready to..." CTA band',
    why: 'A rhetorical "Ready to get started?" band before the footer is the template closing CTA.',
    fix: 'Replace with a concrete, specific invitation tied to the product.',
    detect: (s) => countRegex(s.text, /ready to \w+[^.?!]{0,30}\?/gi),
  },
  {
    id: 'join-thousands',
    category: 'copy',
    severity: 'medium',
    label: '"Join thousands..." vague social proof',
    why: 'Crowd-size social proof with no real number or names.',
    fix: 'Name a real customer or cite a sourced number, or cut it.',
    detect: (s) => countRegex(s.text, /join (thousands|millions|\d[\d,]*\+?) of|used by (thousands|millions|teams)/gi),
  },
  {
    id: 'trust-badges-unproven',
    category: 'deploy',
    severity: 'medium',
    label: '"Trusted by / As seen in" with no proof',
    why: 'Trust theater: logos or claims with no real relationship or link.',
    fix: 'Only show real, provable customer logos and press.',
    detect: (s) => countRegex(s.text, /\b(trusted by|as seen in|as featured in|backed by|loved by teams)\b/gi),
  },
  {
    id: 'no-credit-card',
    category: 'copy',
    severity: 'low',
    label: '"No credit card required" microcopy',
    why: 'Reflexive SaaS-template microcopy under the signup CTA.',
    fix: 'Drop it unless it is a real differentiator.',
    detect: (s) => countRegex(s.text, /no credit card( required| needed)?|free forever|cancel anytime/gi),
  },
  {
    id: 'everything-you-need',
    category: 'copy',
    severity: 'medium',
    label: '"Everything you need" / "All-in-one" headline',
    why: 'Category-abstraction headline template that would fit any product.',
    fix: 'Lead with the one concrete thing this product does.',
    detect: (s) =>
      countRegex(s.text, /everything you need to|all[- ]in[- ]one (platform|solution|tool|app)|the only \w+ you'?ll ever need/gi),
  },

  // ---- LAYOUT & STRUCTURE -------------------------------------------------
  {
    id: 'sticky-everything',
    category: 'layout',
    severity: 'low',
    label: 'Sticky nav / sticky everything',
    why: 'position:sticky applied reflexively to nav, sidebars, and CTAs.',
    fix: 'Make one element sticky if it earns it, not everything.',
    detect: (s) => merge(countClass(s.classAttrs, /^sticky$/), countRegex(s.css, /position:\s*sticky/gi)),
  },
  {
    id: 'single-centered-container',
    category: 'layout',
    severity: 'low',
    label: 'One centered max-width container everywhere',
    why: 'max-w-7xl mx-auto on every section, no asymmetry or full-bleed.',
    fix: 'Vary widths; use full-bleed and asymmetry deliberately.',
    detect: (s) => countClass(s.classAttrs, /^max-w-(5xl|6xl|7xl|screen-xl|screen-2xl)$/),
  },
  {
    id: 'bento-grid',
    category: 'layout',
    severity: 'medium',
    label: 'Bento grid filler',
    why: 'A bento grid where equal-weight cells are just filler wearing a trendy name.',
    fix: 'Use bento only when one cell genuinely deserves the big span.',
    detect: (s) => countClass(s.classAttrs, /^(col-span-2|row-span-2)$/),
  },

  // ---- COMPONENTS & CHROME ------------------------------------------------
  {
    id: 'left-border-accent',
    category: 'components',
    severity: 'low',
    label: 'Left-border accent bar',
    why: 'Multicolored left-border "bookmark" bars fighting the corner radius.',
    fix: 'Remove, or make the accent a real semantic signal.',
    detect: (s) => countClass(s.classAttrs, /^border-l-(2|4|8)$/),
  },
  {
    id: 'gradient-icon-tile',
    category: 'icon',
    severity: 'medium',
    label: 'Gradient icon tile',
    why: 'The rounded-square gradient tile behind a lucide icon, part of the Sparkles+AI fingerprint.',
    fix: 'Use a flat, literal icon; drop the gradient chip.',
    detect: (s) => countAttrAll(s.classAttrs, [/\brounded-(lg|xl|2xl)\b/, /\bbg-gradient-to-/]),
  },
  {
    id: 'all-button-variants',
    category: 'components',
    severity: 'low',
    claudeOnly: true,
    label: 'Every button variant on one screen',
    why: 'primary + secondary + outline + ghost all present with no hierarchy, so nothing leads.',
    fix: 'One primary action per view; demote the rest.',
  },

  // ---- MOTION -------------------------------------------------------------
  {
    id: 'scroll-reveal-everything',
    category: 'motion',
    severity: 'medium',
    label: 'Scroll fade-in-up on every section',
    why: 'One global whileInView / AOS fade-up variant applied to every section.',
    fix: 'Animate one focal moment; render the rest instantly.',
    detect: (s) =>
      merge(
        countClass(s.classAttrs, /^(animate-fade|animate-in|fade-up|fade-in-up)$/),
        countRegex(s.html, /data-aos=|whileInView|framer-motion/gi),
      ),
  },
  {
    id: 'logo-marquee',
    category: 'motion',
    severity: 'low',
    label: 'Auto-scrolling logo marquee',
    why: 'A marquee logo scroller looping forever.',
    fix: 'Show a static, honest logo row.',
    detect: (s) => merge(countClass(s.classAttrs, /^animate-(marquee|scroll)$/), countRegex(s.html, /marquee/gi)),
  },
  {
    id: 'typewriter-hero',
    category: 'motion',
    severity: 'low',
    claudeOnly: true,
    label: 'Typewriter / rotating-word hero',
    why: 'A hero headline that types itself out or cycles through words is decorative motion, not communication.',
    fix: 'State the one headline plainly.',
  },

  // ---- ICONOGRAPHY & IMAGERY ---------------------------------------------
  {
    id: 'hand-drawn-doodle',
    category: 'icon',
    severity: 'medium',
    claudeOnly: true,
    label: 'Hand-drawn arrow / scribble doodle',
    why: 'A squiggly hand-drawn arrow or circle pointing at a CTA or eyebrow is a Framer/template flourish.',
    fix: 'Remove it; let layout and hierarchy direct attention.',
  },
  {
    id: 'tilted-browser-mockup',
    category: 'icon',
    severity: 'low',
    claudeOnly: true,
    label: 'Tilted 3D browser mockup',
    why: 'A floating product screenshot in a tilted 3D browser frame (often a fake UI).',
    fix: 'Show the real product flat and legible.',
  },

  // ---- ACCESSIBILITY ------------------------------------------------------
  {
    id: 'skipped-heading-levels',
    category: 'a11y',
    severity: 'low',
    label: 'Skipped heading levels',
    why: 'Headings chosen by size (h1 -> h3/h4), breaking the semantic outline.',
    fix: 'Use a semantic heading order; style with classes, not tag level.',
    detect: (s) => {
      const seq = ((s.html || '').match(/<h([1-6])\b/gi) || []).map((t) => Number(t.replace(/\D/g, '')));
      let skips = 0;
      let prev = 0;
      const samples = [];
      for (const lvl of seq) {
        if (prev && lvl > prev + 1) {
          skips++;
          if (samples.length < 4) samples.push(`h${prev} -> h${lvl}`);
        }
        prev = lvl;
      }
      return { count: skips, samples };
    },
  },
  {
    id: 'missing-lang',
    category: 'a11y',
    severity: 'low',
    label: 'Missing <html lang>',
    why: 'No lang attribute on <html>, hurting screen readers and translation.',
    fix: 'Add lang="en" (or the real language) to <html>.',
    detect: (s) => ({ count: /<html\b[^>]*\blang=/i.test(s.html || '') ? 0 : 1, samples: [] }),
  },

  // ---- DEPLOYMENT & TRUST -------------------------------------------------
  {
    id: 'default-page-title',
    category: 'deploy',
    severity: 'medium',
    label: 'Default framework page title',
    why: 'Title left as "Vite App", "Create Next App", "React App", "Home", or empty.',
    fix: 'Write a real, specific <title>.',
    detect: (s) => {
      const t = (s.title || '').trim();
      const bad = /^(vite app|create next app|react app|next app|home|untitled|document|my app|app)$/i.test(t);
      return { count: bad ? 1 : 0, samples: bad ? [t || '(empty)'] : [] };
    },
  },
  {
    id: 'missing-meta-description',
    category: 'deploy',
    severity: 'low',
    label: 'Missing meta description',
    why: 'No meta description in the head — the default framework template was never filled in.',
    fix: 'Add a real description and Open Graph tags.',
    detect: (s) => ({ count: /<meta[^>]+name=["']description["']/i.test(s.html || '') ? 0 : 1, samples: [] }),
  },
  {
    id: 'stale-copyright-year',
    category: 'deploy',
    severity: 'low',
    label: 'Stale copyright year',
    why: 'A copyright year older than the current year in the footer.',
    fix: 'Use the current year (or a range) in the footer.',
    detect: (s) => {
      const now = new Date().getFullYear();
      const yrs = [...String(s.text || '').matchAll(/(?:©|copyright)\s*(20\d{2})/gi)].map((m) => Number(m[1]));
      const stale = yrs.filter((y) => y < now);
      return { count: stale.length, samples: stale.slice(0, 3).map(String) };
    },
  },
];

// Convenience: the subset with real detectors, and the judgment-only subset.
export const MECHANICAL_TELLS = TELLS.filter((t) => typeof t.detect === 'function');
export const JUDGMENT_TELLS = TELLS.filter((t) => t.claudeOnly);
