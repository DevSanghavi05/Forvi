// Builds the "fix prompt" Forvi hands the user: a ready-to-paste instruction for
// Claude (or Claude Code, working on their own repo) that names every AI design
// tell the scan found on their site and tells Claude exactly how to remove it in
// the real source — plus the non-negotiable global de-AI rules so tells the audit
// couldn't see get fixed too. This is the product's deliverable now (the old
// downloadable patched HTML is gone): a scan turns into an actionable prompt.

// The universal rules mirror Forvi's own humanizer + the field guide, so pasting
// this prompt drives the same outcome across a whole codebase, not just the hero.
const GLOBAL_RULES = [
  'Color — kill the purple/indigo/violet "AI gradient" palette. Choose ONE intentional brand hue on desaturated neutrals; no 135° purple→blue hero gradient, no gradient-clipped headline text. **If the theme is purple, make it blue.**',
  'Shape — square off gratuitous `rounded-full` pills and badges into rectangles with a small, consistent radius. Keep avatars and status dots round; everything else gets one radius scale mapped by role.',
  'Icons — remove decorative default lucide/sparkle icons (Sparkles, Zap, Rocket, Shield, the AI-pill sparkle). Use a purposeful, literal icon per concept, one stroke width, or nothing.',
  'Type — drop the stock Inter/Geist default for a typeface with real character (a display + text pairing). Keep a real monospace stack for code. Set tight leading + negative tracking on big display text.',
  'Motion — remove every infinite pulse / ping / bounce / spin / marquee and the pulsating "live" dot; a static dot, chip, or number says the same thing. Reserve motion for one real interaction and honor prefers-reduced-motion.',
  'Copy — no em dashes; no buzzword/filler ("empower", "seamless", "effortless", "unlock", "supercharge", "in today\'s fast-paced world", "it\'s not just X, it\'s Y"); no invented round-number stats; no leaked placeholders ({{...}}, lorem ipsum, "Your Company"). Make every line concrete and specific to this product.',
  'Depth — one elevation scale; no colored/glowing shadows; no glassmorphism used as the default surface.',
  'States — build the unglamorous states an AI skips: content-shaped loading skeletons, a real empty state, and a real error state with a retry.',
  'Accessibility & mobile — 4.5:1 text contrast, a visible keyboard focus ring, real form labels and alt text, semantic headings, and a layout that genuinely reflows on a 320px phone with no horizontal scroll and 44px tap targets.',
];

export function buildFixPrompt({ url = '', findings = [], score, verdict, totalInstances } = {}) {
  const L = [];
  L.push('# Remove the AI design tells from my website');
  L.push('');
  L.push(
    `I built ${url || 'this site'} and it reads as AI-generated / "vibe-coded." I want it to look like a senior product designer made it by hand. Go through my actual source — components, CSS, Tailwind classes, design tokens, fonts — and remove every tell listed below. Fix the real source, not with an override stylesheet, and after each fix the tell must be genuinely gone while the page still looks intentional and cohesive (not just stripped bare).`,
  );
  L.push('');

  if (typeof score === 'number') {
    const v = verdict && verdict.label ? ` ("${verdict.label}")` : '';
    const inst = totalInstances ? ` across ${totalInstances} instance${totalInstances === 1 ? '' : 's'}` : '';
    L.push(
      `An automated audit scored it ${score}/100 for how human the design reads${v} and flagged ${findings.length} distinct tell type${findings.length === 1 ? '' : 's'}${inst}.`,
    );
    L.push('');
  }

  if (findings.length) {
    L.push('## The tells it found on this site — fix all of them');
    L.push('');
    findings.forEach((f, i) => {
      const inst = f.count ? ` (${f.count} instance${f.count === 1 ? '' : 's'})` : '';
      L.push(`${i + 1}. **${f.label}**${inst}`);
      if (f.why) L.push(`   - Why it's a tell: ${f.why}`);
      if (f.fix) L.push(`   - Fix: ${f.fix}`);
      const samples = (f.samples || []).filter(Boolean).slice(0, 3);
      if (samples.length) L.push(`   - Seen: ${samples.join(' · ')}`);
      L.push('');
    });
  }

  L.push("## Non-negotiable global rules (apply everywhere, even where the audit didn't flag them)");
  L.push('');
  for (const r of GLOBAL_RULES) L.push(`- ${r}`);
  L.push('');
  L.push(
    "Work through the list top to bottom. For each change, tell me the file and the before → after. Don't stop until every tell above is gone and the page looks like it was designed on purpose.",
  );

  return L.join('\n');
}
