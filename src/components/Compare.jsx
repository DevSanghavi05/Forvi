import { useEffect, useRef, useState } from 'react';

function AiMock() {
  return (
    <div className="mock mock--ai">
      <div className="mock-nav">
        <span className="mock-logo" />
        <span className="mock-links">
          <i />
          <i />
          <i />
        </span>
        <span className="mock-navcta" />
      </div>

      <div className="mock-hero">
        <span className="mock-pill">✦ Now with AI</span>
        <div className="mock-h1">Unlock Your Full Potential</div>
        <div className="mock-sub">
          In today’s fast-paced world, leverage our seamless, best-in-class
          solution to revolutionize the way you work.
        </div>
        <div className="mock-btn">Get Started ✦</div>
      </div>

      <div className="mock-cards">
        {['Seamless', 'Empower', 'Revolutionize'].map((label) => (
          <div className="mock-card" key={label}>
            <span className="mock-card-ico" />
            <span className="mock-card-label">{label}</span>
            <span className="mock-card-line" />
            <span className="mock-card-line short" />
          </div>
        ))}
      </div>
    </div>
  );
}

function HumanMock() {
  return (
    <div className="mock mock--human">
      <div className="mock-nav">
        <span className="mock-logo" />
        <span className="mock-links">
          <i />
          <i />
          <i />
        </span>
        <span className="mock-navcta" />
      </div>

      <div className="mock-hero mock-hero--human">
        <div className="mock-h1">Make every page sound human</div>
        <div className="mock-sub">
          Forvi removes the machine-written patterns from every page you
          publish, so your words read like you wrote them.
        </div>
        <div className="mock-btn">See how it works</div>
      </div>

      <div className="mock-cards">
        {['Scan', 'Rewrite', 'Publish'].map((label) => (
          <div className="mock-card" key={label}>
            <span className="mock-card-ico">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none">
                <path
                  d="M5 12.5l4 4 10-10"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="mock-card-label">{label}</span>
            <span className="mock-card-line" />
            <span className="mock-card-line short" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Compare() {
  // `wipe` = how far the human side has swept in from the LEFT (0 -> 100)
  const [wipe, setWipe] = useState(0);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onScroll = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      const p = total > 0 ? scrolled / total : 0;
      setWipe(p * 100);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <section className="cmp-section">
      <div className="cmp-scroll" ref={wrapRef}>
        <div className="cmp-stage">
          <div className="cmp-head">
            <h2 className="cmp-title">Same site, without the tells</h2>
            <p className="cmp-sub">
              Keep scrolling to watch the same page shed its AI tells.
            </p>
          </div>

          <div className="cmp">
            <div className="cmp-layer cmp-after">
              <HumanMock />
            </div>

            <div
              className="cmp-layer cmp-before"
              style={{ clipPath: `inset(0 0 0 ${wipe}%)` }}
            >
              <AiMock />
            </div>

            <div className="cmp-divider" style={{ left: `${wipe}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
