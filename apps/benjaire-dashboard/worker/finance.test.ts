import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentMonthNY, isDate, previousMonth, summarizeMonth, validateExpense, type Expense } from './finance.ts';

const base = { kind: 'recurring', cadence: 'monthly', category: 'software', vendor: 'n8n Cloud', amount_cents: 2400, start_date: '2026-10-01' };

test('validates a recurring expense and cleans text', () => {
  const { expense, errors } = validateExpense({ ...base, vendor: '  n8n\u0000 Cloud ', description: 'Automation\nplan' });
  assert.deepEqual(errors, {});
  assert.equal(expense?.vendor, 'n8n Cloud');
  assert.equal(expense?.description, 'Automation plan');
  assert.equal(expense?.end_date, null);
});

test('rejects bad amounts, dates and categories', () => {
  for (const amount_cents of [0, -5, 12.5, '2400', 100_000_001]) {
    assert.ok(validateExpense({ ...base, amount_cents }).errors.amount_cents, String(amount_cents));
  }
  assert.ok(validateExpense({ ...base, start_date: '2026-02-30' }).errors.start_date);
  assert.ok(validateExpense({ ...base, category: 'toString' }).errors.category);
  assert.ok(validateExpense({ ...base, cadence: undefined }).errors.cadence);
  assert.ok(validateExpense({ ...base, end_date: '2026-09-01' }).errors.end_date);
  assert.ok(validateExpense({ ...base, kind: 'one_time', cadence: null, end_date: '2026-12-01' }).errors.end_date);
  assert.ok(validateExpense({ ...base, product_key: 'Flow Starter!' }).errors.product_key);
  assert.ok(validateExpense(null).errors.kind);
});

test('one-time expenses never carry a cadence', () => {
  const { expense } = validateExpense({ ...base, kind: 'one_time', cadence: 'monthly' });
  assert.equal(expense?.cadence, null);
});

const e = (over: Partial<Expense>): Expense => ({
  id: crypto.randomUUID(), kind: 'recurring', cadence: 'monthly', category: 'software', vendor: 'v', description: '',
  amount_cents: 1000, start_date: '2026-01-15', end_date: null, product_key: null, ...over,
});

test('monthly plans count from start month through end month', () => {
  const x = e({ start_date: '2026-03-20', end_date: '2026-05-02' });
  assert.equal(summarizeMonth([x], '2026-02').lines.length, 0);
  assert.equal(summarizeMonth([x], '2026-03').totals.accrual_cents, 1000);
  assert.equal(summarizeMonth([x], '2026-05').totals.cash_cents, 1000);
  assert.equal(summarizeMonth([x], '2026-06').lines.length, 0);
});

test('annual plans spread cost by 12 and bill cash yearly', () => {
  const x = e({ cadence: 'annual', amount_cents: 10_000, start_date: '2025-11-05' });
  const nov = summarizeMonth([x], '2026-11');
  assert.equal(nov.totals.accrual_cents, 833);
  assert.equal(nov.totals.cash_cents, 10_000);
  const dec = summarizeMonth([x], '2026-12');
  assert.equal(dec.totals.cash_cents, 0);
  assert.equal(dec.totals.recurring_run_rate_cents, 833);
});

test('one-time expenses count only in their month', () => {
  const x = e({ kind: 'one_time', cadence: null, amount_cents: 50_000, start_date: '2026-10-09' });
  assert.equal(summarizeMonth([x], '2026-10').totals.one_time_cents, 50_000);
  assert.equal(summarizeMonth([x], '2026-10').totals.recurring_run_rate_cents, 0);
  assert.equal(summarizeMonth([x], '2026-11').lines.length, 0);
});

test('totals add up across mixed lines and every summary states its rules', () => {
  const s = summarizeMonth([e({}), e({ cadence: 'annual', amount_cents: 1200 }), e({ kind: 'one_time', cadence: null, start_date: '2026-10-01' })], '2026-10');
  assert.deepEqual(s.totals, { accrual_cents: 2100, cash_cents: 2000, recurring_run_rate_cents: 1100, one_time_cents: 1000 });
  assert.ok(s.rules.length >= 3);
});

test('month helpers', () => {
  assert.equal(previousMonth('2026-01'), '2025-12');
  assert.equal(previousMonth('2026-10'), '2026-09');
  assert.equal(currentMonthNY(new Date('2026-11-01T03:00:00Z')), '2026-10'); // still Oct 31 in New York
  assert.ok(isDate('2028-02-29'));
  assert.ok(!isDate('2027-02-29'));
});
