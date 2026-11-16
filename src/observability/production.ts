// Numbers for the Production health panel, counted from what Atlas already holds: the Task Center,
// the execution ledger and the GitHub runs of Atlas's own CI. Pure, so it is tested without a page.

import type { WorkflowRun } from "../github/types";
import type { StoredTask } from "../tasks/types";

export interface WorkSummary {
  failed: number;
  running: number;
  awaitingApproval: number;
  blocked: number;
  /** Sends with no clear answer that a person must check in the outside system. */
  needsReconcile: number;
}

export function workSummary(tasks: readonly Pick<StoredTask, "status">[], ledgers: readonly { needsReconcile: Record<string, string> }[]): WorkSummary {
  const n = (s: StoredTask["status"]) => tasks.filter((t) => t.status === s).length;
  return {
    failed: n("failed"),
    running: n("running"),
    awaitingApproval: n("awaiting_approval"),
    blocked: n("blocked"),
    needsReconcile: ledgers.reduce((sum, l) => sum + Object.keys(l.needsReconcile ?? {}).length, 0),
  };
}

export type ReleaseState = "passing" | "failing" | "running" | "unknown";

export interface ReleaseSummary {
  state: ReleaseState;
  latest: WorkflowRun | null;
  history: WorkflowRun[];
  successRate: number | null;
}

/** Atlas's own CI on main: each green run signs and publishes a Mac update and redeploys the site. */
export function releaseSummary(runs: readonly WorkflowRun[] | undefined, limit = 6): ReleaseSummary {
  const main = (runs ?? []).filter((r) => r.name === "CI" && r.branch === "main" && r.event !== "pull_request").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = main[0] ?? null;
  const done = main.filter((r) => r.status === "completed" && (r.conclusion === "success" || r.conclusion === "failure"));
  const state: ReleaseState = !latest ? "unknown" : latest.status !== "completed" ? "running" : latest.conclusion === "success" ? "passing" : latest.conclusion === "failure" ? "failing" : "unknown";
  return { state, latest, history: main.slice(0, limit), successRate: done.length ? done.filter((r) => r.conclusion === "success").length / done.length : null };
}
