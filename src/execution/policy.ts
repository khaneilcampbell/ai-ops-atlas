import type { StoredTask } from "../tasks/types";
import type { WorkflowNode } from "../workflows/types";

// Execution policy: fixed rules, no model calls. Which model tier a step may use, how much it may
// spend, how long a run may take before Atlas checks on it, and how retries back off.

export type ModelTier = "none" | "small" | "advanced";

export interface StepPolicy {
  tier: ModelTier;
  /** Hard cap on reported spend for this step's task, across attempts, in USD. */
  capUsd: number;
  /** After this long without a report, Atlas asks the outside system before doing anything else. */
  timeoutMs: number;
  /** Reuse a validated output from an earlier run of the same step when it's younger than this. 0 = never. */
  reuseDays: number;
}

const HOUR = 3_600_000;

/** Scoring and planning are the reasoning-heavy steps; other agent steps get a small model; routing, approvals and decisions use no model. */
const ADVANCED = new Set(["scoring", "planning"]);
const REUSABLE = new Set(["market-research", "customer-research", "competitor-analysis"]);

export function stepPolicy(n: Pick<WorkflowNode, "id" | "kind" | "execution">): StepPolicy {
  const deterministic = n.kind === "approval" || n.kind === "decision" || n.kind === "outcome" || n.execution.kind === "manual" || n.execution.kind === "none";
  const tier: ModelTier = deterministic ? "none" : ADVANCED.has(n.id) ? "advanced" : "small";
  return {
    tier,
    capUsd: tier === "none" ? 0 : tier === "advanced" ? 3 : 1,
    timeoutMs: n.execution.kind === "github" ? 2 * HOUR : 6 * HOUR,
    reuseDays: REUSABLE.has(n.id) ? 30 : 0,
  };
}

/** Reported spend on a task, split so estimates are never shown as billing. */
export function spend(t: Pick<StoredTask, "usage">): { estimatedUsd: number; billedUsd: number; inputTokens: number; outputTokens: number; reports: number } {
  let estimatedUsd = 0;
  let billedUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const u of t.usage) {
    if (u.cost?.basis === "billed") billedUsd += u.cost.usd;
    else if (u.cost) estimatedUsd += u.cost.usd;
    inputTokens += u.inputTokens ?? 0;
    outputTokens += u.outputTokens ?? 0;
  }
  return { estimatedUsd, billedUsd, inputTokens, outputTokens, reports: t.usage.length };
}

/** Why the step may not spend more, or null. A step with tier "none" never needs budget. */
export function budgetProblem(t: Pick<StoredTask, "usage">, p: StepPolicy): string | null {
  if (p.tier === "none") return null;
  const s = spend(t);
  const used = s.billedUsd + s.estimatedUsd;
  return used >= p.capUsd ? `This step has used its $${p.capUsd.toFixed(2)} model budget ($${used.toFixed(2)} reported).` : null;
}

export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 30 * 60_000;
/** Wait before automatic retry n (1-based): 1 min, 2 min, 4 min ... capped at 30 min. */
export const backoffMs = (n: number) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, n - 1));

/** At most this many outside runs at once across all live workflows. */
export const MAX_CONCURRENT = 3;
/** At most this many automatic repairs of one step's invalid output. */
export const MAX_REPAIRS = 1;
