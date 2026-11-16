import type { StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import { scoped, type BusinessFilter } from "./dashboard";
import { inPeriod, statement, type Period } from "./finance";
import { goalProgress } from "./goals";
import { agentImpact } from "./impact";
import { conversion, followUps, median, money, responseHours } from "./revenue";
import { EXPENSE_LABEL, STAGE_LABEL, type BusinessData } from "./types";

// The Business Advisor. Deterministic rules over the records first: every recommendation carries
// the numbers it rests on, the date range, its assumptions, how sure it is, the expected impact, the
// next step and what approval that step needs. Nothing runs by itself; "Create task" puts the step
// in the Task Center, where the usual approval rules apply. No model is called, so it costs nothing
// and can't invent a figure. `evidenceBrief` gives the same facts, with no personal details, for a
// person who wants an agent's second opinion.

export type Certainty = "low" | "medium" | "high";

export interface Recommendation {
  /** Stable for the same finding, so a task made from it isn't made twice (Task Center intake key). */
  key: string;
  area: "conversion" | "follow_up" | "response" | "expenses" | "products" | "marketing" | "goals" | "operations" | "data";
  title: string;
  evidence: string[];
  period: Period;
  assumptions: string[];
  certainty: Certainty;
  uncertainty: string;
  impact: string;
  nextAction: string;
  approval: string;
}

/** The smallest sample a rate-based rule accepts, so one lost lead doesn't trigger advice. */
export const MIN_SAMPLE = 3;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const certaintyFor = (n: number): Certainty => (n >= 20 ? "high" : n >= 8 ? "medium" : "low");

function previous(p: Period): Period {
  const from = Date.parse(p.from), to = Date.parse(p.to);
  const len = to - from + 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(from - len), to: iso(from - 86_400_000) };
}

