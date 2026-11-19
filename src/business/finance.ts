import type { StoredTask } from "../tasks/types";
import { netCents } from "./revenue";
import type { Expense, ProductOpportunity, Sale } from "./types";

// Financial intelligence: deterministic reporting from real records. No model is called and nothing
// is estimated here: AI cost comes from usage the provider reported on Task Center tasks, and its
// basis (estimated from prices, or billed) is carried through so the screen can say which.
// Totals are kept per currency because Atlas never converts between currencies.
//
// Definitions (shown on screen as well, METRIC_DEFINITIONS):
// - Revenue here is net sales receipts (cash basis) from recorded orders, not recognised accounting revenue.
// - AI API and infrastructure expenses are expense records in those categories (from invoices or a
//   person's estimate). AI cost reported on Task Center tasks is shown beside them, never added, so
//   the same spend is not counted twice.

export const METRIC_DEFINITIONS: Record<string, string> = {
  gross: "Gross revenue: the amount customers paid on recorded orders, before refunds and fees.",
  refunds: "Refunds: money returned to customers on those orders.",
  fees: "Transaction fees: what the payment provider kept.",
  net: "Net revenue: gross less refunds and fees. Cash received, not recognised accounting revenue.",
  opex: "Operating expenses: every recorded expense in the period, actual and estimated.",
  ai: "AI API expenses: expenses in the AI and API category.",
  infra: "Infrastructure expenses: expenses in the infrastructure and hosting category.",
  productCost: "Product-specific costs: expenses recorded against a product.",
  contribution: "Contribution margin: net revenue less product-specific costs, as a share of net revenue.",
  profit: "Estimated operating profit: net revenue less operating expenses. An estimate, not an accounting result.",
  taskAi: "AI cost on tasks: what providers reported for Task Center runs. Shown for comparison, not added to expenses.",
};

export interface Period {
  /** Inclusive YYYY-MM-DD. */
  from: string;
  /** Inclusive YYYY-MM-DD. */
  to: string;
}

export const inPeriod = (date: string, p: Period) => date >= p.from && date <= p.to;

/** The calendar month containing `now`, as a period. */
export function monthOf(now: Date): Period {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
}

export interface CurrencyStatement {
  currency: string;
  orders: number;
  grossCents: number;
  refundCents: number;
  feeCents: number;
  netRevenueCents: number;
  operatingExpenseCents: number;
  /** Part of operating expenses that a person estimated rather than took from an invoice. */
  estimatedExpenseCents: number;
  /** Expenses recorded against a specific product. */
  productCostCents: number;
  /** Net revenue less product-specific costs. */
  contributionCents: number;
  /** Contribution as a share of net revenue; null with no net revenue. */
  contributionMargin: number | null;
  /** Net revenue less all operating expenses. Always an estimate: this is not accounting profit. */
  profitCents: number;
  /** Profit as a share of net revenue; null with no net revenue. */
  margin: number | null;
  /** Average net revenue per order; null with no orders. */
  averageOrderCents: number | null;
  expensesByCategory: Partial<Record<Expense["category"], number>>;
}

export interface AiCost {
  usd: number;
  /** Tasks that reported a cost in the period. */
  tasks: number;
  /** Whether any of the cost is an estimate from published prices. */
  estimated: boolean;
  completedTasks: number;
  /** AI cost spread over the completed tasks in the period; null with none. */
  perCompletedTaskUsd: number | null;
}

export interface Statement {
  period: Period;
  currencies: CurrencyStatement[];
  ai: AiCost;
  /** Count of test records left out, so the screen can say they were ignored. */
  testRecordsIgnored: number;
}

function emptyCurrency(currency: string): CurrencyStatement {
  return { currency, orders: 0, grossCents: 0, refundCents: 0, feeCents: 0, netRevenueCents: 0, operatingExpenseCents: 0, estimatedExpenseCents: 0, productCostCents: 0, contributionCents: 0, contributionMargin: null, profitCents: 0, margin: null, averageOrderCents: null, expensesByCategory: {} };
}

