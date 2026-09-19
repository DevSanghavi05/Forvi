// The Claude half of the hybrid engine.
//
//   judge(scrape, ruleFindings)  — adds the judgment-only tells the deterministic
//                                  rules can't see (layout skeleton, headline
//                                  abstraction, tone, missing states), grounded in
//                                  the field guide.
//   humanize(scrape, findings)   — rewrites the page into a single self-contained,
//                                  accessible HTML document with every tell removed,
//                                  preserving the site's real content and structure.
//
// The Anthropic key is read from the environment (server-side only) — it never
// reaches the browser. Model defaults to claude-opus-4-8; override with FORVI_MODEL.

import Anthropic from '@anthropic-ai/sdk';
import { FIELD_GUIDE_SYSTEM } from '../tells/fieldguide.js';
import { JUDGMENT_TELLS } from '../tells/catalog.js';

const MODEL = process.env.FORVI_MODEL || 'claude-opus-4-8';

let clientInstance = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('Server is missing ANTHROPIC_API_KEY. Add it to server .env.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!clientInstance) clientInstance = new Anthropic();
  return clientInstance;
}

// Keep prompt input bounded — a landing page's visible copy is what the judgment
// pass needs, not the entire minified DOM.
function clip(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '\n…[truncated]' : str;
}

// ---------------------------------------------------------------------------
// judgment pass — structured output
// ---------------------------------------------------------------------------

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          category: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          count: { type: 'integer' },
          why: { type: 'string' },
          fix: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['id', 'label', 'category', 'severity', 'count', 'why', 'fix', 'evidence'],
      },
    },
  },
  required: ['findings'],
};

export async function judge(scrape, ruleFindings = []) {
  const ruleSummary = ruleFindings.length
    ? ruleFindings.map((f) => `${f.label} (${f.count})`).join(', ')
    : 'none';

  const candidates = JUDGMENT_TELLS.map((t) => `- ${t.id} [${t.severity}] ${t.label}: ${t.why}`).join('\n');

  const prompt = `A deterministic rules engine already scanned this page for mechanical AI tells.
It found: ${ruleSummary}.

Your job: identify only the JUDGMENT tells below that the rules engine cannot detect,
by reading the page's actual content and structure. Do NOT re-report the mechanical
tells above. Only report a tell if you have real evidence for it on THIS page.

Judgment tells to consider (use these exact ids):
${candidates}

For each tell you find, set count to how many times it occurs (1 if it's a whole-page
property like the layout skeleton), and put the concrete evidence (a quote, a section
name, a described element) in evidence. If none apply, return an empty findings array.

PAGE URL: ${scrape.url}
PAGE TITLE: ${scrape.title || '(none)'}

VISIBLE COPY:
${clip(scrape.text, 6000)}

SECTION/CLASS HINTS (sampled class attributes):
${clip((scrape.classAttrs || []).slice(0, 120).join(' | '), 2000)}`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
    system: FIELD_GUIDE_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = res.content.find((b) => b.type === 'text');
  let parsed;
  try {
    parsed = JSON.parse(textBlock ? textBlock.text : '{"findings":[]}');
  } catch {
    parsed = { findings: [] };
  }

  return (parsed.findings || []).map((f) => ({
    id: f.id,
    label: f.label,
    category: f.category,
    severity: f.severity,
    why: f.why,
    fix: f.fix,
    count: f.count || 1,
    samples: f.evidence ? [f.evidence] : [],
    source: 'claude',
  }));
}

// ---------------------------------------------------------------------------
// rewrite pass — streamed (output can be a large HTML document)
// ---------------------------------------------------------------------------

export async function humanize(scrape, findings = []) {
  const tellList = findings.length
    ? findings.map((f) => `- ${f.label}${f.count > 1 ? ` (x${f.count})` : ''}: ${f.fix}`).join('\n')
    : '- (no mechanical tells flagged; still apply the field guide)';

  const prompt = `Rewrite the page below into ONE self-contained, production-quality HTML document
that reads as if a senior designer and a real human writer made it — with every AI
tell removed. This is the "after" the user downloads and can ship.

Requirements:
- Return a COMPLETE HTML document starting with <!doctype html>. Inline all CSS in a
  single <style> block. No external stylesheets, no CDN scripts, no remote fonts.
- Preserve the site's REAL content, sections, and intent. Do not invent products,
  features, stats, testimonials, or customer logos. If the original had fabricated or
  placeholder content, cut it rather than replacing it with new fabrications.
- Remove every tell flagged below and any others you spot from the field guide.
- Commit to one ownable, accessible palette (check 4.5:1 contrast). No purple/indigo
  hero gradient, no gradient-clipped text, no animate-pulse/ping, no em dashes.
- Left-align body copy, one primary CTA, real semantic headings, alt text, a visible
  focus style, and a responsive layout that works on a 360px-wide phone with no
  horizontal scroll. Honor prefers-reduced-motion for any transition you keep.
- Rewrite headlines and copy to lead with the concrete, product-specific promise;
  strip buzzwords and filler.

Output ONLY the HTML document. No markdown fences, no commentary before or after.

Tells to remove on this page:
${tellList}

PAGE URL: ${scrape.url}
PAGE TITLE: ${scrape.title || '(none)'}

ORIGINAL RENDERED HTML (may be truncated):
${clip(scrape.html, 90000)}

ORIGINAL VISIBLE COPY (authoritative for wording — use this real content):
${clip(scrape.text, 8000)}`;

  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: FIELD_GUIDE_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  const final = await stream.finalMessage();
  const textBlock = final.content.find((b) => b.type === 'text');
  let html = textBlock ? textBlock.text.trim() : '';

  // Strip an accidental markdown fence if the model added one.
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();

  return {
    html,
    model: MODEL,
    truncated: (scrape.html || '').length > 90000,
    stopReason: final.stop_reason,
  };
}
