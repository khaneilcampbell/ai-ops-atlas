import { newId } from "../tasks/lifecycle";
import type { Actor, StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import { authorize } from "./access";
import { aiCost } from "./finance";
import { median, netCents, responseHours, type Outcome } from "./revenue";
import type { BusinessData, BusinessGoal, EvidenceRef, GoalDomain, GoalMetric, MetricDirection } from "./types";

// Business goals. A goal is measured by a metric worked out from real records, and has two separate
// progress lines: how far the workflows behind it got (work done), and how far the business metric
// moved toward its target (outcome). Only the second can make a goal achievable, and only a person
// can then confirm it, with evidence. A finished research task never meets a revenue goal.

export const METRIC_INFO: Record<GoalMetric, { label: string; direction: MetricDirection; unit: "money" | "count" | "hours" | "usd" | "number"; domain: GoalDomain }> = {
  net_revenue: { label: "Net revenue", direction: "up", unit: "money", domain: "revenue" },
  paying_customers: { label: "Paying customers", direction: "up", unit: "count", domain: "customer" },
  qualified_leads: { label: "Qualified leads", direction: "up", unit: "count", domain: "sales" },
  won_deals: { label: "Won deals", direction: "up", unit: "count", domain: "sales" },
  products_launched: { label: "Products launched", direction: "up", unit: "count", domain: "product" },
  lead_response_hours: { label: "Median first response (hours)", direction: "down", unit: "hours", domain: "customer" },
  ai_cost_per_completed_task: { label: "AI cost per completed task (USD)", direction: "down", unit: "usd", domain: "operations" },
  manual: { label: "Measured by hand", direction: "up", unit: "number", domain: "operations" },
};

export interface MetricContext {
  data: BusinessData;
  tasks: readonly StoredTask[];
  runs: readonly WorkflowRun[];
}

/**
 * The metric's current value from real records, or null when there is nothing to measure yet.
 * Counts and sums only use records dated on or after the goal's start, so a baseline isn't counted twice.
 */
export function metricValue(goal: Pick<BusinessGoal, "metric" | "startDate" | "targetDate" | "currency" | "manualValue">, ctx: MetricContext): number | null {
  const since = goal.startDate;
  const real = <T extends { provenance: string }>(xs: readonly T[]) => xs.filter((x) => x.provenance === "real");
  switch (goal.metric) {
    case "net_revenue": {
      if (!goal.currency) return null;
      return real(ctx.data.sales).filter((s) => s.currency === goal.currency && s.date >= since).reduce((n, s) => n + netCents(s), 0);
    }
    case "paying_customers": {
      const paid = new Set(real(ctx.data.sales).filter((s) => s.customerId && s.date >= since && netCents(s) > 0).map((s) => s.customerId!));
      return real(ctx.data.customers).filter((c) => paid.has(c.id)).length;
    }
    case "qualified_leads":
      return real(ctx.data.leads).filter((l) => l.transitions.some((t) => t.to === "qualified" && t.at.slice(0, 10) >= since)).length;
    case "won_deals":
      return real(ctx.data.leads).filter((l) => l.transitions.some((t) => t.to === "won" && t.at.slice(0, 10) >= since)).length;
    case "products_launched":
      return real(ctx.data.products).filter((p) => p.history.some((h) => h.to === "launch" && h.at.slice(0, 10) >= since) && !!p.listing.publishedUrl).length;
    case "lead_response_hours": {
      const m = median(responseHours(real(ctx.data.leads).filter((l) => l.createdAt.slice(0, 10) >= since)));
      return m === null ? null : Math.round(m * 10) / 10;
    }
    case "ai_cost_per_completed_task":
      return aiCost(ctx.tasks, { from: since, to: goal.targetDate > today() ? today() : goal.targetDate }).perCompletedTaskUsd;
    case "manual":
      return goal.manualValue ?? null;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

export interface GoalProgress {
  current: number | null;
  /** 0..1 share of the way from baseline to target; null when unmeasured. */
  outcome: number | null;
  met: boolean;
  /** 0..1 share of linked workflow steps completed; null with no linked runs. */
  work: number | null;
  workDone: number;
  workTotal: number;
  /** Achieved / missed / at risk / on track, in plain words. */
  verdict: "achieved" | "met_unconfirmed" | "on_track" | "at_risk" | "missed" | "unmeasured" | "draft" | "cancelled";
  /** Why, for the screen. */
  note: string;
}

export function goalProgress(goal: BusinessGoal, ctx: MetricContext, now = Date.now()): GoalProgress {
  const current = metricValue(goal, ctx);
  const dir = METRIC_INFO[goal.metric].direction;
  const span = goal.target - goal.baseline;
  const outcome = current === null ? null : span === 0 ? (dir === "up" ? (current >= goal.target ? 1 : 0) : current <= goal.target ? 1 : 0) : Math.max(0, Math.min(1, (current - goal.baseline) / span));
  const met = current !== null && (dir === "up" ? current >= goal.target : current <= goal.target);

  const byId = new Map(ctx.tasks.map((t) => [t.id, t]));
  const linked = ctx.runs.filter((r) => goal.workflowRunIds.includes(r.id));
  const taskIds = linked.flatMap((r) => Object.values(r.nodeTasks));
  const workDone = taskIds.filter((id) => byId.get(id)?.status === "completed").length;
  const work = taskIds.length ? workDone / taskIds.length : null;

  const elapsed = (now - Date.parse(goal.startDate)) / Math.max(1, Date.parse(goal.targetDate) - Date.parse(goal.startDate));
  const pastDue = now > Date.parse(goal.targetDate) + 86_400_000;
  const base = { current, outcome, met, work, workDone, workTotal: taskIds.length };
  if (goal.state === "draft") return { ...base, verdict: "draft", note: "Not started yet." };
  if (goal.state === "cancelled") return { ...base, verdict: "cancelled", note: "Cancelled." };
  if (goal.state === "achieved") return { ...base, verdict: "achieved", note: `Confirmed by ${goal.achievedBy?.name ?? "a person"}.` };
  if (current === null) return { ...base, verdict: "unmeasured", note: "No real records to measure this yet." };
  if (met) return { ...base, verdict: "met_unconfirmed", note: "The target is met by real records. A person needs to confirm it with evidence." };
  if (pastDue || goal.state === "missed") return { ...base, verdict: "missed", note: "The target date passed without meeting the target." };
  if (work === 1) return { ...base, verdict: "at_risk", note: "The linked workflows finished, but the business metric hasn't reached the target." };
  return { ...base, verdict: (outcome ?? 0) + 0.15 >= Math.max(0, Math.min(1, elapsed)) ? "on_track" : "at_risk", note: "Measured from real records." };
}

export interface GoalInput {
  title: string;
  domain: GoalDomain;
  targetOutcome: string;
  metric: GoalMetric;
  currency?: string;
  baseline: number;
  target: number;
  startDate: string;
  targetDate: string;
  agentIds: string[];
  requiresApproval: boolean;
  provenance: "real" | "test";
}

export function draftGoal(input: GoalInput, actor: Actor, at: string): Outcome<BusinessGoal> {
  const refused = authorize(actor, input.provenance === "real" ? "record_real" : "record_test");
  if (refused) return { ok: false, error: refused };
  if (!input.title.trim() || !input.targetOutcome.trim()) return { ok: false, error: "A goal needs a title and a target outcome." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) return { ok: false, error: "Use dates like 2026-11-16." };
  if (input.targetDate < input.startDate) return { ok: false, error: "The target date is before the start date." };
  if (!Number.isFinite(input.baseline) || !Number.isFinite(input.target)) return { ok: false, error: "Baseline and target must be numbers." };
  if (input.metric === "net_revenue" && !/^[A-Z]{3}$/.test(input.currency ?? "")) return { ok: false, error: "A revenue goal needs a currency such as USD." };
  const dir = METRIC_INFO[input.metric].direction;
  if (input.metric !== "manual" && (dir === "up" ? input.target <= input.baseline : input.target >= input.baseline)) {
    return { ok: false, error: dir === "up" ? "The target must be higher than the baseline." : "The target must be lower than the baseline." };
  }
  return {
    ok: true,
    value: {
      id: newId("goal"),
      provenance: input.provenance,
      source: input.provenance === "test" ? "Test data" : "Set by hand",
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      title: input.title.trim(),
      domain: input.domain,
      targetOutcome: input.targetOutcome.trim(),
      metric: input.metric,
      ...(input.metric === "net_revenue" ? { currency: input.currency } : {}),
      baseline: input.baseline,
      target: input.target,
      startDate: input.startDate,
      targetDate: input.targetDate,
      agentIds: input.agentIds,
      workflowRunIds: [],
      requiresApproval: input.requiresApproval,
      state: "active",
      evidence: [],
      rev: 1,
    },
  };
}

export function addEvidence(goal: BusinessGoal, e: Omit<EvidenceRef, "id" | "at" | "addedBy">, actor: Actor, at: string): Outcome<BusinessGoal> {
  if (!e.label.trim() || !e.ref.trim()) return { ok: false, error: "Evidence needs a label and what it points at." };
  return { ok: true, value: { ...goal, updatedAt: at, evidence: [...goal.evidence, { ...e, id: newId("ev"), at, addedBy: actor }] } };
}

/**
 * Confirms a goal achieved. Refused unless a person does it, the metric is met by real records,
 * and there is at least one piece of evidence. Completed workflows alone are never enough.
 */
export function confirmGoal(goal: BusinessGoal, ctx: MetricContext, actor: Actor, at: string): Outcome<BusinessGoal> {
  const refused = authorize(actor, "confirm_goal");
  if (refused) return { ok: false, error: refused };
  if (goal.provenance === "test") return { ok: false, error: "A test goal can't be confirmed." };
  if (goal.state !== "active") return { ok: false, error: "Only an active goal can be confirmed." };
  const p = goalProgress(goal, ctx, Date.parse(at));
  if (!p.met) return { ok: false, error: p.work === 1 ? "The workflows are done, but the business result hasn't happened yet." : "The metric hasn't reached the target in real records." };
  if (goal.metric === "manual" && goal.evidence.length === 0) return { ok: false, error: "A goal measured by hand needs evidence first." };
  if (goal.evidence.length === 0 && goal.requiresApproval) return { ok: false, error: "Add evidence before confirming." };
  return { ok: true, value: { ...goal, state: "achieved", achievedBy: actor, achievedAt: at, updatedAt: at } };
}

export function linkRun(goal: BusinessGoal, runId: string, at: string): BusinessGoal {
  return goal.workflowRunIds.includes(runId) ? goal : { ...goal, workflowRunIds: [...goal.workflowRunIds, runId], updatedAt: at };
}

/** Goals that a workflow run contributes to (for the Workflow Intelligence inspector). */
export const goalsForRun = (goals: readonly BusinessGoal[], runId: string) => goals.filter((g) => g.workflowRunIds.includes(runId));

/** Suggested starting goals, matching the directive's examples. Baselines come from the records. */
export const GOAL_TEMPLATES: { title: string; domain: GoalDomain; metric: GoalMetric; targetOutcome: string; target: number; currency?: string }[] = [
  { title: "Launch Benjaire's first digital product", domain: "product", metric: "products_launched", targetOutcome: "One product live on the marketplace with a confirmed public page", target: 1 },
  { title: "Generate the first paying customer", domain: "customer", metric: "paying_customers", targetOutcome: "One customer with a recorded, non-refunded sale", target: 1 },
  { title: "Increase qualified leads", domain: "sales", metric: "qualified_leads", targetOutcome: "More leads reach Qualified", target: 10 },
  { title: "Improve customer inquiry response time", domain: "customer", metric: "lead_response_hours", targetOutcome: "Median first reply within 4 hours", target: 4 },
  { title: "Reduce AI operating cost per completed task", domain: "operations", metric: "ai_cost_per_completed_task", targetOutcome: "Lower AI cost per completed Task Center task", target: 0.05 },
];
