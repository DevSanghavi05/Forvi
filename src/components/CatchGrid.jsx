import { useEffect, useRef } from 'react';

// the signs of AI / vibe-coded sites that Forvi strips out
const TELLS = [
  'purple gradients',
  'em dashes',
  'floating chat buttons',
  'pulsing dots',
  'sparkle icons',
  'glassmorphism',
  'gradient text',
  'bento grids',
  '3-column feature grids',
  'aurora blobs',
  'hover scale-105',
  'fade-up on scroll',
  'generic stock photos',
  'lucide icons everywhere',
  'rounded-2xl cards',
  'neon on dark',
  'glowing shadows',
  'radial glow orbs',
  '“Now with AI” badges',
  'tilted browser mockups',
  'typewriter hero text',
  'confetti on click',
  'lorem ipsum',
  'Inter everywhere',
  '135° gradients',
  'invented stats',
  'gradient buttons',
  'undraw illustrations',
  'marquee logo walls',
  'placeholder avatars'
];

const ROW_COUNT = 15;

// build ROW_COUNT rows, each a rotated slice of the pool so they read differently
const ROWS = Array.from({ length: ROW_COUNT }, (_, r) => {
  const out = [];
  for (let i = 0; i < TELLS.length; i++) {
    out.push(TELLS[(i + r * 5) % TELLS.length]);
  }
  return out;
});

export default function CatchGrid({ reduceMotion = false }) {
  const sectionRef = useRef(null);
  const rowRefs = useRef([]);

  useEffect(() => {
    if (reduceMotion) return undefined;
    let raf = 0;
    const range = 320;

    const update = () => {
      raf = 0;
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const center = rect.top + rect.height / 2;
      let p = (vh / 2 - center) / (vh / 2 + rect.height / 2);
      p = Math.max(-1, Math.min(1, p));
      rowRefs.current.forEach((row, i) => {
        if (!row) return;
        const dir = i % 2 === 0 ? 1 : -1;
        const base = ((i * 137) % 220) - 110;
        row.style.transform = `translate3d(${base + p * range * dir}px,0,0)`;
      });
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [reduceMotion]);

  return (
    <section className="catch" ref={sectionRef}>
      <div className="catch-rows" aria-hidden="true">
        {ROWS.map((row, i) => (
          <div
            className="catch-row"
            key={i}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
          >
            {[0, 1].map((dup) => (
              <span className="catch-line" key={dup}>
                {row.map((t, j) => (
                  <span className="catch-tell" key={j}>
                    {t}
                  </span>
                ))}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="catch-overlay">
        <h2 className="catch-title">What Forvi catches</h2>
        <p className="catch-sub">
          Thousands of the little tells that give AI away, found and stripped
          from every page you publish.
        </p>
      </div>
    </section>
  );
}
