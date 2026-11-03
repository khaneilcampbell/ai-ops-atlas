import { useState } from 'preact/hooks';
import { api, ApiError, type Expense, type MonthSummary } from '../api';
import { Dialog, ErrorNotice, Skeleton, StatePill, TableWrap } from '../components/ui';
import { date, delta, money, monthLabel, shiftMonth } from '../format';
import { useApi } from '../hooks';
import { navigate } from '../router';

type Draft = Omit<Expense, 'id' | 'amount_cents'> & { amount: string };

const blank = (): Draft => ({
  kind: 'recurring',
  cadence: 'monthly',
  category: 'software',
  vendor: '',
  description: '',
  amount: '',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  product_key: null,
});

/** "1,234.50" → 123450. Returns null for anything that isn't a plain amount. */
export function toCents(input: string): number | null {
  const clean = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

function ExpenseForm({ initial, categories, onDone, onCancel }: { initial?: Expense; categories: Record<string, string>; onDone: () => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(() => (initial ? { ...initial, amount: (initial.amount_cents / 100).toFixed(2) } : blank()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  async function submit(e: Event) {
    e.preventDefault();
    const cents = toCents(d.amount);
    if (cents === null || cents <= 0) {
      setErrors({ amount_cents: 'Enter an amount such as 24 or 24.99.' });
      return;
    }
    const { amount: _amount, ...rest } = d;
    const body = { ...rest, amount_cents: cents, cadence: d.kind === 'recurring' ? d.cadence : null, end_date: d.kind === 'recurring' ? d.end_date || null : null };
    setSaving(true);
    setFailure(null);
    try {
      if (initial) await api.updateExpense(initial.id, body);
      else await api.createExpense(body);
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFailure(err.message);
      } else setFailure('Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  const field = (name: string) => ({ id: `exp-${name}`, 'aria-invalid': errors[name] ? (true as const) : undefined, 'aria-describedby': errors[name] ? `exp-${name}-err` : undefined });
  const err = (name: string) => errors[name] && <span id={`exp-${name}-err`} class="err">{errors[name]}</span>;

  return (
    <form class="form" onSubmit={submit} noValidate>
      {failure && (
        <div class="field wide">
          <ErrorNotice message={failure} />
        </div>
      )}
      <fieldset class="field wide" style={{ border: 0 }}>
        <legend>Type</legend>
        <div class="segmented" role="group" aria-label="Expense type">
          <button type="button" aria-pressed={d.kind === 'recurring'} onClick={() => set({ kind: 'recurring', cadence: d.cadence ?? 'monthly' })}>
            Recurring
          </button>
          <button type="button" aria-pressed={d.kind === 'one_time'} onClick={() => set({ kind: 'one_time', end_date: null })}>
            One time
          </button>
        </div>
      </fieldset>
      <div class="field">
        <label for="exp-vendor">Paid to</label>
        <input class="input" {...field('vendor')} value={d.vendor} maxLength={120} placeholder="For example, n8n Cloud" onInput={(e) => set({ vendor: e.currentTarget.value })} />
        {err('vendor')}
      </div>
      <div class="field">
        <label for="exp-amount_cents">Amount (USD)</label>
        <input class="input num" {...field('amount_cents')} inputMode="decimal" value={d.amount} placeholder="0.00" onInput={(e) => set({ amount: e.currentTarget.value })} />
        {err('amount_cents')}
      </div>
      <div class="field">
        <label for="exp-category">Category</label>
        <select class="select" {...field('category')} value={d.category} onChange={(e) => set({ category: e.currentTarget.value })}>
          {Object.entries(categories).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {err('category')}
      </div>
      {d.kind === 'recurring' && (
        <div class="field">
          <label for="exp-cadence">Billed</label>
          <select class="select" {...field('cadence')} value={d.cadence ?? 'monthly'} onChange={(e) => set({ cadence: e.currentTarget.value as Draft['cadence'] })}>
            <option value="monthly">Monthly</option>
            <option value="annual">Annually</option>
          </select>
          {err('cadence')}
        </div>
      )}
      <div class="field">
        <label for="exp-start_date">{d.kind === 'recurring' ? 'First billing date' : 'Date paid'}</label>
        <input class="input" type="date" {...field('start_date')} value={d.start_date} onInput={(e) => set({ start_date: e.currentTarget.value })} />
        {err('start_date')}
      </div>
      {d.kind === 'recurring' && (
        <div class="field">
          <label for="exp-end_date">Ends (optional)</label>
          <input class="input" type="date" {...field('end_date')} value={d.end_date ?? ''} onInput={(e) => set({ end_date: e.currentTarget.value || null })} />
          {err('end_date') || <span class="hint">Leave empty if it's ongoing.</span>}
        </div>
      )}
      <div class="field">
        <label for="exp-product_key">Product (optional)</label>
        <input class="input" {...field('product_key')} value={d.product_key ?? ''} placeholder="flow_starter" onInput={(e) => set({ product_key: e.currentTarget.value || null })} />
        {err('product_key') || <span class="hint">Links the cost to a product for profitability.</span>}
      </div>
      <div class="field wide">
        <label for="exp-description">Note (optional)</label>
        <textarea class="input" {...field('description')} value={d.description} maxLength={500} onInput={(e) => set({ description: e.currentTarget.value })} />
      </div>
      <div class="form-actions">
        <button class="btn primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add expense'}
        </button>
        <button class="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Figure({ label, value, formula, compare }: { label: string; value: string; formula: string; compare?: string }) {
  return (
    <div class="card figure">
      <span class="label">{label}</span>
      <span class="v num">{value}</span>
      {compare && <span class="muted num" style={{ fontSize: '12px' }}>{compare}</span>}
      <span class="formula">{formula}</span>
    </div>
  );
}

export function Finance({ month }: { month: string }) {
  const { data, error, loading, reload } = useApi(() => api.finance(month), [month], 0);
  const expenses = useApi(() => api.expenses(), [], 0);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    reload();
    expenses.reload();
  };
  const go = (m: string) => navigate(`/finance?month=${m}`);
  const prevLabel = monthLabel(shiftMonth(month, -1)).split(' ')[0];
  const cur: MonthSummary | undefined = data?.current;
  const prev = data?.previous;
  const categories = data?.categories ?? {};

  async function remove(id: string) {
    try {
      await api.deleteExpense(id);
      setNotice('Expense deleted. The audit log keeps a copy.');
      setConfirmDelete(null);
      refresh();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not delete.');
    }
  }

  return (
    <>
      <header class="page-head">
        <span class="label">Business</span>
        <h1>Finance</h1>
        <p>Expenses you enter by hand, and revenue from Stripe once it's connected. Every total shows the rule that produced it, and every change is in the audit log.</p>
      </header>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button class="btn icon" type="button" aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))}>
          ‹
        </button>
        <strong style={{ color: 'var(--ink)', minWidth: '140px', textAlign: 'center' }} aria-live="polite">
          {monthLabel(month)}
        </strong>
        <button class="btn icon" type="button" aria-label="Next month" onClick={() => go(shiftMonth(month, 1))}>
          ›
        </button>
        <span style={{ flex: 1 }} />
        <button class="btn primary" type="button" onClick={() => setEditing('new')}>
          Add expense
        </button>
      </div>

      {notice && (
        <div class="notice ok" role="status">
          {notice}
        </div>
      )}
      {error && <ErrorNotice message={error} onRetry={reload} />}

      {loading && !data ? (
        <Skeleton lines={4} />
      ) : (
        cur &&
        prev && (
          <>
            <section class="grid tiles" aria-label="Month totals">
              <Figure label="Operating expenses" value={money(cur.totals.accrual_cents)} compare={delta(cur.totals.accrual_cents, prev.totals.accrual_cents, prevLabel)} formula="Sum of cost recognised this month" />
              <Figure label="Cash paid out" value={money(cur.totals.cash_cents)} compare={delta(cur.totals.cash_cents, prev.totals.cash_cents, prevLabel)} formula="Annual plans count in their billing month" />
              <Figure label="Recurring run rate" value={money(cur.totals.recurring_run_rate_cents)} formula="Monthly cost of active recurring plans" />
              <Figure label="One-time this month" value={money(cur.totals.one_time_cents)} formula="One-time expenses paid this month" />
            </section>

            <section class="grid cols-2">
              <div class="card">
                <div class="card-head">
                  <h2>Revenue</h2>
                  <StatePill state="not_connected" />
                </div>
                <p class="muted">Revenue comes from Stripe (gross sales minus refunds and fees). It appears once the Stripe restricted key is connected. It is never entered by hand here.</p>
              </div>
              <div class="card">
                <div class="card-head">
                  <h2>Gross profit and cash flow</h2>
                  <StatePill state="not_connected" />
                </div>
                <p class="muted">
                  Gross profit = net revenue − expenses linked to a product. Cash flow = net revenue − cash paid out. Both need revenue first, so they stay
                  empty instead of showing a loss.
                </p>
              </div>
            </section>

            <section class="card">
              <div class="card-head">
                <h2>Expenses in {monthLabel(month)}</h2>
              </div>
              {cur.lines.length === 0 ? (
                <div class="empty compact">
                  <strong>No expenses this month</strong>
                  <span class="muted">Add subscriptions such as n8n, Cloudflare or Claude, and one-time costs such as legal fees.</span>
                </div>
              ) : (
                <TableWrap label="Expenses this month">
                  <table>
                    <thead>
                      <tr>
                        <th>Paid to</th>
                        <th>Category</th>
                        <th>Rule</th>
                        <th class="right">Cost this month</th>
                        <th class="right">Cash this month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cur.lines.map((l) => (
                        <tr key={l.id}>
                          <td>
                            {l.vendor}
                            {l.product_key && <span class="sub">Product: {l.product_key}</span>}
                          </td>
                          <td>{categories[l.category] ?? l.category}</td>
                          <td class="muted">{l.rule}</td>
                          <td class="right num">{money(l.accrual_cents)}</td>
                          <td class="right num">{money(l.cash_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              <details>
                <summary>How these numbers are calculated</summary>
                <ul style={{ paddingLeft: '18px', marginTop: '8px' }}>
                  {cur.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            </section>
          </>
        )
      )}

      <section class="card">
        <div class="card-head">
          <h2>All expenses</h2>
          <span class="muted">{expenses.data ? `${expenses.data.expenses.length} total` : ''}</span>
        </div>
        {expenses.error && <ErrorNotice message={expenses.error} onRetry={expenses.reload} />}
        {expenses.data && expenses.data.expenses.length === 0 && <p class="muted">Nothing entered yet.</p>}
        {expenses.data && expenses.data.expenses.length > 0 && (
          <TableWrap label="All expenses">
            <table>
              <thead>
                <tr>
                  <th>Paid to</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th class="right">Amount</th>
                  <th class="right">
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.data.expenses.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {x.vendor}
                      {x.description && <span class="sub">{x.description}</span>}
                    </td>
                    <td>{x.kind === 'one_time' ? 'One time' : x.cadence === 'annual' ? 'Annual' : 'Monthly'}</td>
                    <td class="num">
                      {date(x.start_date)}
                      {x.end_date ? ` to ${date(x.end_date)}` : x.kind === 'recurring' ? ', ongoing' : ''}
                    </td>
                    <td class="right num">{money(x.amount_cents)}</td>
                    <td class="right" style={{ whiteSpace: 'nowrap' }}>
                      {confirmDelete === x.id ? (
                        <>
                          <button class="btn danger" type="button" onClick={() => remove(x.id)}>
                            Delete {x.vendor}
                          </button>{' '}
                          <button class="btn ghost" type="button" onClick={() => setConfirmDelete(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <>
                          <button class="btn ghost" type="button" onClick={() => setEditing(x)} aria-label={`Edit ${x.vendor}`}>
                            Edit
                          </button>
                          <button class="btn ghost danger" type="button" onClick={() => setConfirmDelete(x.id)} aria-label={`Delete ${x.vendor}`}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>

      {editing && (
        <Dialog label={editing === 'new' ? 'Add expense' : 'Edit expense'} onClose={() => setEditing(null)}>
          <h2>{editing === 'new' ? 'Add expense' : `Edit ${editing.vendor}`}</h2>
          <ExpenseForm
            initial={editing === 'new' ? undefined : editing}
            categories={categories}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setNotice(editing === 'new' ? 'Expense added.' : 'Changes saved.');
              setEditing(null);
              refresh();
            }}
          />
        </Dialog>
      )}
    </>
  );
}
