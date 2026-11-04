import { api, type Connection, type Tile } from '../api';
import { ErrorNotice, Skeleton, StatePill } from '../components/ui';
import { delta, money, monthLabel, number, shiftMonth } from '../format';
import { useApi } from '../hooks';

function tileValue(t: Tile): string {
  if (t.value === null) return '—';
  if (t.unit === 'usd_cents') return money(t.value);
  if (t.unit === 'percent') return `${t.value.toFixed(1)}%`;
  return number(t.value);
}

export function Overview({ connections }: { connections: Connection[] | null }) {
  const { data, error, loading, reload } = useApi(() => api.overview());
  const attention = (connections ?? []).filter((c) => c.state !== 'live');

  return (
    <>
      <header class="page-head">
        <span class="label">Executive overview{data ? ` · ${monthLabel(data.month)}` : ''}</span>
        <h1>Overview</h1>
        <p>Every figure shows where it comes from and how fresh it is. Tiles stay empty until their source is connected, so nothing here is a placeholder number.</p>
      </header>

      {error && <ErrorNotice message={error} onRetry={reload} />}

      <section aria-label="Key figures" class="grid tiles">
        {loading && !data
          ? Array.from({ length: 8 }, (_, i) => (
              <div key={i} class="card">
                <Skeleton lines={3} />
              </div>
            ))
          : data?.tiles.map((t) => (
              <a key={t.key} class="card tile" href={t.href}>
                <div class="card-head">
                  <span class="label">{t.label}</span>
                  <StatePill state={t.state} />
                </div>
                <div class={`value num ${t.value === null ? 'none' : ''}`} aria-label={t.value === null ? 'No value' : undefined}>
                  {tileValue(t)}
                </div>
                <div class="delta num">
                  {t.value !== null && t.previous !== null ? delta(t.value, t.previous, monthLabel(shiftMonth(data.month, -1)).split(' ')[0]) : t.note}
                </div>
                <div class="src">Source: {t.source}</div>
              </a>
            ))}
      </section>

      <section class="grid two">
        <div class="card">
          <div class="card-head">
            <h2>Traffic and conversions</h2>
            <StatePill state={connections?.find((c) => c.key === 'cloudflare')?.state ?? 'not_connected'} />
          </div>
          <div class="empty">
            <strong>No traffic data yet</strong>
            <span class="muted">This chart fills in once Cloudflare is connected and its first sync finishes.</span>
            <a class="btn" href="/connections">See what's needed</a>
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <h2>Needs attention</h2>
          </div>
          {!connections ? (
            <Skeleton />
          ) : attention.length === 0 ? (
            <p class="muted">Every source is live.</p>
          ) : (
            <div class="list">
              {attention.map((c) => (
                <div key={c.key} class="row">
                  <a href="/connections">{c.name}</a>
                  <StatePill state={c.state} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
