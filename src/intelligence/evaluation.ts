import { schemaFor } from "../execution/handoff";
import { spend } from "../execution/policy";
import type { HandoffRecord, ValidationFailure } from "../execution/types";
import { approvalFor } from "../tasks/lifecycle";
import type { StoredTask } from "../tasks/types";
import { AGENT_GRANTS, capabilityForExecutor } from "./capabilities";
import { tierOfModel } from "./routing";
import type { Evaluation, EvaluationMetrics, ModelTierNumber } from "./types";

// Evaluation engine: scores each finished attempt from what Atlas already recorded (task status,
// attempts, approvals, schema checks, artifacts, reported usage). No model is asked to grade.
// Human ratings sit next to the automatic score and are never mixed into it.

export interface EvalInput {
  task: StoredTask;
  agentId: string;
  nodeId?: string;
  runId?: string;
  workflowId?: string;
  workflowVersion?: number;
  promptVersion: string;
  taskType: string;
  routedTier: ModelTierNumber;
  handoff?: HandoffRecord;
  failures: readonly ValidationFailure[];
  /** Step cap in USD, when the step has one. */
  capUsd?: number;
}

const WEIGHTS: Record<keyof Pick<EvaluationMetrics, "completion" | "outputValid" | "evidence" | "toolSelection" | "policy" | "reliability">, number> = {
  completion: 0.25,
  outputValid: 0.2,
  evidence: 0.15,
  toolSelection: 0.15,
  policy: 0.15,
  reliability: 0.1,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Null until the task reaches a terminal state: nothing is graded mid-run. */
export function evaluateStep(e: EvalInput, at: string): Evaluation | null {
  const t = e.task;
  if (t.status !== "completed" && t.status !== "failed" && t.status !== "cancelled") return null;
  const attempts = t.attempts.length;
  const flags: string[] = [];
  const completion = t.status === "completed" ? 1 : 0;

  // Schema validity: the recorded handoff, discounted for each refused output before it.
  const myFailures = e.nodeId ? e.failures.filter((f) => f.nodeId === e.nodeId).length : 0;
  let outputValid: number | null = null;
  if (e.handoff?.state === "validated") outputValid = r2(1 / (1 + myFailures));
  else if (myFailures > 0) outputValid = 0;
  if (e.handoff?.state === "unverified") flags.push("Completed outside Atlas with no structured output.");
  if (myFailures) flags.push(`${myFailures} output${myFailures > 1 ? "s" : ""} refused by the schema check.`);

  // Evidence: linked artifacts against what the schema asks for.
  const need = e.nodeId ? (schemaFor(e.nodeId).minArtifacts ?? 0) : 0;
  const arts = (e.handoff?.output?.artifacts.length ?? 0) + t.artifacts.length;
  const evidence = need > 0 ? r2(Math.min(1, arts / need)) : arts > 0 ? 1 : null;
  if (need > 0 && arts < need) flags.push(`Needs ${need} linked artifact${need > 1 ? "s" : ""}, has ${arts}.`);

  // Tool selection: the executor must map to a granted capability; model above the route is a cost flag.
  const exec = t.attempts[t.attempts.length - 1]?.executor;
  let toolSelection: number | null = null;
  if (exec) {
    const cap = capabilityForExecutor(exec, e.routedTier);
    toolSelection = cap === null || (AGENT_GRANTS[e.agentId] ?? []).includes(cap) ? 1 : 0;
    if (toolSelection === 0) flags.push(`Ran through ${cap}, which ${e.agentId} isn't granted.`);
  }
  const models = [...new Set(t.usage.map((u) => u.model))];
  for (const m of models) {
    const mt = tierOfModel(m);
    if (mt !== null && mt > e.routedTier) flags.push(`Used ${m} (tier ${mt}); the route is tier ${e.routedTier}.`);
  }

  // Policy: approvals held for the attempt that ran, and spend stayed under the cap.
  const s = spend(t);
  let policy = 1;
  if (t.requiresApproval && attempts > 0 && approvalFor(t, attempts) !== "granted" && t.status === "completed") {
    policy = 0;
    flags.push("Completed without a granted approval for its run.");
  }
  if (e.capUsd !== undefined && e.capUsd > 0 && s.billedUsd + s.estimatedUsd > e.capUsd) {
    policy = 0;
    flags.push(`Spent more than its $${e.capUsd.toFixed(2)} cap.`);
  }

  const reliability = attempts > 0 ? r2(t.status === "completed" ? 1 / attempts : 0) : null;
  const last = t.attempts[t.attempts.length - 1];
  const latencyMs = last?.finishedAt ? Date.parse(last.finishedAt) - Date.parse(last.startedAt ?? last.requestedAt) : t.completedAt && t.startedAt ? Date.parse(t.completedAt) - Date.parse(t.startedAt) : null;

  const metrics: EvaluationMetrics = { completion, outputValid, evidence, toolSelection, policy, reliability, estimatedUsd: r2(s.estimatedUsd * 100) / 100, billedUsd: r2(s.billedUsd * 100) / 100, tokens: s.inputTokens + s.outputTokens, latencyMs };
  let total = 0;
  let weight = 0;
  for (const [k, w] of Object.entries(WEIGHTS) as [keyof typeof WEIGHTS, number][]) {
    const v = metrics[k];
    if (v === null) continue;
    total += v * w;
    weight += w;
  }
  let score = weight ? Math.round((total / weight) * 100) : null;
  // A policy breach caps the score: good output doesn't excuse skipping an approval.
  if (score !== null && policy === 0) score = Math.min(score, 40);

  return {
    id: `eval_${t.id}_${attempts}`,
    key: `${t.id}:${attempts}`,
    taskId: t.id,
    attempt: attempts,
    ...(e.runId ? { runId: e.runId } : {}),
    ...(e.nodeId ? { nodeId: e.nodeId } : {}),
    agentId: e.agentId,
    ...(e.workflowId ? { workflowId: e.workflowId } : {}),
    ...(e.workflowVersion !== undefined ? { workflowVersion: e.workflowVersion } : {}),
    promptVersion: e.promptVersion,
    model: models.length ? models.join(", ") : "No model reported",
    taskType: e.taskType,
    at,
    metrics,
    score,
    flags,
  };
}

export type GroupBy = "agentId" | "model" | "promptVersion" | "workflowVersion" | "taskType";

export interface EvalSummary {
  key: string;
  count: number;
  avgScore: number | null;
  completionRate: number | null;
  validRate: number | null;
  policyBreaches: number;
  estimatedUsd: number;
  billedUsd: number;
  avgLatencyMs: number | null;
  humanAvg: number | null;
  humanCount: number;
}

const mean = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function summarize(evals: readonly Evaluation[], by: GroupBy): EvalSummary[] {
  const groups = new Map<string, Evaluation[]>();
  for (const e of evals) {
    const k = String(e[by] ?? "unknown");
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.entries()]
    .map(([key, es]) => ({
      key,
      count: es.length,
      avgScore: mean(es.flatMap((e) => (e.score === null ? [] : [e.score]))),
      completionRate: mean(es.flatMap((e) => (e.metrics.completion === null ? [] : [e.metrics.completion]))),
      validRate: mean(es.flatMap((e) => (e.metrics.outputValid === null ? [] : [e.metrics.outputValid]))),
      policyBreaches: es.filter((e) => e.metrics.policy === 0).length,
      estimatedUsd: r2(es.reduce((a, e) => a + e.metrics.estimatedUsd, 0) * 100) / 100,
      billedUsd: r2(es.reduce((a, e) => a + e.metrics.billedUsd, 0) * 100) / 100,
      avgLatencyMs: mean(es.flatMap((e) => (e.metrics.latencyMs === null ? [] : [e.metrics.latencyMs]))),
      humanAvg: mean(es.flatMap((e) => (e.human ? [e.human.rating] : []))),
      humanCount: es.filter((e) => e.human).length,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
