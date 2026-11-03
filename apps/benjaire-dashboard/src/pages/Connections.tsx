import type { Connection } from '../api';
import { ErrorNotice, Skeleton, StatePill } from '../components/ui';
import { dateTime } from '../format';

export function Connections({ connections, error, reload }: { connections: Connection[] | null; error: string | null; reload: () => void }) {
  return (
    <>
      <header class="page-head">
        <span class="label">Admin</span>
        <h1>Connections</h1>
        <p>
          Each data source, the read-only access it needs, and how fresh its data is. Credentials are stored as Worker secrets and are never sent to
          this page; it only knows whether each one is set.
        </p>
      </header>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {!connections && !error && <Skeleton lines={4} />}
      <div class="grid cols-2">
        {connections?.map((c) => (
          <section key={c.key} class="card" aria-labelledby={`conn-${c.key}`}>
            <div class="card-head">
              <h2 id={`conn-${c.key}`}>{c.name}</h2>
              <StatePill state={c.state} />
            </div>
            <div class="list">
              <div class="row">
                <span class="muted">Last successful sync</span>
                <span class="num">{c.last_ok_at ? dateTime(c.last_ok_at) : 'Never'}</span>
              </div>
              <div class="row">
                <span class="muted">Expected every</span>
                <span class="num">{c.interval_min} min</span>
              </div>
              {c.missing.length > 0 && (
                <div class="row">
                  <span class="muted">Missing secrets</span>
                  <span>
                    {c.missing.map((m) => (
                      <code key={m} class="kbd" style={{ marginLeft: '4px' }}>
                        {m}
                      </code>
                    ))}
                  </span>
                </div>
              )}
            </div>
            <details>
              <summary>Permissions and data</summary>
              <div class="grid" style={{ marginTop: '10px' }}>
                <div>
                  <span class="label">Minimum access</span>
                  <ul style={{ paddingLeft: '18px', marginTop: '6px' }}>
                    {c.permissions.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span class="label">Provides</span>
                  <p style={{ marginTop: '6px' }}>{c.provides.join(' · ')}</p>
                </div>
                <a href={c.docs} target="_blank" rel="noopener noreferrer">
                  How to create this credential ↗
                </a>
              </div>
            </details>
          </section>
        ))}
      </div>
    </>
  );
}
