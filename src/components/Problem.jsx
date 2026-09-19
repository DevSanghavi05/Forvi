import { useEffect, useLayoutEffect, useRef } from 'react';

/* The problem section: large copy that darkens word by word as you scroll.
   Words ahead of the reading point sit dimmed; words behind land in full ink.
   Written to read like a slow-dawning dread for a founder scrolling past. */
const BLOCKS = [
  'Most of the web now reads like a machine wrote it, and your visitors can tell in seconds.',
  'Bounce rates climb more than 75% on sites that feel AI generated.',
  'Search buries them too, pushing AI pages far below both SEO and GEO rankings.',
  'So the traffic never comes, and a product worth finding goes unseen.'
];

// dim (far) and ink (read) colours, interpolated per word
const DIM = [196, 199, 206];
const INK = [21, 23, 28];
// how many words softly straddle the reading edge, and where the reveal completes
const SPAN = 6;
const FINISH = 0.9;

function colorFor(t) {
  const c = DIM.map((d, k) => Math.round(d + (INK[k] - d) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export default function Problem({ reduceMotion }) {
  const wrapRef = useRef(null);
  const wordEls = useRef([]);

  // build paragraphs of words carrying a continuous global index
  let idx = 0;
  const paras = BLOCKS.map((b) => b.split(' ').map((w) => ({ w, i: idx++ })));
  const total = idx;

  // paint the initial dimmed state before first paint (no flash; readable if JS is off)
  useLayoutEffect(() => {
    if (reduceMotion) {
      wordEls.current.forEach((el) => el && (el.style.color = colorFor(1)));
      return;
    }
    wordEls.current.forEach((el) => el && (el.style.color = colorFor(0)));
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const range = rect.height - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(range, 1));
      const p = range > 0 ? scrolled / range : 0;
      const reveal = Math.min(p / FINISH, 1) * (total + SPAN);
      for (let i = 0; i < wordEls.current.length; i++) {
        const node = wordEls.current[i];
        if (!node) continue;
        const t = Math.min(Math.max((reveal - i) / SPAN, 0), 1);
        node.style.color = colorFor(t);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [reduceMotion, total]);

  return (
    <section className="problem" aria-label="The problem">
      <div className="problem-scroll" ref={wrapRef}>
        <div className="problem-stage">
          <div className="problem-copy">
            {paras.map((para, pi) => (
              <p className="problem-p" key={pi}>
                {para.map((word) => (
                  <span
                    className="problem-word"
                    key={word.i}
                    ref={(el) => {
                      wordEls.current[word.i] = el;
                    }}
                  >
                    {word.w}{' '}
                  </span>
                ))}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
