import { projectRepositories } from "../catalog/projects";
import { isAiAgent } from "../catalog/roles";
import type { Agent, Catalog } from "../catalog/types";
import type { RepoState } from "../github/types";
import { observedRun, repoData, verifiedState, type Health } from "../lib/derive";
import type { BuildingInstance, ModuleTypeId } from "./types";
import type { LandmarkInstance } from "./workspace";

// Phase 3: the operational data behind a building's module, read only from sources Atlas
// already syncs (catalog manifests and GitHub repository snapshots). Nothing here is invented:
// a repository that has not been checked counts as unknown, never as healthy.

/** The projects, repositories, agents and automations a building's module is responsible for. */
export interface OperationalAssets {
  projects: string[];
  repositories: string[];
  agents: Agent[];
  automations: Agent[];
}

/**
 * Modules that oversee the whole workspace rather than one project, wherever they are housed (a
 * catalog building or a landmark). Any other landmark has no assets of its own yet, so it reports
 * nothing rather than borrowing another building's.
 */
const WORKSPACE_SCOPE: Partial<Record<ModuleTypeId, "agents" | "automations">> = {
  "agent-operations-center": "agents",
  "workflow-automation-plant": "automations",
};

export function buildingAssets(building: BuildingInstance | LandmarkInstance, catalog: Catalog): OperationalAssets {
  const scope = building.moduleType ? WORKSPACE_SCOPE[building.moduleType] : undefined;
  const project = building.projectId ? catalog.projects.find((p) => p.id === building.projectId) : undefined;
  if (project && !scope) {
    const mine = catalog.agents.filter((a) => a.projectId === project.id);
    return { projects: [project.id], repositories: projectRepositories(project, catalog.agents), agents: mine.filter(isAiAgent), automations: mine.filter((a) => !isAiAgent(a)) };
  }
  const linked = "linked" in building ? building.linked : undefined;
  const linkedProject = linked ? catalog.projects.find((p) => p.id === linked.projectId) : undefined;
  if (linked && linkedProject && !scope) {
    // A landmark that operates with a project's repository: that repository, and only the project's
    // agents that work in this building or are named as operating it (not everything else the
    // project runs).
    const here = catalog.agents.filter((a) => a.projectId === linkedProject.id && (a.workplace?.building === linked.workplace || !!linked.agents?.includes(a.id)) && a.status !== "retired");
    return { projects: [linkedProject.id], repositories: [linkedProject.repository], agents: here.filter(isAiAgent), automations: here.filter((a) => !isAiAgent(a)) };
  }
  if (!scope) return { projects: [], repositories: [], agents: [], automations: [] };
  const items = catalog.agents.filter((a) => a.status !== "retired" && (scope === "agents" ? isAiAgent(a) : !isAiAgent(a)));
  return {
    projects: [...new Set(items.map((a) => a.projectId))],
    repositories: [...new Set(items.map((a) => a.repository))],
    agents: scope === "agents" ? items : [],
    automations: scope === "automations" ? items : [],
  };
}

/** How fresh the data behind a building is. */
export type DataState = "none" | "loading" | "ok" | "stale" | "unavailable";

export interface AggregateHealth {
  health: Health;
  state: DataState;
  /** Repositories whose CI was actually checked (passing, running or failing). */
  checked: number;
  total: number;
  failing: string[];
  summary: string;
  /** Start of the newest workflow run GitHub reported across these repositories, if any. */
  lastRun?: { at: string; url: string };
}

/**
 * Health across a building's repositories, from the same GitHub CI check the map and header use.
 * Failing anywhere wins; healthy needs at least one repository checked; otherwise unknown.
 */
export function aggregateHealth(repositories: string[], repos: Record<string, RepoState>): AggregateHealth {
  const total = repositories.length;
  if (!total) return { health: "unknown", state: "none", checked: 0, total, failing: [], summary: "No telemetry connected for this building yet" };
  const states = repositories.map((r) => ({ name: r, raw: repos[r], v: verifiedState(repos[r]) }));
  const failing = states.filter((s) => s.v.kind === "failing").map((s) => s.name).sort();
  const checked = states.filter((s) => s.v.kind === "failing" || s.v.kind === "passing" || s.v.kind === "running").length;
  const loading = states.filter((s) => !s.raw || s.raw.kind === "loading").length;
  const unavailable = states.filter((s) => s.v.kind === "unavailable").length;
  const stale = states.some((s) => s.v.stale);
  const state: DataState = loading === total ? "loading" : unavailable === total ? "unavailable" : stale ? "stale" : "ok";
  const health: Health = failing.length ? "bad" : checked ? "good" : "unknown";
  const of = total === 1 ? "" : ` across ${total} repositories`;
  let summary: string;
  if (state === "loading") summary = `Checking GitHub CI${of}…`;
  else if (state === "unavailable") summary = `GitHub data unavailable${of}`;
  else if (failing.length) summary = `CI failing on ${failing.length} of ${total}: ${failing.map(short).join(", ")}`;
  else if (checked) summary = `CI passing on ${checked} of ${total} checked`;
  else summary = total === 1 ? "No CI workflows on this repository" : `No CI workflows${of}`;
  if (stale && state !== "loading") summary += " · last known, refresh failed";
  let lastRun: AggregateHealth["lastRun"];
  for (const s of states) for (const r of repoData(s.raw)?.runs ?? []) if (!lastRun || r.createdAt > lastRun.at) lastRun = { at: r.createdAt, url: r.url };
  return { health, state, checked, total, failing, summary, ...(lastRun ? { lastRun } : {}) };
}

const short = (repo: string) => repo.split("/").pop() ?? repo;

export interface ExecutionEntry {
  agentId: string;
  name: string;
  at: string;
  result: "success" | "failure" | "running" | "other";
  url: string;
}

/**
 * The latest observed GitHub workflow run of each agent or automation that declares one, newest
 * first. Items that only report elsewhere (live feed, in-app runs) show in their own panels.
 */
export function executionHistory(items: Agent[], repos: Record<string, RepoState>, limit = 5): ExecutionEntry[] {
  const out: ExecutionEntry[] = [];
  for (const a of items) {
    const run = observedRun(a, repoData(repos[a.repository]));
    if (!run) continue;
    const result = run.status !== "completed" ? "running" : run.conclusion === "success" ? "success" : run.conclusion === "failure" || run.conclusion === "timed_out" ? "failure" : "other";
    out.push({ agentId: a.id, name: a.name, at: run.createdAt, result, url: run.url });
  }
  return out.sort((x, y) => y.at.localeCompare(x.at)).slice(0, limit);
}

/** Items that declare a GitHub workflow to observe, so the history can say how much it covers. */
export const observable = (items: Agent[]) => items.filter((a) => a.observe?.githubWorkflow).length;
