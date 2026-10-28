import type { Agent } from "../catalog/types";
import type { RepoSnapshot } from "../github/types";
import type { Run } from "../intel/types";
import { runResult } from "../lib/activity";
import type { ExecutionRecord, KpiMeasure, Kpi, Operational, Telemetry } from "./types";
import type { AgentProfile } from "./profile";

const DAY = 86_400_000;

/** The runs that decide status: everything except GitHub runs on non-default branches. */
export const mainline = (xs: ExecutionRecord[]) => xs.filter((e) => !e.offMainline);

function intelResult(r: Run): ExecutionRecord["result"] {
  if (r.status === "succeeded" || r.status === "reused") return "success";
  if (r.status === "failed" || r.status === "interrupted") return "failure";
  if (r.status === "queued" || r.status === "running") return "running";
  return "other";
}

/**
 * Execution telemetry for one agent, from the live sources its manifest declares: GitHub
 * workflow runs, or the app's own run log for agents that run inside Atlas. Manifest
 * `last_run` and `history` are hand-written records, not telemetry, and are not used here.
 */
export function telemetryFor(agent: Agent, snap: RepoSnapshot | undefined, intelRuns: Run[] | null, intelSpend?: { month: number; budget: number } | null): Telemetry {
  let executions: ExecutionRecord[] = [];
  let source: Telemetry["source"] = null;
  let loaded = false;
  const wf = agent.observe?.githubWorkflow;
  if (wf) {
    source = "github";
    loaded = !!snap;
    // With the default branch unknown (older cached data), every run counts as before.
    const main = snap?.defaultBranch;
    executions = (snap?.workflowRuns[wf] ?? []).map((r) => ({
      at: r.createdAt,
      result: runResult(r),
      label: `${r.name} · ${r.event} on ${r.branch}`,
      url: r.url,
      source: "github" as const,
      ...(main && r.branch !== main ? { offMainline: true } : {}),
    }));
  } else if (agent.observe?.atlasIntel) {
    source = "atlas-intel";
    loaded = intelRuns !== null;
    executions = (intelRuns ?? []).map((r) => ({
      at: r.finished_at ?? r.started_at ?? r.queued_at,
      result: intelResult(r),
      label: `${r.repo} · ${r.trigger} · ${r.model}`,
      durationMs: r.duration_ms,
      costUsd: r.cost_usd,
      source: "atlas-intel" as const,
    }));
  }
  executions.sort((a, b) => b.at.localeCompare(a.at));
  const counted = mainline(executions);
  const completed = counted.filter((e) => e.result === "success" || e.result === "failure");
  const durations = counted.map((e) => e.durationMs).filter((d): d is number => typeof d === "number");
  return {
    source,
    loaded,
    executions,
    lastVerifiedRun: counted.find((e) => e.result === "success") ?? null,
    lastAnyRun: counted[0] ?? null,
    successRate: completed.length ? completed.filter((e) => e.result === "success").length / completed.length : null,
    failures: counted.filter((e) => e.result === "failure").length,
    avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    monthSpendUsd: source === "atlas-intel" && intelSpend ? intelSpend.month : null,
    monthBudgetUsd: source === "atlas-intel" && intelSpend ? intelSpend.budget : null,
  };
}

/** Configured is not the same as working: only an observed successful run counts as verified. */
export function operationalState(p: Pick<AgentProfile, "classification">, t: Telemetry): Operational {
  if (p.classification === "F") return "planned";
  const latest = mainline(t.executions).find((e) => e.result === "success" || e.result === "failure");
  if (latest?.result === "failure") return "failing";
  if (t.lastVerifiedRun) return "verified";
  return "configured";
}

export const OPERATIONAL_LABEL: Record<Operational, string> = {
  verified: "Verified running",
  failing: "Latest run failed",
  configured: "Configured, not verified",
  planned: "Planned",
};

/** An observed KPI value, only when the KPI names a measure and the telemetry can supply it. */
export function observeKpi(kpi: Kpi, t: Telemetry, now = Date.now()): { value: number; display: string; samples: number } | null {
  if (!kpi.measure) return null;
  return measure(kpi.measure, t, now);
}

function measure(m: KpiMeasure, t: Telemetry, now: number): { value: number; display: string; samples: number } | null {
  const counted = mainline(t.executions);
  const completed = counted.filter((e) => e.result === "success" || e.result === "failure");
  switch (m) {
    case "run_success_rate":
      if (t.successRate === null) return null;
      return { value: t.successRate * 100, display: `${Math.round(t.successRate * 100)}%`, samples: completed.length };
    case "runs_last_30d": {
      if (!t.loaded) return null;
      const n = counted.filter((e) => now - Date.parse(e.at) <= 30 * DAY).length;
      return { value: n, display: String(n), samples: counted.length };
    }
    case "avg_duration_minutes":
      if (t.avgDurationMs === null) return null;
      return { value: t.avgDurationMs / 60_000, display: `${(t.avgDurationMs / 60_000).toFixed(1)} min`, samples: counted.filter((e) => e.durationMs != null).length };
    case "month_spend_usd":
      if (t.monthSpendUsd === null) return null;
      return { value: t.monthSpendUsd, display: `$${t.monthSpendUsd.toFixed(2)}`, samples: 1 };
  }
}

/** Whether an observed value meets a numeric target. Null when either side is missing. */
export function meetsTarget(kpi: Kpi, observed: number | null): boolean | null {
  if (observed === null || kpi.targetValue === null || !kpi.direction) return null;
  return kpi.direction === "min" ? observed >= kpi.targetValue : observed <= kpi.targetValue;
}

/**
 * Trend over the observed runs: success rate of the newer half against the older half.
 * Needs at least 6 completed runs, otherwise there is not enough history.
 */
export function successTrend(t: Telemetry): "up" | "down" | "flat" | null {
  const done = mainline(t.executions).filter((e) => e.result === "success" || e.result === "failure");
  if (done.length < 6) return null;
  const half = Math.floor(done.length / 2);
  const rate = (xs: ExecutionRecord[]) => xs.filter((e) => e.result === "success").length / xs.length;
  const diff = rate(done.slice(0, half)) - rate(done.slice(half));
  return Math.abs(diff) < 0.05 ? "flat" : diff > 0 ? "up" : "down";
}
