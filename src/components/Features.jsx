import { useEffect, useRef, useState } from 'react';

const FEATURES = [
  {
    lead: 'Scan every',
    highlight: 'page',
    body: 'Forvi crawls your whole site and flags the thousands of small tells that read as machine generated.'
  },
  {
    lead: 'Rewrite',
    highlight: 'in place',
    body: 'Approved fixes are applied straight to your content, keeping your layout, links, and formatting intact.'
  },
  {
    lead: 'Publish with',
    highlight: 'confidence',
    body: 'Track a humanity score for every page and watch it climb as Forvi cleans up your library.'
  }
];

export default function Features() {
  // `active` drives the copy (can be -1 = nothing centred, so text greys out)
  const [active, setActive] = useState(0);
  // `shot` drives the image and never clears, so a screenshot is always shown
  const [shot, setShot] = useState(0);
  const refs = useRef([]);

  useEffect(() => {
    const visible = new Map();
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          visible.set(Number(e.target.dataset.index), e.isIntersecting);
        });
        // active only while a feature's copy is in the centre band; when the
        // copy scrolls out of it, nothing is active and everything reads grey
        let next = -1;
        visible.forEach((vis, idx) => {
          if (vis) next = idx;
        });
        setActive(next);
        if (next >= 0) setShot(next);
      },
      { rootMargin: '-35% 0px -35% 0px', threshold: 0 }
    );
    refs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <section className="features">
      <div className="features-inner">
        <div className="features-visual">
          <div className="visual-box">
            {FEATURES.map((f, i) => (
              <div
                key={f.highlight}
                className={`shot ${i === shot ? 'is-active' : ''}`}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>

        <div className="features-copy">
          {FEATURES.map((f, i) => (
            <div key={f.highlight} className={`feature ${i === active ? 'is-active' : ''}`}>
              <div
                className="feature-content"
                data-index={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
              >
                <h3 className="feature-title">
                  {f.lead} {f.highlight}
                </h3>
                <p className="feature-body">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
