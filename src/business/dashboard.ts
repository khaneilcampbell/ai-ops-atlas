import type { StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import { inPeriod, productRevenue, statement, type Period, type ProductRevenue, type Statement } from "./finance";
import { goalProgress, type GoalProgress } from "./goals";
import { conversion, netCents, type Conversion } from "./revenue";
import { CLOSED_STAGES, type BusinessData, type BusinessGoal, type GoalDomain, type Provenance } from "./types";

// What the Business dashboard shows, aggregated from the records with the filters applied. Every
// metric that can't be worked out says why (`Missing`), so an empty business never reads as zero
// revenue or a 0% conversion rate.

export interface BusinessFilter {
  period: Period;
  /** A product reference, or "" for all. */
  product: string;
  /** A business area (goal domain), or "" for all. Filters goals. */
  area: GoalDomain | "";
  /** verified: only sales reconciled with the provider. manual: only typed in. all: both. */
  source: "all" | "verified" | "manual";
  /** Which records to show. Test mode never mixes with real records. */
  provenance: Provenance;
}

export type Missing = { missing: string };
export type Metric<T> = T | Missing;
export const isMissing = <T>(m: Metric<T>): m is Missing => typeof m === "object" && m !== null && "missing" in m;

/**
 * The records the dashboard may use. In test mode the test records are relabelled as real for the
 * calculation only (every calculation counts real records), and the screen says TEST DATA. Nothing
 * returned here is ever saved.
 */
export function scoped(data: BusinessData, f: BusinessFilter): BusinessData {
  const keep = <T extends { provenance: Provenance }>(xs: readonly T[]) => xs.filter((x) => x.provenance === f.provenance).map((x) => (f.provenance === "test" ? { ...x, provenance: "real" as const } : x));
  const sales = keep(data.sales).filter((s) => (!f.product || s.productRef === f.product) && (f.source === "all" || s.verification === f.source));
  const expenses = keep(data.expenses).filter((e) => !f.product || e.productRef === f.product);
  return {
    goals: keep(data.goals).filter((g) => !f.area || g.domain === f.area),
    leads: keep(data.leads).filter((l) => !f.product || l.productInterest === f.product),
    customers: keep(data.customers),
    sales,
    expenses,
    products: keep(data.products).filter((p) => !f.product || p.productRef === f.product),
  };
}

export interface Overview {
  statement: Statement;
  /** Net revenue per currency, or why it's missing. */
  revenue: Metric<{ currency: string; cents: number }[]>;
  expenses: Metric<{ currency: string; cents: number; estimated: boolean }[]>;
  profit: Metric<{ currency: string; cents: number }[]>;
  activeLeads: Metric<number>;
  conversion: Conversion;
  winRate: Metric<number>;
  productsLaunched: Metric<number>;
  goals: { goal: BusinessGoal; progress: GoalProgress }[];
  goalSummary: Metric<{ achieved: number; onTrack: number; atRisk: number; total: number }>;
  revenueByMonth: { month: string; currency: string; cents: number }[];
  revenueByProduct: ProductRevenue[];
  /** Customer acquisition cost: marketing spend / new paying customers, per currency. */
  cac: Metric<{ currency: string; cents: number; customers: number }[]>;
  leadToCustomer: Metric<number>;
}

const months = (p: Period): string[] => {
  const out: string[] = [];
  let [y, m] = p.from.slice(0, 7).split("-").map(Number);
  const end = p.to.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (k > end) break;
    out.push(k);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};

export function overview(all: BusinessData, tasks: readonly StoredTask[], runs: readonly WorkflowRun[], f: BusinessFilter, now = Date.now()): Overview {
  const d = scoped(all, f);
  const st = statement(d.sales, d.expenses, tasks, f.period);
  const noSales = "No sales recorded in this period";
  const revenue: Overview["revenue"] = st.currencies.some((c) => c.orders) ? st.currencies.filter((c) => c.orders).map((c) => ({ currency: c.currency, cents: c.netRevenueCents })) : { missing: d.sales.length ? noSales : "No sales recorded yet. Payments aren't connected, so add them from the Finance tab." };
  const expenses: Overview["expenses"] = st.currencies.some((c) => c.operatingExpenseCents) ? st.currencies.filter((c) => c.operatingExpenseCents).map((c) => ({ currency: c.currency, cents: c.operatingExpenseCents, estimated: c.estimatedExpenseCents > 0 })) : { missing: "No expenses recorded in this period" };
  const profit: Overview["profit"] = isMissing(revenue) && isMissing(expenses) ? { missing: "Needs revenue or expenses" } : st.currencies.map((c) => ({ currency: c.currency, cents: c.profitCents }));

  const conv = conversion(d.leads);
  const goals = d.goals.map((goal) => ({ goal, progress: goalProgress(goal, { data: d, tasks, runs }, now) }));
  const live = goals.filter((g) => g.goal.state !== "cancelled" && g.goal.state !== "draft");
  const launched = d.products.filter((p) => p.listing.publishedUrl && p.listing.launchDate && inPeriod(p.listing.launchDate, f.period)).length;

  const byMonth = new Map<string, number>();
  for (const s of d.sales) if (inPeriod(s.date, f.period)) byMonth.set(`${s.date.slice(0, 7)}\u0000${s.currency}`, (byMonth.get(`${s.date.slice(0, 7)}\u0000${s.currency}`) ?? 0) + netCents(s));
  const currencies = [...new Set(d.sales.map((s) => s.currency))].sort();
  const revenueByMonth = currencies.flatMap((currency) => months(f.period).map((month) => ({ month, currency, cents: byMonth.get(`${month}\u0000${currency}`) ?? 0 })));

  // CAC only when the period has both marketing spend and new paying customers in the same currency.
  const newPaying = new Map<string, Set<string>>();
  const firstSale = new Map<string, string>();
  for (const s of [...d.sales].sort((a, b) => a.date.localeCompare(b.date))) if (s.customerId && !firstSale.has(s.customerId)) firstSale.set(s.customerId, s.date);
  for (const s of d.sales) if (s.customerId && firstSale.get(s.customerId) === s.date && inPeriod(s.date, f.period)) (newPaying.get(s.currency) ?? newPaying.set(s.currency, new Set()).get(s.currency)!).add(s.customerId);
  const cacRows = st.currencies.flatMap((c) => {
    const spend = c.expensesByCategory.marketing ?? 0;
    const n = newPaying.get(c.currency)?.size ?? 0;
    return spend > 0 && n > 0 ? [{ currency: c.currency, cents: Math.round(spend / n), customers: n }] : [];
  });
  const real = d.leads;
  const closedOrCustomer = real.filter((l) => l.stage === "won" || l.stage === "lost");

  return {
    statement: st,
    revenue,
    expenses,
    profit,
    activeLeads: real.length ? real.filter((l) => !CLOSED_STAGES.has(l.stage)).length : { missing: "No leads recorded yet" },
    conversion: conv,
    winRate: conv.winRate === null ? { missing: "No leads won or lost yet" } : conv.winRate,
    productsLaunched: d.products.length ? launched : { missing: "No products recorded yet" },
    goals,
    goalSummary: live.length
      ? { achieved: live.filter((g) => g.progress.verdict === "achieved").length, onTrack: live.filter((g) => g.progress.verdict === "on_track" || g.progress.verdict === "met_unconfirmed").length, atRisk: live.filter((g) => g.progress.verdict === "at_risk" || g.progress.verdict === "missed").length, total: live.length }
      : { missing: "No goals set yet" },
    revenueByMonth,
    revenueByProduct: productRevenue(d.products, d.sales.filter((s) => inPeriod(s.date, f.period)), d.expenses.filter((e) => inPeriod(e.date, f.period))),
    cac: cacRows.length ? cacRows : { missing: "Needs marketing expenses and new paying customers in the same period and currency" },
    leadToCustomer: closedOrCustomer.length ? real.filter((l) => !!l.customerId).length / closedOrCustomer.length : { missing: "No closed leads yet" },
  };
}
