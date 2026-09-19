import { useState } from 'react';

const FAQS = [
  {
    q: 'What exactly does Forvi change?',
    a: 'Forvi rewrites the phrasing, structure, and design patterns that read as machine generated. Your facts, links, and layout stay intact, and every change is yours to approve before it ships.'
  },
  {
    q: 'Will it change my meaning or tone?',
    a: 'No. Forvi matches your existing voice and only touches the tells. You review a clear before and after for each edit, so nothing goes live without your sign off.'
  },
  {
    q: 'How does it fit into my workflow?',
    a: 'Connect your site once. Forvi scans on every publish or deploy and surfaces the flagged pages, so cleaning up content becomes part of shipping instead of a separate chore.'
  },
  {
    q: 'Does it work with my stack?',
    a: 'Forvi runs on any site through a lightweight integration, from a CMS to a static build. If you can publish a page, Forvi can scan it.'
  },
  {
    q: 'Is my content private?',
    a: 'Your content is processed only to run the scan and is never used to train models. You stay in full control of what Forvi reads and rewrites.'
  }
];

export default function Faq() {
  const [open, setOpen] = useState(() => new Set());

  const toggle = (i) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section className="faq">
      <div className="faq-inner">
        <h2 className="faq-title">FAQ</h2>

        <div className="faq-list">
          {FAQS.map((item, i) => {
            const isOpen = open.has(i);
            return (
              <div className={`faq-item ${isOpen ? 'is-open' : ''}`} key={item.q}>
                <button
                  type="button"
                  className="faq-q"
                  aria-expanded={isOpen}
                  onClick={() => toggle(i)}
                >
                  <span className="faq-qtext">{item.q}</span>
                  <span className="faq-chevron" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
                      <path
                        d="M6 9l6 6 6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
                <div className="faq-panel">
                  <div className="faq-panel-inner">
                    <p className="faq-a">{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
