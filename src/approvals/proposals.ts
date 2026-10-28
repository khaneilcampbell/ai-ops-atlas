import type { ActionsStatus, AuditRecord } from "../actions/types";
import { rerunAvailability, runId } from "../actions/rerun";
import type { RepoState, WorkflowRun } from "../github/types";
import { latestPerWorkflow, repoData } from "../lib/derive";

/**
 * Proposed actions waiting for KC's approval (autonomy level 2: the agent prepares, a person
 * decides). Derived from verified data only, never stored: a proposal exists while the facts
 * behind it hold, and disappears when they change (the run is fixed, re-run, or too old).
 * Approving still goes through the desktop app's own checks, native dialog and audit log.
 */
export interface Proposal {
  /** Stable for one run attempt, so a dismissal sticks until the run changes. */
  id: string;
  agentId: string;
  action: "rerun_failed_jobs";
  repo: string;
  run: WorkflowRun;
  title: string;
  detail: string;
  /** When the facts behind the proposal appeared (the failed run's start). */
  at: string;
}

/** Which agent proposes each action. */
export const PROPOSER: Record<Proposal["action"], string> = { rerun_failed_jobs: "atlas-rerun-failed" };

/**
 * One proposal per workflow whose latest default-branch run failed, on a repository where the
 * re-run action is switched on and usable, unless that attempt was already re-run or tried from
 * Atlas, or KC dismissed it.
 */
export function proposals(repos: Record<string, RepoState>, status: ActionsStatus | null, audit: AuditRecord[], dismissed: ReadonlySet<string>, now = Date.now()): Proposal[] {
  if (!status?.config.rerun_failed_jobs.enabled) return [];
  const out: Proposal[] = [];
  for (const repo of status.config.rerun_failed_jobs.repos) {
    const key = Object.keys(repos).find((k) => k.toLowerCase() === repo.toLowerCase()) ?? repo;
    const snap = repoData(repos[key]);
    if (!snap) continue;
    for (const run of latestPerWorkflow(snap.runs)) {
      const avail = rerunAvailability(run, key, status, now);
      const id = runId(run);
      if (!avail.show || !avail.enabled || id === null) continue;
      const attempt = run.attempt ?? 1;
      const pid = `rerun:${key.toLowerCase()}:${id}:${attempt}`;
      if (dismissed.has(pid)) continue;
      // Already tried from Atlas for this attempt (sent, started or unclear): don't ask again.
      const tried = audit.some((r) => r.action === "rerun_failed_jobs" && r.run_id === id && (r.attempt_before ?? 1) === attempt && (r.stage === "attempted" || r.stage === "started" || r.stage === "unknown"));
      if (tried) continue;
      out.push({
        id: pid,
        agentId: PROPOSER.rerun_failed_jobs,
        action: "rerun_failed_jobs",
        repo: key,
        run,
        title: `Re-run failed jobs of ${run.name}`,
        detail: `${key} · ${run.conclusion === "timed_out" ? "timed out" : "failed"} on ${run.branch}${attempt > 1 ? ` · attempt ${attempt}` : ""}`,
        at: run.createdAt,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
