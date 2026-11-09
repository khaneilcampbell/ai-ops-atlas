// Finance module logic: validation and calculations for manual expenses.
// Pure (no Cloudflare APIs) so every figure can be unit-tested and every
// result carries the rule that produced it. Money is integer cents.

export const CATEGORIES = {
  software: 'Software and subscriptions',
  hosting: 'Hosting and infrastructure',
  ai: 'AI services',
  payments: 'Payment fees',
  marketing: 'Marketing',
  legal: 'Legal and accounting',
  contractors: 'Contractors',
  equipment: 'Equipment',
  office: 'Office',
  other: 'Other',
} as const;
export type Category = keyof typeof CATEGORIES;

export const LIMITS = { vendor: 120, description: 500, maxCents: 100_000_000 } as const;

export interface ExpenseInput {
  kind: 'recurring' | 'one_time';
  cadence: 'monthly' | 'annual' | null;
  category: Category;
  vendor: string;
  description: string;
  amount_cents: number;
  start_date: string;
  end_date: string | null;
  product_key: string | null;
}

export interface Expense extends ExpenseInput {
  id: string;
}

export type ExpenseErrors = Partial<Record<keyof ExpenseInput, string>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PRODUCT_RE = /^[a-z0-9_-]{1,40}$/;

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function validateExpense(body: unknown): { expense?: ExpenseInput; errors: ExpenseErrors } {
  const errors: ExpenseErrors = {};
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  const kind = b.kind === 'recurring' || b.kind === 'one_time' ? b.kind : null;
  if (!kind) errors.kind = 'Choose recurring or one time.';

  let cadence: ExpenseInput['cadence'] = null;
  if (kind === 'recurring') {
    if (b.cadence === 'monthly' || b.cadence === 'annual') cadence = b.cadence;
    else errors.cadence = 'Choose monthly or annual billing.';
  }

  const category = typeof b.category === 'string' && Object.hasOwn(CATEGORIES, b.category) ? (b.category as Category) : null;
  if (!category) errors.category = 'Choose a category.';

  const vendor = cleanText(b.vendor, LIMITS.vendor);
  if (!vendor) errors.vendor = 'Enter who you pay.';
  const description = cleanText(b.description, LIMITS.description);

  const amount = b.amount_cents;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > LIMITS.maxCents) {
    errors.amount_cents = 'Enter an amount between $0.01 and $1,000,000.';
  }

  if (!isDate(b.start_date)) errors.start_date = kind === 'one_time' ? 'Enter the date it was paid.' : 'Enter the first billing date.';

  let endDate: string | null = null;
  if (b.end_date !== undefined && b.end_date !== null && b.end_date !== '') {
    if (kind !== 'recurring') errors.end_date = 'Only recurring expenses have an end date.';
    else if (!isDate(b.end_date)) errors.end_date = 'Enter a valid end date.';
    else if (isDate(b.start_date) && b.end_date < b.start_date) errors.end_date = 'The end date is before the start date.';
    else endDate = b.end_date;
  }

  let productKey: string | null = null;
  if (b.product_key !== undefined && b.product_key !== null && b.product_key !== '') {
    if (typeof b.product_key === 'string' && PRODUCT_RE.test(b.product_key)) productKey = b.product_key;
    else errors.product_key = 'Use lowercase letters, numbers, dashes or underscores.';
  }

  if (Object.keys(errors).length) return { errors };
  return {
    expense: {
      kind: kind!,
      cadence,
      category: category!,
      vendor,
      description,
      amount_cents: amount as number,
      start_date: b.start_date as string,
      end_date: endDate,
      product_key: productKey,
    },
    errors,
  };
}

export interface ExpenseLine {
  id: string;
  vendor: string;
  category: Category;
  kind: ExpenseInput['kind'];
  cadence: ExpenseInput['cadence'];
  product_key: string | null;
  /** Cost recognised this month (annual plans spread evenly over 12 months). */
  accrual_cents: number;
  /** Cash actually paid this month (annual plans in their billing month). */
  cash_cents: number;
  rule: string;
}

export interface MonthSummary {
  month: string;
  lines: ExpenseLine[];
  totals: {
    accrual_cents: number;
    cash_cents: number;
    recurring_run_rate_cents: number;
    one_time_cents: number;
  };
  rules: string[];
}

const monthOf = (date: string) => date.slice(0, 7);

/** Months between two YYYY-MM values (b - a). */
function monthDiff(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

export const SUMMARY_RULES = [
  'Monthly plans count their full amount every month from the start month to the end month.',
  'Annual plans: cost per month is the annual amount ÷ 12, rounded to the cent. Cash is the full amount in the start month and every 12 months after.',
  'One-time expenses count in full in the month they were paid.',
  'Recurring run rate is the monthly cost of every recurring plan active in the month.',
];

export function summarizeMonth(expenses: Expense[], month: string): MonthSummary {
  const lines: ExpenseLine[] = [];
  for (const e of expenses) {
    const start = monthOf(e.start_date);
    let accrual = 0;
    let cash = 0;
    let rule = '';
    if (e.kind === 'one_time') {
      if (start !== month) continue;
      accrual = cash = e.amount_cents;
      rule = 'One time, paid this month';
    } else {
      const active = monthDiff(start, month) >= 0 && (!e.end_date || monthDiff(month, monthOf(e.end_date)) >= 0);
      if (!active) continue;
      if (e.cadence === 'monthly') {
        accrual = cash = e.amount_cents;
        rule = 'Monthly plan';
      } else {
        accrual = Math.round(e.amount_cents / 12);
        cash = monthDiff(start, month) % 12 === 0 ? e.amount_cents : 0;
        rule = cash ? 'Annual plan ÷ 12, billed this month' : 'Annual plan ÷ 12';
      }
    }
    lines.push({
      id: e.id,
      vendor: e.vendor,
      category: e.category,
      kind: e.kind,
      cadence: e.cadence,
      product_key: e.product_key,
      accrual_cents: accrual,
      cash_cents: cash,
      rule,
    });
  }
  const sum = (f: (l: ExpenseLine) => number) => lines.reduce((t, l) => t + f(l), 0);
  return {
    month,
    lines,
    totals: {
      accrual_cents: sum((l) => l.accrual_cents),
      cash_cents: sum((l) => l.cash_cents),
      recurring_run_rate_cents: sum((l) => (l.kind === 'recurring' ? l.accrual_cents : 0)),
      one_time_cents: sum((l) => (l.kind === 'one_time' ? l.accrual_cents : 0)),
    },
    rules: SUMMARY_RULES,
  };
}

/** The month before a YYYY-MM month. */
export function previousMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Current month in New York, where Benjaire keeps its books. */
export function currentMonthNY(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}
