// The deterministic half of the engine. Runs every mechanical detector in the
// catalog over a ScrapeResult, then folds in a few computed-style signals that
// class-name scanning can miss on CSS-in-JS sites.
//
// Output: a flat list of findings, one per tell type that fired:
//   { id, category, severity, label, why, fix, count, samples, source }
// `source` is 'rules' here; the Claude layer adds 'claude' findings later.

import { MECHANICAL_TELLS } from '../tells/catalog.js';

export function runRules(scrape) {
  const findings = [];

  for (const tell of MECHANICAL_TELLS) {
    let r;
    try {
      r = tell.detect(scrape) || { count: 0, samples: [] };
    } catch {
      r = { count: 0, samples: [] };
    }
    if (r.count > 0) {
      findings.push({
        id: tell.id,
        category: tell.category,
        severity: tell.severity,
        label: tell.label,
        why: tell.why,
        fix: tell.fix,
        count: r.count,
        samples: r.samples || [],
        source: 'rules',
      });
    }
  }

  // --- computed-style signals ------------------------------------------------
  const sig = scrape.signals || {};

  // Floating action / chat button (fixed-position, small, pill-round).
  if (sig.fixedRoundBtns > 0) {
    findings.push({
      id: 'floating-chat-button',
      category: 'components',
      severity: 'medium',
      label: 'Floating chat / action button',
      why: 'A fixed round bubble in the corner is a canonical bolt-on AI-widget tell.',
      fix: 'Fold the action into the page flow, or remove it.',
      count: sig.fixedRoundBtns,
      samples: [`${sig.fixedRoundBtns} fixed round element(s) in a corner`],
      source: 'rules',
    });
  }

  // Computed gradients beyond what the class scan caught (CSS-in-JS, custom CSS).
  const gradFinding = findings.find((f) => f.id === 'purple-indigo-gradient');
  if (sig.gradientEls > (gradFinding ? gradFinding.count : 0)) {
    if (gradFinding) {
      gradFinding.count = sig.gradientEls;
      if (!gradFinding.samples.length) gradFinding.samples.push(`${sig.gradientEls} gradient element(s)`);
    } else if (sig.gradientEls >= 2) {
      findings.push({
        id: 'computed-gradients',
        category: 'color',
        severity: 'medium',
        label: 'Decorative gradients',
        why: 'Multiple gradient fills detected in computed styles.',
        fix: 'Keep gradient to at most one intentional place.',
        count: sig.gradientEls,
        samples: [`${sig.gradientEls} gradient element(s)`],
        source: 'rules',
      });
    }
  }

  // Colored shadows via computed styles.
  const shadowFinding = findings.find((f) => f.id === 'colored-glow-shadow');
  if (sig.coloredShadowEls > 0 && !shadowFinding) {
    findings.push({
      id: 'colored-glow-shadow',
      category: 'color',
      severity: 'medium',
      label: 'Colored / glowing shadows',
      why: 'A colored bloom under an element implies no consistent light source.',
      fix: 'Use a neutral low-opacity shadow implying one light source.',
      count: sig.coloredShadowEls,
      samples: [`${sig.coloredShadowEls} element(s) with a colored shadow`],
      source: 'rules',
    });
  }

  // Backdrop-blur via computed styles (augment the class-based finding).
  const blurFinding = findings.find((f) => f.id === 'glassmorphism-everywhere');
  if (sig.blurEls > (blurFinding ? blurFinding.count : 0)) {
    if (blurFinding) blurFinding.count = sig.blurEls;
    else if (sig.blurEls >= 2) {
      findings.push({
        id: 'glassmorphism-everywhere',
        category: 'color',
        severity: 'medium',
        label: 'Glassmorphism / backdrop-blur surfaces',
        why: 'Frosted blur used as a default surface is a canonical dark-AI look.',
        fix: 'Frost at most one real overlay; make everything else solid.',
        count: sig.blurEls,
        samples: [`${sig.blurEls} blurred surface(s)`],
        source: 'rules',
      });
    }
  }

  return findings;
}
