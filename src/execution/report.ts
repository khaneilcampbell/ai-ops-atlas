import type { StoredTask } from "../tasks/types";
import { liveStatus } from "../workflows/engine";
import type { NodeStatus, WorkflowRun } from "../workflows/types";
import { spend } from "./policy";
import type { ArtifactRef, RunLedger, RunStatus } from "./types";

// Goal-level reporting, derived from the run's tasks and ledger. Two separate answers: did the
// workflow finish (technical), and did the business outcome happen (only what someone recorded
// with a sourced metric). A finished launch is never reported as a successful product.

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  not_started: "Not started",
  running: "Running",
  waiting_on_person: "Waiting on you",
  blocked: "Blocked",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * The run's technical status, from its steps. Skipped branches don't count. `stuck` names queued
 * steps that can't run from Atlas, from the last round: unconfigured ones block the run, ones a
 * person starts (manual work, a decision) make it wait on that person.
 */
export function runStatus(run: WorkflowRun, tasks: ReadonlyMap<string, StoredTask>, ledger: RunLedger, stuck: ReadonlyMap<string, "person" | "unconfigured"> = new Map(), status = liveStatus(run.snapshot, run, tasks)): RunStatus {
  if (ledger.cancelledAt) return "cancelled";
  if (!ledger.startedBy) return "not_started";
  const steps = run.snapshot.nodes.filter((n) => n.kind !== "outcome").map((n) => [n, status.get(n.id) ?? "not_started"] as const);
  const counted = steps.filter(([, s]) => s !== "skipped");
  if (counted.every(([, s]) => s === "completed")) return "completed";
  const has = (s: NodeStatus) => counted.some(([, x]) => x === s);
  const exhausted = counted.some(([n, s]) => s === "failed" && (tasks.get(run.nodeTasks[n.id] ?? "")?.attempts.length ?? 0) >= (tasks.get(run.nodeTasks[n.id] ?? "")?.maxAttempts ?? 1));
  if (exhausted) return "failed";
  if (has("running")) return "running";
  if (has("awaiting_approval")) return "awaiting_approval";
  if (has("cancelled") || has("failed") || has("no_task") || has("unconfigured") || Object.keys(ledger.needsReconcile).length) return "blocked";
  const queued = counted.filter(([, s]) => s === "queued").map(([n]) => n);
  if (queued.some((n) => !n.unconfigured && !stuck.has(n.id))) return "running";
  return queued.some((n) => stuck.get(n.id) === "person") ? "waiting_on_person" : "blocked";
}

export interface GoalReport {
  status: RunStatus;
  durationMs: number | null;
  steps: { total: number; completed: number; failed: number; blocked: number; awaitingApproval: number; skipped: number; unconfigured: number };
  retries: number;
  approvalsGranted: number;
  approvalsRejected: number;
  handoffs: { validated: number; unverified: number; waived: number; invalid: number };
  usage: { inputTokens: number; outputTokens: number; reports: number; estimatedUsd: number; billedUsd: number };
  artifacts: ArtifactRef[];
  /** Business result: only what was recorded, never inferred from the workflow finishing. */
  outcome: "not_recorded" | "achieved" | "not_achieved" | "too_early";
  outcomeNote?: string;
}

export function goalReport(run: WorkflowRun, tasks: ReadonlyMap<string, StoredTask>, ledger: RunLedger, now = new Date().toISOString(), stuck: ReadonlyMap<string, "person" | "unconfigured"> = new Map()): GoalReport {
  const status = liveStatus(run.snapshot, run, tasks);
  const rs = runStatus(run, tasks, ledger, stuck, status);
  const runTasks = Object.values(run.nodeTasks).map((id) => tasks.get(id)).filter((t): t is StoredTask => !!t);
  const count = (s: NodeStatus) => [...status.values()].filter((x) => x === s).length;
  const usage = runTasks.map(spend).reduce((a, b) => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, reports: a.reports + b.reports, estimatedUsd: a.estimatedUsd + b.estimatedUsd, billedUsd: a.billedUsd + b.billedUsd }), { inputTokens: 0, outputTokens: 0, reports: 0, estimatedUsd: 0, billedUsd: 0 });
  const hs = Object.values(ledger.handoffs);
  const ends = runTasks.map((t) => t.completedAt).filter((x): x is string => !!x);
  const end = rs === "completed" || rs === "cancelled" ? ends.sort()[ends.length - 1] ?? now : now;
  return {
    status: rs,
    durationMs: ledger.startedAt ? Math.max(0, Date.parse(end) - Date.parse(ledger.startedAt)) : null,
    steps: { total: run.snapshot.nodes.filter((n) => n.kind !== "outcome").length, completed: count("completed"), failed: count("failed"), blocked: count("blocked"), awaitingApproval: count("awaiting_approval"), skipped: count("skipped"), unconfigured: count("unconfigured") },
    retries: runTasks.reduce((n, t) => n + Math.max(0, t.attempts.length - 1), 0),
    approvalsGranted: runTasks.reduce((n, t) => n + t.approvals.filter((a) => a.decision === "granted").length, 0),
    approvalsRejected: runTasks.reduce((n, t) => n + t.approvals.filter((a) => a.decision === "rejected").length, 0),
    handoffs: { validated: hs.filter((h) => h.state === "validated").length, unverified: hs.filter((h) => h.state === "unverified").length, waived: hs.filter((h) => h.state === "waived").length, invalid: ledger.validationFailures.length },
    usage,
    artifacts: hs.flatMap((h) => h.output?.artifacts ?? []),
    outcome: ledger.outcome?.state ?? "not_recorded",
    ...(ledger.outcome ? { outcomeNote: ledger.outcome.note } : {}),
  };
}

/** Per step: when it actually ran, how long, and the last error, from its attempts. */
export function stepTiming(t: StoredTask | undefined): { startedAt?: string; finishedAt?: string; durationMs?: number; error?: string } {
  if (!t) return {};
  const a = t.attempts[t.attempts.length - 1];
  if (!a) return {};
  const startedAt = a.startedAt ?? a.requestedAt;
  return { startedAt, ...(a.finishedAt ? { finishedAt: a.finishedAt, durationMs: Date.parse(a.finishedAt) - Date.parse(startedAt) } : {}), ...(a.error || t.error ? { error: a.error ?? t.error } : {}) };
}
