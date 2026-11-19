import { STALE_MS, type ProductionEvent } from "../production/model";
import type { Agent } from "../catalog/types";
import type { RepoSnapshot } from "../github/types";
import type { Run } from "../intel/types";
import type { AgentRun } from "../live/apply";
import { n8nWorkflowIds } from "../n8n/links";
import type { N8nRun, N8nSnapshot } from "../n8n/types";
import { runResult } from "../lib/activity";
import type { ExecutionRecord, KpiMeasure, Kpi, Operational, Telemetry } from "./types";
import type { AgentProfile } from "./profile";

const DAY = 86_400_000;

/** The runs that decide status: everything except GitHub runs on non-default branches. */
export const mainline = (xs: ExecutionRecord[]) => xs.filter((e) => !e.offMainline);

/** A run cut off because the app closed is not a failure of the agent, so it doesn't count
 * against the success rate or the "Latest run failed" status. The scheduler runs it again. */
function intelResult(r: Run): ExecutionRecord["result"] {
  if (r.status === "succeeded" || r.status === "reused") return "success";
  if (r.status === "failed") return "failure";
  if (r.status === "queued" || r.status === "running") return "running";
  return "other";
}

const FEED_RESULT: Record<AgentRun["status"], ExecutionRecord["result"]> = { ok: "success", failed: "failure", skipped: "other", paused: "other" };

/** How runtimeFor names these sources (office/model.ts); the plaza reads them to avoid double counting. */
export const N8N_SOURCE = "n8n runs";
export const AUTOMATIONS_SOURCE = "Its automations";

const N8N_RESULT: Record<N8nRun["status"], ExecutionRecord["result"]> = { success: "success", error: "failure", crashed: "failure", canceled: "other", running: "running", waiting: "running", new: "running", unknown: "other" };

/** The recent n8n runs of the workflows an agent links to, newest first. */
export function n8nExecutions(agent: Pick<Agent, "links">, n8n: N8nSnapshot | null | undefined): ExecutionRecord[] {
  if (n8n?.state !== "ok") return [];
  const ids = n8nWorkflowIds(agent);
  const out: ExecutionRecord[] = [];
  for (const w of n8n.workflows) {
    if (!ids.includes(w.id)) continue;
    for (const r of w.runs) {
      const at = r.startedAt ?? r.stoppedAt;
      if (!at) continue;
      const ms = r.startedAt && r.stoppedAt ? Date.parse(r.stoppedAt) - Date.parse(r.startedAt) : null;
      out.push({
        at,
        result: N8N_RESULT[r.status] ?? "other",
        label: `${w.name} · ${r.status}${r.mode ? ` · ${r.mode}` : ""}`,
        url: /^https:\/\//.test(n8n.instance) ? `${n8n.instance}/workflow/${w.id}/executions/${r.id}` : undefined,
        durationMs: ms != null && Number.isFinite(ms) && ms >= 0 ? ms : null,
        source: "n8n",
      });
    }
  }
  return out;
}

/**
 * Execution telemetry for one agent, from the live sources its manifest declares: GitHub
 * workflow runs, the app's own run log for agents that run inside Atlas, or the phase results
 * a pipeline outside Atlas reports to the live feed. Manifest
 * `last_run` and `history` are hand-written records, not telemetry, and are not used here.
 */
