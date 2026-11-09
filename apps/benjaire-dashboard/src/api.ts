// Typed client for the dashboard's own API. The browser never talks to
// Cloudflare, Stripe, GitHub or n8n directly.

export type State = 'not_connected' | 'awaiting_sync' | 'live' | 'delayed' | 'failing' | 'manual' | 'empty' | 'estimated';

export interface Tile {
  key: string;
  label: string;
  unit: 'count' | 'usd_cents' | 'percent' | 'health';
  source: string;
  state: State;
  value: number | null;
  previous: number | null;
  note: string;
  href: string;
}

export interface Connection {
  key: 'cloudflare' | 'github' | 'n8n' | 'stripe';
  name: string;
  state: State;
  configured: boolean;
  missing: string[];
  last_ok_at: string | null;
  last_error: boolean;
  permissions: string[];
  provides: string[];
  interval_min: number;
  docs: string;
}

export interface Expense {
  id: string;
  kind: 'recurring' | 'one_time';
  cadence: 'monthly' | 'annual' | null;
  category: string;
  vendor: string;
  description: string;
  amount_cents: number;
  start_date: string;
  end_date: string | null;
  product_key: string | null;
}

export interface ExpenseLine {
  id: string;
  vendor: string;
  category: string;
  kind: Expense['kind'];
  cadence: Expense['cadence'];
  product_key: string | null;
  accrual_cents: number;
  cash_cents: number;
  rule: string;
}

export interface MonthSummary {
  month: string;
  lines: ExpenseLine[];
  totals: { accrual_cents: number; cash_cents: number; recurring_run_rate_cents: number; one_time_cents: number };
  rules: string[];
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before: string | null;
  after: string | null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly fields: Record<string, string> = {}) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError("Can't reach the dashboard. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: Record<string, string> };
  if (res.status === 401) throw new ApiError('Your session ended. Reload the page to sign in again.', 401);
  if (!res.ok || data.ok === false) throw new ApiError(data.error ?? `Request failed (${res.status}).`, res.status, data.fields);
  return data as T;
}

export const api = {
  me: () => request<{ email: string }>('/api/me'),
  overview: () => request<{ month: string; tiles: Tile[] }>('/api/overview'),
  connections: () => request<{ connections: Connection[] }>('/api/connections'),
  finance: (month: string) =>
    request<{ categories: Record<string, string>; current: MonthSummary; previous: MonthSummary; revenue: { state: State; source: string } }>(
      `/api/finance/summary?month=${encodeURIComponent(month)}`,
    ),
  expenses: () => request<{ expenses: Expense[] }>('/api/expenses'),
  createExpense: (e: Omit<Expense, 'id'>) => request<{ expense: Expense }>('/api/expenses', { method: 'POST', body: JSON.stringify(e) }),
  updateExpense: (id: string, e: Omit<Expense, 'id'>) =>
    request<{ expense: Expense }>(`/api/expenses/${id}`, { method: 'PUT', body: JSON.stringify(e) }),
  deleteExpense: (id: string) => request<{ ok: true }>(`/api/expenses/${id}`, { method: 'DELETE', body: '{}' }),
  audit: (before?: number) => request<{ entries: AuditEntry[] }>(`/api/audit?limit=50${before ? `&before=${before}` : ''}`),
};
