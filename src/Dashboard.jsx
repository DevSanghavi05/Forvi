import { useState } from 'react';
import Logo from './components/Logo';
import './Dashboard.css';

const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

function severityClass(sev) {
  return `sev-${sev || 'low'}`;
}

// A framed browser chrome around either the original screenshot or the
// humanized rewrite.
function Frame({ url, children }) {
  return (
    <div className="shot-frame">
      <div className="shot-bar">
        <span className="shot-dot" />
        <span className="shot-dot" />
        <span className="shot-dot" />
        <div className="shot-url">{url}</div>
      </div>
      <div className="shot-body">{children}</div>
    </div>
  );
}

export default function Dashboard({ user, onSignOut }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | scanning | done | error
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const [humanizeStatus, setHumanizeStatus] = useState('idle'); // idle | running | done | error
  const [humanizeError, setHumanizeError] = useState('');
  const [humanizedHtml, setHumanizedHtml] = useState('');
  const [view, setView] = useState('before'); // before | after

  const name = user?.name || 'Guest';
  const initial = (name.trim()[0] || 'G').toUpperCase();

  const scan = async (e) => {
    e.preventDefault();
    if (status === 'scanning' || !url.trim()) return;
    setStatus('scanning');
    setError('');
    setData(null);
    setHumanizedHtml('');
    setHumanizeStatus('idle');
    setHumanizeError('');
    setView('before');

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Scan failed.');
      setData(body);
      setStatus('done');
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setStatus('error');
    }
  };

  const humanize = async () => {
    if (!data?.scanId || humanizeStatus === 'running') return;
    setHumanizeStatus('running');
    setHumanizeError('');
    try {
      const res = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId: data.scanId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Humanize failed.');
      setHumanizedHtml(body.html);
      setHumanizeStatus('done');
      setView('after');
    } catch (err) {
      setHumanizeError(err.message || 'Something went wrong.');
      setHumanizeStatus('error');
    }
  };

  return (
    <div className="dash">
      <header className="dash-bar">
        <Logo />
        <div className="dash-user">
          {user?.picture ? (
            <img
              className="dash-avatar dash-avatar-img"
              src={user.picture}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="dash-avatar" aria-hidden="true">
              {initial}
            </span>
          )}
          <span className="dash-uname">{name}</span>
          <button className="dash-signout" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-head">
          <h1 className="dash-title">Scan your website</h1>
          <p className="dash-sub">
            Drop in a URL. Forvi renders the page, finds every AI tell, scores how
            human it reads, and rewrites it without them.
          </p>
        </div>

        <form className="dash-form" onSubmit={scan}>
          <span className="dash-input-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </span>
          <input
            className="dash-input"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="yoursite.com"
            aria-label="Website URL"
          />
          <button className="dash-run" type="submit" disabled={status === 'scanning'}>
            {status === 'scanning' ? 'Scanning…' : 'Scan'}
          </button>
        </form>

        {status === 'scanning' && (
          <div className="dash-scan">
            <div className="dash-scan-bar">
              <span />
            </div>
            <p>Rendering the page and checking it against the tell catalog…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="dash-banner dash-banner--error" role="alert">
            <strong>Couldn't scan that.</strong> {error}
          </div>
        )}

        {status === 'done' && data && (
          <section className="dash-result">
            <div className="dash-score">
              <div className="dash-score-row">
                <span className="dash-url">{data.url}</span>
                <span className="dash-badge">
                  {data.totalInstances} {data.totalInstances === 1 ? 'tell' : 'tells'} detected
                </span>
              </div>
              <div className="dash-meter">
                <div
                  className="dash-meter-fill"
                  style={{ width: `${Math.max(data.score, 4)}%` }}
                />
              </div>
              <div className="dash-score-legend">
                <span>
                  Humanity score <strong>{data.score}</strong>
                </span>
                <span className="dash-score-was">out of 100</span>
                <span className={`dash-verdict dash-verdict--${data.verdict?.tone}`}>
                  {data.verdict?.label}
                </span>
              </div>
              {!data.aiJudgment && (
                <p className="dash-note">
                  Deterministic scan only. Add ANTHROPIC_API_KEY on the server to
                  turn on AI judgment and rewriting.
                </p>
              )}
            </div>

            <div className="dash-grid">
              <div className="dash-preview">
                <div className="dash-preview-head">
                  <div className="dash-preview-tag">
                    {view === 'after' ? 'Humanized rewrite' : 'Original page'}
                  </div>
                  {humanizedHtml && (
                    <div className="dash-toggle" role="tablist" aria-label="Preview">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={view === 'before'}
                        className={view === 'before' ? 'is-active' : ''}
                        onClick={() => setView('before')}
                      >
                        Before
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={view === 'after'}
                        className={view === 'after' ? 'is-active' : ''}
                        onClick={() => setView('after')}
                      >
                        After
                      </button>
                    </div>
                  )}
                </div>

                <Frame url={data.url}>
                  {view === 'after' && humanizedHtml ? (
                    <iframe
                      className="shot-iframe"
                      title="Humanized preview"
                      srcDoc={humanizedHtml}
                      sandbox=""
                    />
                  ) : data.screenshot ? (
                    <img className="shot-img" src={data.screenshot} alt={`Screenshot of ${data.url}`} />
                  ) : (
                    <div className="shot-empty">No screenshot captured.</div>
                  )}
                </Frame>
              </div>

              <aside className="dash-tells">
                <h2 className="dash-tells-title">What Forvi detected</h2>
                {data.findings.length === 0 ? (
                  <p className="dash-empty">
                    No AI tells found. This page already reads human.
                  </p>
                ) : (
                  <ul className="dash-tells-list">
                    {data.findings.map((f) => (
                      <li key={f.id}>
                        <span
                          className={`dash-tell-dot ${severityClass(f.severity)}`}
                          title={SEV_LABEL[f.severity]}
                          aria-hidden="true"
                        />
                        <span className="dash-tell-label">
                          {f.label}
                          {f.source === 'claude' && <em className="dash-tell-ai"> · AI</em>}
                        </span>
                        <span className="dash-tell-count">{f.count}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {humanizeStatus === 'error' && (
                  <p className="dash-note dash-note--error">{humanizeError}</p>
                )}

                {humanizedHtml ? (
                  <a
                    className="dash-apply"
                    href={`/api/humanize/${data.scanId}/download`}
                    download="humanized-site.html"
                  >
                    Download humanized site
                  </a>
                ) : (
                  <button
                    className="dash-apply"
                    type="button"
                    onClick={humanize}
                    disabled={humanizeStatus === 'running' || data.findings.length === 0}
                  >
                    {humanizeStatus === 'running' ? 'Humanizing…' : 'Humanize this site'}
                  </button>
                )}
              </aside>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
