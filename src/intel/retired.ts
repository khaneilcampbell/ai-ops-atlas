import { RETIRED_REPOSITORIES } from "../catalog/projects";
import type { AgentStatus, Report, Run } from "./types";

const RETIRED = new Set(RETIRED_REPOSITORIES.map((r) => r.toLowerCase()));

/** A repository that was deleted or retired from GitHub, kept out of every Atlas list. */
export function isRetiredRepo(repo: string): boolean {
  return RETIRED.has(repo.toLowerCase());
}

/**
 * Drops repository runs for retired repositories. Engineering reviews cover the whole catalog,
 * so they stay; their repository list comes from the catalog, which no longer has them.
 */
export function withoutRetiredRuns(runs: Run[]): Run[] {
  return runs.filter((r) => (r.kind ?? "repository") !== "repository" || !isRetiredRepo(r.repo));
}

/** The agent status with retired repositories taken off the assigned list and the run log. */
export function withoutRetired(status: AgentStatus): AgentStatus {
  const assigned = status.config.assigned.filter((r) => !isRetiredRepo(r));
  const runs = withoutRetiredRuns(status.runs);
  if (assigned.length === status.config.assigned.length && runs.length === status.runs.length) return status;
  return { ...status, config: { ...status.config, assigned }, runs };
}

export function withoutRetiredReports(reports: Report[]): Report[] {
  return reports.filter((r) => !isRetiredRepo(r.repo));
}