export function advise(all: BusinessData, tasks: readonly StoredTask[], runs: readonly WorkflowRun[], f: BusinessFilter, now = Date.now()): Recommendation[] {
  const d = scoped(all, f);
  const p = f.period;
  const out: Recommendation[] = [];
  const advice = "None: advice only. A person decides.";

  // Data gaps come first: advice on missing data would be guesswork.
  if (!d.sales.length) {
    out.push({
      key: "data:no-sales", area: "data", title: "Record sales so revenue can be measured",
      evidence: ["0 sales recorded", "No payment provider is connected to Atlas"], period: p,
      assumptions: ["Benjaire has sold something, or will soon"], certainty: "high", uncertainty: "Certain that the data is missing; not whether sales happened.",
      impact: "Revenue, profit, conversion-to-customer and revenue goals become measurable.",
      nextAction: "Add each order from the payment dashboard on the Finance tab, or connect a read-only payments export.", approval: advice,
    });
  }

  // Conversion bottleneck: the pipeline step with the lowest pass-through rate, with enough leads.
  const conv = conversion(d.leads);
  const steps = conv.stepRates.map((s) => ({ ...s, n: conv.stages.find((x) => x.stage === s.from)!.reached })).filter((s) => s.rate !== null && s.n >= MIN_SAMPLE);
  const worst = steps.sort((a, b) => a.rate! - b.rate!)[0];
  if (worst && worst.rate! < 0.5) {
    out.push({
      key: `conversion:${worst.from}-${worst.to}`, area: "conversion", title: `Most leads stall between ${STAGE_LABEL[worst.from]} and ${STAGE_LABEL[worst.to]}`,
      evidence: [`${worst.n} leads reached ${STAGE_LABEL[worst.from]}`, `${pct(worst.rate!)} of them reached ${STAGE_LABEL[worst.to]}`, ...steps.filter((s) => s !== worst).map((s) => `${STAGE_LABEL[s.from]} to ${STAGE_LABEL[s.to]}: ${pct(s.rate!)}`)],
      period: p, assumptions: ["Stages were updated when the lead actually moved"], certainty: certaintyFor(worst.n),
      uncertainty: worst.n < 8 ? "Few leads, so one or two outcomes change the rate a lot." : "Enough leads for a rough read.",
      impact: "Fixing the weakest step raises every later stage, including wins.",
      nextAction: `Review the leads stuck at ${STAGE_LABEL[worst.from]} and note why each didn't move.`, approval: advice,
    });
  }

  // Follow-ups due.
  const due = followUps(d.leads, now).filter((x) => x.due);
  if (due.length) {
    out.push({
      key: `follow-up:${due.map((x) => x.lead.id).sort().join(",").slice(0, 80)}`, area: "follow_up", title: `${due.length} lead follow-up${due.length === 1 ? " is" : "s are"} due`,
      evidence: due.slice(0, 5).map((x) => `${x.lead.productInterest || "Lead"}: due ${x.lead.followUpDate}${x.overdueDays ? `, ${x.overdueDays} day${x.overdueDays === 1 ? "" : "s"} late` : ""}`), period: p,
      assumptions: ["Only leads that agreed to be contacted are listed"], certainty: "high", uncertainty: "The dates are recorded; whether a reply came in elsewhere isn't.",
      impact: "Late follow-ups are the most common reason warm leads go cold.",
      nextAction: "Send each follow-up from your own mail, then record it on the lead.", approval: "A person sends every customer message (customer-facing message).",
    });
  }

  // Response time.
  const hours = responseHours(d.leads.filter((l) => inPeriod(l.createdAt.slice(0, 10), p)));
  const med = median(hours);
  if (med !== null && hours.length >= MIN_SAMPLE && med > 24) {
    out.push({
      key: `response:${p.from}`, area: "response", title: `First replies take a median of ${Math.round(med)} hours`,
      evidence: [`${hours.length} leads with a recorded first reply`, `Median ${med.toFixed(1)} hours`], period: p,
      assumptions: ["The first reply was recorded on the lead, or the lead was moved to Contacted when it was sent"], certainty: certaintyFor(hours.length),
      uncertainty: "Replies sent but not recorded would make this look slower than it is.",
      impact: "Replying within a day usually lifts conversion on inbound inquiries.",
      nextAction: "Use the Inquiry to Client drafts to reply the same day, and record the reply.", approval: advice,
    });
  }

  // Expenses: a category that grew a lot against the previous period of the same length.
  const now$ = statement(d.sales, d.expenses, tasks, p);
  const was$ = statement(d.sales, d.expenses, tasks, previous(p));
  for (const c of now$.currencies) {
    const before = was$.currencies.find((x) => x.currency === c.currency);
    for (const [cat, cents] of Object.entries(c.expensesByCategory) as [keyof typeof EXPENSE_LABEL, number][]) {
      const prev = before?.expensesByCategory[cat] ?? 0;
      if (prev > 0 && cents >= prev * 1.5 && cents - prev >= 2_000) {
        out.push({
          key: `expense-rise:${c.currency}:${cat}:${p.from}`, area: "expenses", title: `${EXPENSE_LABEL[cat]} spending rose ${pct(cents / prev - 1)}`,
          evidence: [`This period: ${money(cents, c.currency)}`, `Previous period: ${money(prev, c.currency)}`], period: p,
          assumptions: ["Both periods have all their expenses recorded"], certainty: "medium", uncertainty: "A one-off or annual bill can look like a rise.",
          impact: `Up to ${money(cents - prev, c.currency)} a period if the increase isn't needed.`,
          nextAction: `Check each ${EXPENSE_LABEL[cat].toLowerCase()} expense this period and cancel what isn't used.`, approval: "Cancelling a paid service is a financial change a person makes.",
        });
      }
    }
    if (c.operatingExpenseCents > 0 && c.netRevenueCents <= 0 && c.orders === 0 && d.sales.length > 0) {
      out.push({
        key: `expense-no-revenue:${c.currency}:${p.from}`, area: "expenses", title: `Spending without revenue in ${c.currency} this period`,
        evidence: [`Operating expenses: ${money(c.operatingExpenseCents, c.currency)}`, "No sales in this currency in the period"], period: p,
        assumptions: ["All sales for the period are recorded"], certainty: "medium", uncertainty: "Revenue may be recorded in another currency.",
        impact: "Shows how long current spending can run without sales.", nextAction: "Review subscriptions and pause what isn't helping a launch.", approval: "Cancelling a paid service is a financial change a person makes.",
      });
    }
  }

  // Products: compare opportunities waiting for a decision, by the research brief's own score.
  const waiting = d.products.filter((x) => (x.stage === "evaluate" || x.stage === "approve") && x.researchScore !== undefined).sort((a, b) => b.researchScore! - a.researchScore!);
  if (waiting.length >= 2) {
    const [a, b] = waiting;
    out.push({
      key: `products:compare:${waiting.map((x) => x.id).join(",").slice(0, 80)}`, area: "products", title: `${a.title} scores highest of ${waiting.length} opportunities awaiting a decision`,
      evidence: waiting.slice(0, 4).map((x) => `${x.title}: ${x.researchScore!.toFixed(2)} of 5 (${x.source})`), period: p,
      assumptions: ["The Product Lab scorecard reflects demand, gap, fit, margin, validation and synergy"], certainty: a.researchScore! - b.researchScore! >= 0.4 ? "medium" : "low",
      uncertainty: a.researchScore! - b.researchScore! < 0.4 ? "The top two are close; the score alone shouldn't decide." : "Scores are research estimates, not demand evidence.",
      impact: "Focuses build time on the strongest idea.", nextAction: `Look for one piece of real demand evidence (signups or preorders) for ${a.title} before approving a build.`,
      approval: "Moving a product to Build needs your approval (development commitment).",
    });
  }
  // Launched products with feedback but no sales.
  for (const prod of d.products.filter((x) => x.listing.publishedUrl)) {
    const sold = d.sales.some((s) => s.productRef === prod.productRef && inPeriod(s.date, p));
    if (!sold && prod.feedback.length >= MIN_SAMPLE) {
      out.push({
        key: `product-feedback:${prod.id}:${p.from}`, area: "products", title: `${prod.title} has feedback but no sales this period`,
        evidence: [`${prod.feedback.length} feedback notes`, "0 sales in the period", `Listing version ${prod.listing.versions[prod.listing.versions.length - 1]?.version ?? 0}`], period: p,
        assumptions: ["Feedback notes reflect what buyers think"], certainty: "low", uncertainty: "Feedback is qualitative and the sample is small.",
        impact: "Addressing the most repeated complaint is the cheapest way to a first sale.", nextAction: "Read the feedback, pick the most repeated point, and draft a listing change.",
        approval: "Publishing a listing change needs your approval (public publishing).",
      });
    }
  }

  // Marketing: the acquisition source with the best win rate, given enough closed leads.
  const bySource = new Map<string, { won: number; closed: number }>();
  for (const l of d.leads) if (l.stage === "won" || l.stage === "lost") { const s = bySource.get(l.acquisitionSource) ?? { won: 0, closed: 0 }; s.closed += 1; if (l.stage === "won") s.won += 1; bySource.set(l.acquisitionSource, s); }
  const ranked = [...bySource.entries()].filter(([, s]) => s.closed >= MIN_SAMPLE).sort((a, b) => b[1].won / b[1].closed - a[1].won / a[1].closed);
  if (ranked.length >= 2 && ranked[0][1].won > 0) {
    out.push({
      key: `marketing:${ranked[0][0]}:${p.from}`, area: "marketing", title: `Leads from ${ranked[0][0]} win most often`,
      evidence: ranked.map(([src, s]) => `${src}: ${s.won} of ${s.closed} won (${pct(s.won / s.closed)})`), period: p,
      assumptions: ["Acquisition source was recorded correctly"], certainty: certaintyFor(ranked[0][1].closed), uncertainty: "Small samples; run it as an experiment, not a switch.",
      impact: "More leads from the best source at the same win rate means more customers.",
      nextAction: `Run a two-week experiment to get more leads from ${ranked[0][0]}, with a set budget, and compare.`, approval: "Any paid promotion needs your approval (spending).",
    });
  }

  // Goals at risk.
  for (const g of d.goals) {
    const pr = goalProgress(g, { data: d, tasks, runs }, now);
    if (pr.verdict === "at_risk") {
      out.push({
        key: `goal:${g.id}`, area: "goals", title: `Goal at risk: ${g.title}`,
        evidence: [`Target ${g.target}, now ${pr.current ?? "unmeasured"}`, `Due ${g.targetDate}`, pr.work !== null ? `${pr.workDone} of ${pr.workTotal} workflow steps done` : "No workflow runs linked"], period: { from: g.startDate, to: g.targetDate },
        assumptions: ["The metric's records are complete"], certainty: "medium", uncertainty: pr.note,
        impact: "Seeing it early leaves time to change the plan.", nextAction: pr.work === 1 ? "The work is done but the result isn't there: decide what else would move the metric." : "Check what's blocking the linked work, or adjust the target date.", approval: advice,
      });
    }
  }

  // Operations: unreliable agents.
  for (const a of agentImpact(d, tasks, runs)) {
    if (a.reliability !== null && a.tasksCompleted + a.tasksFailed >= MIN_SAMPLE && a.reliability < 0.7) {
      out.push({
        key: `ops:${a.agentId}`, area: "operations", title: `${a.agentName} fails ${pct(1 - a.reliability)} of its tasks`,
        evidence: [`${a.tasksCompleted} completed, ${a.tasksFailed} failed`, `AI cost on its tasks: $${a.aiCostUsd.toFixed(2)}${a.aiCostEstimated ? " (estimated)" : ""}`], period: p,
        assumptions: ["Task outcomes were recorded"], certainty: certaintyFor(a.tasksCompleted + a.tasksFailed), uncertainty: "Failures may come from one external outage.",
        impact: "Fewer retries and less manual clean-up.", nextAction: `Open ${a.agentName}'s failed tasks in the Task Center and look for a common cause.`, approval: advice,
      });
    }
  }
  return out;
}

/** The facts behind the advice, with no personal details, for an agent's second opinion. */
export function evidenceBrief(recs: readonly Recommendation[], f: BusinessFilter): string {
  return JSON.stringify({ period: f.period, test_data: f.provenance === "test", recommendations: recs.map(({ title, evidence, assumptions, certainty, uncertainty }) => ({ title, evidence, assumptions, certainty, uncertainty })), rules: "Use only these facts. Do not add figures." }, null, 2);
}
