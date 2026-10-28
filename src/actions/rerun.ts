import type { WorkflowRun } from "../github/types";
import type { ActionsStatus, AuditRecord, Stage } from "./types";

/** GitHub only re-runs workflow runs from the last 30 days. */
export const RERUN_WINDOW_MS = 30 * 86_400_000;

/** The run's numeric id: stored on newer snapshots, otherwise read from its GitHub URL. */
export function runId(run: WorkflowRun): number | null {
  if (run.id) return run.id;
  const m = /\/actions\/runs\/(\d+)/.exec(run.url ?? "");
  return m ? Number(m[1]) : null;
}

export type Availability = { show: false } | { show: true; enabled: true } | { show: true; enabled: false; reason: string };

/**
 * Whether to offer "Re-run failed jobs" for a run. Nothing is shown until the action is
 * switched on in Settings, so the dashboard looks the same for anyone who never opts in.
 */
export function rerunAvailability(run: WorkflowRun, repo: string, status: ActionsStatus | null, now = Date.now()): Availability {
  const failed = run.status === "completed" && (run.conclusion === "failure" || run.conclusion === "timed_out");
  if (!status || !status.config.rerun_failed_jobs.enabled || !failed) return { show: false };
  const off = (reason: string): Availability => ({ show: true, enabled: false, reason });
  if (!status.token) return off("Add an Actions token in Settings");
  if (!status.config.rerun_failed_jobs.repos.some((r) => r.toLowerCase() === repo.toLowerCase())) return off("Not enabled for this repository in Settings");
  if (now - Date.parse(run.createdAt) > RERUN_WINDOW_MS) return off("GitHub only re-runs runs from the last 30 days");
  if (runId(run) === null) return off("Refresh to load this run");
  return { show: true, enabled: true };
}

/** One entry per press of the button: the latest record of each audit id, newest first. */
export function latestPerAttempt(log: AuditRecord[]): AuditRecord[] {
  const byId = new Map<string, AuditRecord>();
  for (const r of log) {
    const prev = byId.get(r.id);
    if (!prev || r.at >= prev.at) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
}

export const STAGE_LABEL: Record<Stage, string> = {
  refused: "Not allowed",
  cancelled: "Cancelled",
  attempted: "Sent",
  started: "Started",
  merged: "Merged",
  failed: "Failed",
  unknown: "Outcome unknown",
};

/** How the activity feed, the office and Settings name one audit record. */
export function describeRecord(r: AuditRecord): { title: string; subject: string; url: string; result: "success" | "failure" | "running" | "other" } {
  const result = r.stage === "started" || r.stage === "merged" ? "success" : r.stage === "failed" || r.stage === "unknown" ? "failure" : r.stage === "attempted" ? "running" : "other";
  if (r.action === "merge_pull_request") {
    const n = r.pull_number ?? 0;
    return {
      title: `Merge pull request: ${STAGE_LABEL[r.stage]}`,
      subject: `#${n}${r.title ? ` ${r.title}` : ""}`,
      url: `https://github.com/${r.repo}/pull/${n}`,
      result,
    };
  }
  return {
    title: `Re-run failed jobs: ${STAGE_LABEL[r.stage]}`,
    subject: `${r.workflow ?? "Workflow run"}${r.run_number ? ` #${r.run_number}` : ""}`,
    url: `https://github.com/${r.repo}/actions/runs/${r.run_id}`,
    result,
  };
}
