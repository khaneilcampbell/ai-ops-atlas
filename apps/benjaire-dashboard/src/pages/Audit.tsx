import { useState } from 'preact/hooks';
import { api, type AuditEntry } from '../api';
import { ErrorNotice, Skeleton, TableWrap } from '../components/ui';
import { dateTime } from '../format';
import { useApi } from '../hooks';

const ACTION: Record<string, string> = {
  'expense.create': 'Added expense',
  'expense.update': 'Edited expense',
  'expense.delete': 'Deleted expense',
};

function pretty(raw: string | null): string {
  if (!raw) return '—';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function Audit() {
  const { data, error, loading, reload } = useApi(() => api.audit(), [], 0);
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [done, setDone] = useState(false);
  const entries = [...(data?.entries ?? []), ...more];

  async function loadMore() {
    const last = entries[entries.length - 1];
    const next = await api.audit(last?.id);
    setMore((m) => [...m, ...next.entries]);
    if (next.entries.length < 50) setDone(true);
  }

  return (
    <>
      <header class="page-head">
        <span class="label">Admin</span>
        <h1>Audit log</h1>
        <p>Every change made in the dashboard, who made it, and what it was before and after. Entries can't be edited or deleted.</p>
      </header>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data ? (
        <Skeleton lines={5} />
      ) : entries.length === 0 ? (
        <div class="empty compact">
          <strong>No changes yet</strong>
          <span class="muted">Adding, editing or deleting an expense creates the first entry.</span>
        </div>
      ) : (
        <TableWrap label="Audit entries">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td class="num" style={{ whiteSpace: 'nowrap' }}>
                    {dateTime(e.at)}
                  </td>
                  <td>{e.actor}</td>
                  <td>{ACTION[e.action] ?? e.action}</td>
                  <td>
                    <details>
                      <summary>Before and after</summary>
                      <div class="grid cols-2" style={{ marginTop: '8px' }}>
                        <div>
                          <span class="label">Before</span>
                          <pre class="diff">{pretty(e.before)}</pre>
                        </div>
                        <div>
                          <span class="label">After</span>
                          <pre class="diff">{pretty(e.after)}</pre>
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {entries.length >= 50 && !done && (
        <button class="btn" type="button" onClick={loadMore}>
          Load older entries
        </button>
      )}
    </>
  );
}
