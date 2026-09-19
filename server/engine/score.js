// Scoring — turns a flat list of findings into a single humanity score (0–100,
// higher = reads more human), a verdict label, and a per-category breakdown for
// the report UI.

import { SEVERITY_WEIGHT, CATEGORY_LABELS } from '../tells/catalog.js';

// Repeat instances of one tell hurt, but with diminishing returns — a page with
// 200 rounded-full pills shouldn't score infinitely worse than one with 20.
function countFactor(count) {
  return Math.min(1 + 0.5 * Math.log2(count + 1), 3);
}

export function scoreFindings(findings) {
  let penalty = 0;
  const byCategory = {};

  for (const f of findings) {
    const weight = SEVERITY_WEIGHT[f.severity] || SEVERITY_WEIGHT.low;
    const impact = weight * countFactor(f.count || 1);
    penalty += impact;

    const cat = f.category || 'other';
    if (!byCategory[cat]) {
      byCategory[cat] = { category: cat, label: CATEGORY_LABELS[cat] || cat, tells: 0, instances: 0, impact: 0 };
    }
    byCategory[cat].tells += 1;
    byCategory[cat].instances += f.count || 1;
    byCategory[cat].impact += impact;
  }

  // Saturating map: penalty 0 → 100, 120 → 50, 360 → 25. Never below 1.
  const score = Math.max(1, Math.round((100 * 120) / (120 + penalty)));

  const totalInstances = findings.reduce((n, f) => n + (f.count || 1), 0);
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;

  const categories = Object.values(byCategory)
    .map((c) => ({ ...c, impact: Math.round(c.impact) }))
    .sort((a, b) => b.impact - a.impact);

  return {
    score,
    verdict: verdictFor(score),
    totalTells: findings.length,
    totalInstances,
    criticalCount,
    categories,
  };
}

function verdictFor(score) {
  if (score >= 85) return { label: 'Reads human', tone: 'good' };
  if (score >= 65) return { label: 'Mostly human', tone: 'ok' };
  if (score >= 40) return { label: 'Noticeably AI', tone: 'warn' };
  return { label: 'Unmistakably AI-generated', tone: 'bad' };
}