/** AI cost and cost per completed task, from usage recorded on tasks updated in the period. */
export function aiCost(tasks: readonly StoredTask[], p: Period): AiCost {
  let usd = 0, estimated = false;
  const costed = new Set<string>();
  for (const t of tasks) {
    for (const u of t.usage) {
      if (!u.cost || !inPeriod(u.recordedAt.slice(0, 10), p)) continue;
      usd += u.cost.usd;
      estimated ||= u.cost.basis === "estimated";
      costed.add(t.id);
    }
  }
  const completedTasks = tasks.filter((t) => t.status === "completed" && t.completedAt && inPeriod(t.completedAt.slice(0, 10), p)).length;
  usd = Math.round(usd * 10_000) / 10_000;
  return { usd, tasks: costed.size, estimated, completedTasks, perCompletedTaskUsd: completedTasks ? Math.round((usd / completedTasks) * 10_000) / 10_000 : null };
}

/** The statement for a period. Only real sales and expenses are counted. */
export function statement(sales: readonly Sale[], expenses: readonly Expense[], tasks: readonly StoredTask[], p: Period): Statement {
  const by = new Map<string, CurrencyStatement>();
  const get = (c: string) => by.get(c) ?? by.set(c, emptyCurrency(c)).get(c)!;
  let ignored = 0;
  for (const s of sales) {
    if (!inPeriod(s.date, p)) continue;
    if (s.provenance !== "real") { ignored += 1; continue; }
    const c = get(s.currency);
    c.orders += 1;
    c.grossCents += s.grossCents;
    c.refundCents += s.refundCents;
    c.feeCents += s.feeCents;
    c.netRevenueCents += netCents(s);
  }
  for (const e of expenses) {
    if (!inPeriod(e.date, p)) continue;
    if (e.provenance !== "real") { ignored += 1; continue; }
    const c = get(e.currency);
    c.operatingExpenseCents += e.amountCents;
    if (e.basis === "estimated") c.estimatedExpenseCents += e.amountCents;
    if (e.productRef) c.productCostCents += e.amountCents;
    c.expensesByCategory[e.category] = (c.expensesByCategory[e.category] ?? 0) + e.amountCents;
  }
  const currencies = [...by.values()]
    .map((c) => ({
      ...c,
      contributionCents: c.netRevenueCents - c.productCostCents,
      contributionMargin: c.netRevenueCents > 0 ? (c.netRevenueCents - c.productCostCents) / c.netRevenueCents : null,
      profitCents: c.netRevenueCents - c.operatingExpenseCents,
      margin: c.netRevenueCents > 0 ? (c.netRevenueCents - c.operatingExpenseCents) / c.netRevenueCents : null,
      averageOrderCents: c.orders ? Math.round(c.netRevenueCents / c.orders) : null,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { period: p, currencies, ai: aiCost(tasks, p), testRecordsIgnored: ignored };
}

export interface ProductRevenue {
  productRef: string;
  title: string;
  currency: string;
  orders: number;
  netRevenueCents: number;
  costCents: number;
}

/** Each product's real net revenue and directly attributed cost, per currency. */
export function productRevenue(products: readonly ProductOpportunity[], sales: readonly Sale[], expenses: readonly Expense[]): ProductRevenue[] {
  const title = new Map(products.map((p) => [p.productRef, p.title]));
  const rows = new Map<string, ProductRevenue>();
  const row = (ref: string, currency: string) => {
    const k = `${ref}\u0000${currency}`;
    return rows.get(k) ?? rows.set(k, { productRef: ref, title: title.get(ref) ?? ref, currency, orders: 0, netRevenueCents: 0, costCents: 0 }).get(k)!;
  };
  for (const s of sales) if (s.provenance === "real") { const r = row(s.productRef, s.currency); r.orders += 1; r.netRevenueCents += netCents(s); }
  for (const e of expenses) if (e.provenance === "real" && e.productRef) row(e.productRef, e.currency).costCents += e.amountCents;
  return [...rows.values()].sort((a, b) => b.netRevenueCents - a.netRevenueCents);
}
