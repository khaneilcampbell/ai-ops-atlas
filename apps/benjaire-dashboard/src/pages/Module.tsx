import type { Connection } from '../api';
import { StatePill, TableWrap } from '../components/ui';
import type { ModuleDef } from '../modules';
import { moduleState } from '../modules';

/** A data module whose collector is not built or not connected yet. */
export function ModulePage({ module: m, connections }: { module: ModuleDef; connections: Connection[] | null }) {
  const state = moduleState(m, connections) ?? 'not_connected';
  const needed = m.sources.map((k) => connections?.find((c) => c.key === k)).filter(Boolean) as Connection[];
  return (
    <>
      <header class="page-head">
        <span class="label">{m.group}</span>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1>{m.label}</h1>
          <StatePill state={state} />
        </div>
        <p>{m.summary}</p>
      </header>

      <div class="empty">
        <strong>{state === 'not_connected' ? 'Not connected yet' : 'Waiting for the first sync'}</strong>
        <span class="muted">
          {state === 'not_connected'
            ? `This page needs ${needed.map((c) => c.name).join(' and ') || 'its source'}. Nothing is shown until real data arrives.`
            : 'The credential is in place. Figures appear after the first successful sync.'}
        </span>
        <a class="btn" href="/connections">
          Open Connections
        </a>
      </div>

      <section class="card">
        <h2>What this page will show</h2>
        <TableWrap label="Planned metrics">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Source</th>
                <th>Data type</th>
              </tr>
            </thead>
            <tbody>
              {m.metrics.map((x) => (
                <tr key={x.name}>
                  <td>{x.name}</td>
                  <td class="muted">{x.source}</td>
                  <td>
                    <StatePill state={x.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </>
  );
}