export function telemetryFor(agent: Agent, snap: RepoSnapshot | undefined, intelRuns: Run[] | null, intelSpend?: { month: number; budget: number } | null, agentRuns: AgentRun[] | null = null, production: ProductionEvent[] = [], now = Date.now(), n8n: N8nSnapshot | null = null): Telemetry {
  let executions: ExecutionRecord[] = [];
  let source: Telemetry["source"] = null;
  let loaded = false;
  const reports = production.filter(e => e.body.agentId === agent.id);
  const latestReport = reports.reduce<ProductionEvent | undefined>((a,b) => !a || b.id > a.id ? b : a, undefined);
  const productionFresh = !!latestReport && now - Date.parse(latestReport.at) < STALE_MS;
  const wf = agent.observe?.githubWorkflow;
  if (reports.length || (agent.registry?.governance?.autonomy === 3 && !agent.observe?.agentFeed)) {
    source = reports.length ? "production" : null;
    loaded = reports.length > 0;
    executions = reports.filter(e => e.body.kind === "run").map(e => ({ at: e.at, result: e.body.status!, label: `Production run ${e.body.runId}`, durationMs: e.body.durationMs, costUsd: e.body.costUsd, source: "production" as const }));
  } else if (wf) {
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
    // The run log holds both repository analyses and engineering reviews.
    const kind = agent.observe.atlasIntelRuns ?? "repository";
    executions = (intelRuns ?? []).filter((r) => (r.kind ?? "repository") === kind).map((r) => ({
      at: r.finished_at ?? r.started_at ?? r.queued_at,
      result: intelResult(r),
      label: `${kind === "ecosystem" ? "All catalog repositories" : r.repo} · ${r.trigger} · ${r.model}${r.status === "interrupted" ? " · interrupted, app closed" : ""}`,
      durationMs: r.duration_ms,
      costUsd: r.cost_usd,
      source: "atlas-intel" as const,
    }));
  } else if (agent.observe?.agentFeed) {
    source = "agent-feed";
    loaded = agentRuns !== null;
    executions = (agentRuns ?? []).filter((r) => r.agents.includes(agent.id)).map((r) => ({
      at: r.at,
      result: FEED_RESULT[r.status],
      label: r.detail ? `${r.phase} · ${r.status} · ${r.detail}` : `${r.phase} · ${r.status}`,
      source: "agent-feed" as const,
    }));
  } else if (n8nWorkflowIds(agent).length) {
    // Its own n8n workflows (links labelled n8n), from the read-only run summary (src/n8n/runs.ts).
    source = "n8n";
    loaded = n8n?.state === "ok";
    executions = n8nExecutions(agent, n8n);
  }
  return summarize(source, loaded, executions, { productionFresh, productionSeenAt: latestReport?.at, spend: source === "atlas-intel" ? intelSpend ?? null : null });
}

function summarize(source: Telemetry["source"], loaded: boolean, executions: ExecutionRecord[], extra: { productionFresh?: boolean; productionSeenAt?: string; spend?: { month: number; budget: number } | null; via?: string[] } = {}): Telemetry {
  executions.sort((a, b) => b.at.localeCompare(a.at));
  const counted = mainline(executions);
  const completed = counted.filter((e) => e.result === "success" || e.result === "failure");
  const durations = counted.map((e) => e.durationMs).filter((d): d is number => typeof d === "number");
  return {
    source,
    loaded,
    productionFresh: extra.productionFresh ?? false,
    productionSeenAt: extra.productionSeenAt,
    ...(extra.via ? { via: extra.via } : {}),
    executions,
    lastVerifiedRun: counted.find((e) => e.result === "success") ?? null,
    lastAnyRun: counted[0] ?? null,
    successRate: completed.length ? completed.filter((e) => e.result === "success").length / completed.length : null,
    failures: counted.filter((e) => e.result === "failure").length,
    avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    monthSpendUsd: extra.spend ? extra.spend.month : null,
    monthBudgetUsd: extra.spend ? extra.spend.budget : null,
  };
}

/**
 * An owning agent runs through the automations it owns (catalog owned_by). When it has no live
 * source of its own, its telemetry is their runs together, each labelled with the automation that
 * ran it. Loaded once any of them has loaded. Unchanged when it has its own source or owns nothing
 * with a source, so it never borrows evidence it doesn't have.
 */
export function withOwnedRuns(own: Telemetry, owned: readonly { name: string; telemetry: Telemetry }[]): Telemetry {
  if (own.source) return own;
  const sourced = owned.filter((o) => o.telemetry.source);
  if (!sourced.length) return own;
  const executions = sourced.flatMap((o) => o.telemetry.executions.map((e) => ({ ...e, label: `${o.name} · ${e.label}`, via: o.name })));
  return summarize("automations", sourced.some((o) => o.telemetry.loaded), executions, { via: sourced.map((o) => o.name) });
}

/** Configured is not the same as working: only an observed successful run counts as verified. */
export function operationalState(p: Pick<AgentProfile, "classification"> & Partial<Pick<AgentProfile, "governance">>, t: Telemetry): Operational {
  if (p.classification === "F") return "planned";
  if ((t.source === "production" || (p.governance?.autonomy === 3 && t.source !== "agent-feed")) && !t.productionFresh) return "unknown";
  const latest = mainline(t.executions).find((e) => e.result === "success" || e.result === "failure");
  if (latest?.result === "failure") return "failing";
  if (t.lastVerifiedRun) return "verified";
  return "configured";
}

export const OPERATIONAL_LABEL: Record<Operational, string> = {
  unknown: "Production status unknown",
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
