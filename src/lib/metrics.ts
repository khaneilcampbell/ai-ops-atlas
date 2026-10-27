import type { Catalog, Status } from "../catalog/types";
import type { RepoState, WorkflowRun } from "../github/types";
import { latestPerWorkflow, repoData } from "./derive";

const DAY = 86_400_000;

export interface DayBucket {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  success: number;
  failure: number;
  other: number;
  commits: number;
}

export interface FailingWorkflow {
  repo: string;
  project?: string;
  run: WorkflowRun;
}

export interface Busiest {
  repo: string;
  project?: string;
  commits: number;
  runs: number;
}

export interface Metrics {
  projects: number;
  repos: number;
  synced: number;
  uncataloged: number;
  agents: number;
  agentsByStatus: Record<Status, number>;
  frameworks: number;
  /** Agents whose last run is read from a GitHub workflow rather than the manifest. */
  observedAgents: number;
  /** Workflow runs seen in the window, from each repository's latest default-branch runs. */
  runs: { total: number; success: number; failure: number; other: number; successRate: number | null };
  commits: number;
  days: DayBucket[];
  failing: FailingWorkflow[];
  busiest: Busiest[];
}

const isFailure = (r: WorkflowRun) => r.conclusion === "failure" || r.conclusion === "timed_out";

function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Workspace numbers for Mission Control. Everything is counted from the manifests and the GitHub
 * snapshots already in memory; nothing is estimated or filled in.
 */
export function workspaceMetrics(catalog: Catalog, repos: Record<string, RepoState>, uncataloged: string[], now = Date.now(), windowDays = 14): Metrics {
  const names = [...new Set(catalog.projects.map((p) => p.repository).concat(catalog.agents.map((a) => a.repository), uncataloged))];
  const projectByRepo = new Map(catalog.projects.map((p) => [p.repository, p.name]));
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime() - (windowDays - 1) * DAY;
  const days: DayBucket[] = Array.from({ length: windowDays }, (_, i) => ({ day: dayKey(from + i * DAY + DAY / 2), success: 0, failure: 0, other: 0, commits: 0 }));
  const byDay = new Map(days.map((d) => [d.day, d]));
  const runs = { total: 0, success: 0, failure: 0, other: 0 };
  let commits = 0;
  let synced = 0;
  const failing: FailingWorkflow[] = [];
  const busiest: Busiest[] = [];

  for (const name of names) {
    const snap = repoData(repos[name]);
    if (!snap) continue;
    synced++;
    let rc = 0;
    let cc = 0;
    for (const r of snap.runs) {
      const t = Date.parse(r.createdAt);
      if (!(t >= from && t <= now)) continue;
      const b = byDay.get(dayKey(t));
      if (!b) continue;
      rc++;
      runs.total++;
      if (r.conclusion === "success") {
        runs.success++;
        b.success++;
      } else if (isFailure(r)) {
        runs.failure++;
        b.failure++;
      } else {
        runs.other++;
        b.other++;
      }
    }
    for (const c of snap.commits) {
      const t = Date.parse(c.date);
      const b = t >= from && t <= now ? byDay.get(dayKey(t)) : undefined;
      if (!b) continue;
      cc++;
      commits++;
      b.commits++;
    }
    for (const r of latestPerWorkflow(snap.runs)) if (isFailure(r)) failing.push({ repo: name, project: projectByRepo.get(name), run: r });
    if (rc || cc) busiest.push({ repo: name, project: projectByRepo.get(name), commits: cc, runs: rc });
  }

  const agentsByStatus: Record<Status, number> = { active: 0, idle: 0, paused: 0, attention: 0, retired: 0 };
  for (const a of catalog.agents) agentsByStatus[a.status]++;
  const settled = runs.success + runs.failure;

  return {
    projects: catalog.projects.length,
    repos: names.length,
    synced,
    uncataloged: uncataloged.length,
    agents: catalog.agents.length,
    agentsByStatus,
    frameworks: new Set(catalog.agents.map((a) => a.framework)).size,
    observedAgents: catalog.agents.filter((a) => a.observe?.githubWorkflow).length,
    runs: { ...runs, successRate: settled ? runs.success / settled : null },
    commits,
    days,
    failing: failing.sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt)),
    busiest: busiest.sort((a, b) => b.commits + b.runs - (a.commits + a.runs) || a.repo.localeCompare(b.repo)).slice(0, 6),
  };
}
