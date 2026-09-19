// The Claude judgment pass: adds the judgment-only tells the deterministic rules
// can't see (layout skeleton, headline abstraction, tone, missing states),
// grounded in the field guide. The rewrite/removal now lives in patch.js
// (surgical patching of the original page).

import { getClient, MODEL } from './anthropic.js';
import { FIELD_GUIDE_SYSTEM } from '../tells/fieldguide.js';
import { JUDGMENT_TELLS } from '../tells/catalog.js';

// Keep prompt input bounded — a page's visible copy is what the judgment pass
// needs, not the entire minified DOM.
function clip(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '\n…[truncated]' : str;
}

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

  const res = await getClient().messages.create({
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
