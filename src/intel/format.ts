import type { AgentConfig, AiState, Run, RunStatus } from "./types";

export function usd(v: number | null | undefined, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const d = digits ?? (v !== 0 && Math.abs(v) < 0.01 ? 4 : v < 1 ? 3 : 2);
  return `$${v.toFixed(d)}`;
}

export function tokens(n: number | null | undefined): string {
  if (n == null) return "–";
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "–";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export const RUN_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  reused: "Reused, unchanged",
  insufficient_data: "Not enough data",
  blocked: "Blocked",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

/** Maps a run outcome onto the app's existing status pill classes. */
export function runTone(s: RunStatus): "active" | "idle" | "attention" | "retired" | "paused" {
  switch (s) {
    case "succeeded":
    case "reused":
      return "active";
    case "queued":
    case "running":
      return "paused";
    case "failed":
    case "interrupted":
    case "blocked":
      return "attention";
    default:
      return "idle";
  }
}

export const AI_STATE_LABEL: Record<AiState, string> = {
  analyzed: "Current",
  reused: "Current (reused, nothing changed)",
  insufficient_data: "Not enough data to analyze",
  stale: "Out of date",
  not_assessed: "Not analyzed yet",
};

export function isActive(r: Run) {
  return r.status === "queued" || r.status === "running";
}

export interface CostRollup {
  total: number;
  month: number;
  runsWithCost: number;
  inputTokens: number;
  outputTokens: number;
  byRepo: { repo: string; cost: number; runs: number; calls: number }[];
}

/** Totals across runs. Costs are estimates from reported tokens and configured prices. */
export function rollup(runs: Run[], now = new Date()): CostRollup {
  const byRepo = new Map<string, { repo: string; cost: number; runs: number; calls: number }>();
  let total = 0;
  let month = 0;
  let runsWithCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const r of runs) {
    const entry = byRepo.get(r.repo) ?? { repo: r.repo, cost: 0, runs: 0, calls: 0 };
    entry.runs++;
    entry.calls += r.attempts;
    if (r.cost_usd != null) {
      entry.cost += r.cost_usd;
      total += r.cost_usd;
      runsWithCost++;
      const t = r.started_at ? new Date(r.started_at) : null;
      if (t && t.getUTCFullYear() === now.getUTCFullYear() && t.getUTCMonth() === now.getUTCMonth()) month += r.cost_usd;
    }
    if (r.usage) {
      inputTokens += r.usage.input_tokens + r.usage.cache_creation_input_tokens + r.usage.cache_read_input_tokens;
      outputTokens += r.usage.output_tokens;
    }
    byRepo.set(r.repo, entry);
  }
  return {
    total,
    month,
    runsWithCost,
    inputTokens,
    outputTokens,
    byRepo: [...byRepo.values()].sort((a, b) => b.cost - a.cost || a.repo.localeCompare(b.repo)),
  };
}

/** The most recent run of each status kind that matters to the inspector. */
export function lastRuns(runs: Run[]) {
  // `runs` arrive newest first.
  return {
    latest: runs[0],
    lastSuccess: runs.find((r) => r.status === "succeeded"),
    lastFailure: runs.find((r) => r.status === "failed" || r.status === "interrupted"),
  };
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Mon, Wed and Fri at 08:00" */
export function scheduleLabel(s: AgentConfig["schedule"]): string {
  const days = [...s.days].sort((a, b) => a - b).map((d) => DAY_NAMES[d] ?? "?");
  if (days.length === 0) return "No days chosen";
  const list = days.length === 7 ? "Every day" : days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
  return `${list} at ${s.at}`;
}
