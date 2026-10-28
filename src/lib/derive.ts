import type { Agent, Catalog, ManifestIssue, Project } from "../catalog/types";
import type { RepoSnapshot, RepoState, WorkflowRun } from "../github/types";
import { PRIVATE_OR_MISSING } from "../github/transport";
import { daysSince } from "./time";

export type Health = "good" | "warn" | "bad" | "unknown";

export interface HealthIndicator {
  key: string;
  label: string;
  value: string;
  health: Health;
}

export function repoData(state: RepoState | undefined): RepoSnapshot | undefined {
  if (!state) return undefined;
  return state.kind === "ok" ? state.data : state.kind === "error" ? state.data : undefined;
}

/**
 * Dependabot's own update jobs ("cargo in /src-tauri for glib - Update #123") run as
 * "dynamic" events on the default branch. Each has a unique name, and a failed one only
 * means Dependabot could not open a PR, so it says nothing about the repository's CI.
 */
export function isDependabotJob(r: WorkflowRun): boolean {
  return r.event === "dynamic" && / - Update #\d+$/.test(r.name);
}

/** The latest run of each of the repository's own workflows on the default branch. */
export function latestPerWorkflow(runs: WorkflowRun[]): WorkflowRun[] {
  const seen = new Map<string, WorkflowRun>();
  for (const r of runs) if (!isDependabotJob(r) && !seen.has(r.name)) seen.set(r.name, r);
  return [...seen.values()];
}

export function ciHealth(snap: RepoSnapshot | undefined): HealthIndicator {
  if (!snap) return { key: "ci", label: "CI", value: "Not loaded", health: "unknown" };
  const latest = latestPerWorkflow(snap.runs);
  if (!latest.length) return { key: "ci", label: "CI", value: "No workflows", health: "unknown" };
  const failing = latest.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out");
  if (failing.length) return { key: "ci", label: "CI", value: `${failing.length} failing`, health: "bad" };
  if (latest.some((r) => r.status !== "completed")) return { key: "ci", label: "CI", value: "Running", health: "good" };
  return { key: "ci", label: "CI", value: "Passing", health: "good" };
}

export function repoHealth(snap: RepoSnapshot | undefined, linkedAgents: number): HealthIndicator[] {
  const days = daysSince(snap?.pushedAt);
  return [
    ciHealth(snap),
    {
      key: "activity",
      label: "Last push",
      value: days === null ? "Unknown" : days === 0 ? "Today" : `${days} d ago`,
      health: days === null ? "unknown" : days <= 14 ? "good" : days <= 60 ? "warn" : "bad",
    },
    {
      key: "issues",
      label: "Open issues + PRs",
      value: snap ? String(snap.openIssues) : "–",
      health: !snap ? "unknown" : snap.openIssues > 10 ? "warn" : "good",
    },
    {
      key: "license",
      label: "License",
      value: snap ? snap.license ?? "None" : "–",
      health: !snap ? "unknown" : snap.license ? "good" : "warn",
    },
    {
      key: "agents",
      label: "Linked agents",
      value: String(linkedAgents),
      // Plenty of repositories have no agents, so zero is neutral rather than a warning.
      health: linkedAgents ? "good" : "unknown",
    },
  ];
}

export function overallHealth(ind: HealthIndicator[]): Health {
  if (ind.some((i) => i.health === "bad")) return "bad";
  if (ind.some((i) => i.health === "warn")) return "warn";
  if (ind.filter((i) => i.key !== "agents").every((i) => i.health === "unknown")) return "unknown";
  return "good";
}

/**
 * Latest observed run on the default branch for an agent that declares observe.github_workflow.
 * A failed pull request or Dependabot run doesn't mean the agent is failing. Any branch counts
 * when the default branch isn't known.
 */
export function observedRun(agent: Agent, snap: RepoSnapshot | undefined): WorkflowRun | undefined {
  const wf = agent.observe?.githubWorkflow;
  const runs = (wf && snap?.workflowRuns[wf]) || [];
  return snap?.defaultBranch ? runs.find((r) => r.branch === snap.defaultBranch) : runs[0];
}

/** Manifest value, unless GitHub has a newer observed run. */
export function effectiveLastRun(agent: Agent, snap: RepoSnapshot | undefined): string | null {
  const run = observedRun(agent, snap);
  if (run && (!agent.lastRun || run.createdAt > agent.lastRun)) return run.createdAt;
  return agent.lastRun;
}

export interface AttentionItem {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  target?: { kind: "agent" | "repo"; id: string };
}

export function attentionItems(
  catalog: Catalog,
  repos: Record<string, RepoState>,
  issues: ManifestIssue[],
  now = Date.now(),
  uncataloged: string[] = [],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const i of issues) {
    items.push({ id: `manifest:${i.file}:${i.message}`, severity: "medium", title: `Manifest problem in ${i.file}`, detail: i.message });
  }
  for (const a of catalog.agents) {
    const snap = repoData(repos[a.repository]);
    const target = { kind: "agent" as const, id: a.id };
    if (a.status === "attention") {
      items.push({ id: `agent:${a.id}:flag`, severity: "high", title: a.name, detail: "Marked as needing attention in its manifest", target });
    }
    const run = observedRun(a, snap);
    if (run && (run.conclusion === "failure" || run.conclusion === "timed_out")) {
      items.push({ id: `agent:${a.id}:run`, severity: "high", title: a.name, detail: `Latest ${run.name} run failed on ${run.branch}`, target });
    }
    if (a.status === "active") {
      const last = effectiveLastRun(a, snap);
      const d = daysSince(last, now);
      // Without a live source, a missing run only means nobody filled in last_run by hand.
      const observed = !!a.observe?.githubWorkflow;
      // An event-driven agent runs when its event happens, so a quiet stretch is normal.
      const eventDriven = a.registry?.execution?.triggerType === "event";
      if (d === null) {
        if (observed) items.push({ id: `agent:${a.id}:norun`, severity: "low", title: a.name, detail: "Active, but no run is recorded yet", target });
      } else if (d > 7 && !eventDriven) {
        items.push({ id: `agent:${a.id}:stale`, severity: "medium", title: a.name, detail: `Active, but last run was ${d} days ago`, target });
      }
    }
  }
  for (const p of catalog.projects) {
    const state = repos[p.repository];
    const target = { kind: "repo" as const, id: p.repository };
    if (state?.kind === "error") {
      // A private repository without a token is expected, not a fault in the repository.
      const severity = state.message === PRIVATE_OR_MISSING ? "low" : "medium";
      items.push({ id: `repo:${p.repository}:error`, severity, title: p.repository, detail: state.message, target });
    }
    const snap = repoData(state);
    if (!snap) continue;
    const ci = ciHealth(snap);
    if (ci.health === "bad") items.push({ id: `repo:${p.repository}:ci`, severity: "high", title: p.repository, detail: `CI: ${ci.value}`, target });
    const d = daysSince(snap.pushedAt, now);
    if (p.status === "active" && d !== null && d > 60) {
      items.push({ id: `repo:${p.repository}:stale`, severity: "low", title: p.repository, detail: `Active project with no push in ${d} days`, target });
    }
    if (snap.archived && p.status === "active") {
      items.push({ id: `repo:${p.repository}:archived`, severity: "medium", title: p.repository, detail: "Repository is archived but the project is active", target });
    }
  }
  for (const name of uncataloged) {
    const ci = ciHealth(repoData(repos[name]));
    if (ci.health === "bad") items.push({ id: `repo:${name}:ci`, severity: "high", title: name, detail: `CI: ${ci.value}`, target: { kind: "repo", id: name } });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

export interface ActivityItem {
  id: string;
  at: string;
  kind: "commit" | "run" | "agent";
  title: string;
  subtitle: string;
  url?: string;
  target?: { kind: "agent" | "repo"; id: string };
}

export function activityFeed(catalog: Catalog, repos: Record<string, RepoState>, filter?: { repo?: string; agent?: string }): ActivityItem[] {
  const out: ActivityItem[] = [];
  const projectsByRepo = new Map(catalog.projects.map((p) => [p.repository, p]));
  for (const [name, state] of Object.entries(repos)) {
    if (filter?.agent || (filter?.repo && filter.repo !== name)) continue;
    const snap = repoData(state);
    if (!snap) continue;
    const label = projectsByRepo.get(name)?.name ?? name;
    for (const c of snap.commits) {
      out.push({ id: `c:${c.sha}`, at: c.date, kind: "commit", title: c.message, subtitle: `${label} · ${c.author}`, url: c.url, target: { kind: "repo", id: name } });
    }
    for (const r of snap.runs.slice(0, 5)) {
      out.push({
        id: `r:${r.url}`,
        at: r.createdAt,
        kind: "run",
        title: `${r.name}: ${r.conclusion ?? r.status}`,
        subtitle: `${label} · ${r.event}`,
        url: r.url,
        target: { kind: "repo", id: name },
      });
    }
  }
  for (const a of catalog.agents) {
    if (filter?.agent && filter.agent !== a.id) continue;
    if (filter?.repo && filter.repo !== a.repository) continue;
    for (const h of a.history) {
      out.push({ id: `h:${a.id}:${h.at}:${h.event}`, at: h.at, kind: "agent", title: h.event, subtitle: a.name, target: { kind: "agent", id: a.id } });
    }
    if (filter?.agent) {
      const snap = repoData(repos[a.repository]);
      const wf = a.observe?.githubWorkflow;
      for (const r of (wf && snap?.workflowRuns[wf]) || []) {
        out.push({ id: `w:${r.url}`, at: r.createdAt, kind: "run", title: `${r.name}: ${r.conclusion ?? r.status}`, subtitle: `${r.event} on ${r.branch}`, url: r.url });
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function projectOf(catalog: Catalog, id: string): Project | undefined {
  return catalog.projects.find((p) => p.id === id);
}

/**
 * What the map can honestly say about a repository's checks: failing now, passing, no CI,
 * data unavailable (GitHub refused or the repository is private or missing), or not verified
 * yet (still loading, or never synced). `stale` marks data kept from an earlier sync.
 */
export type Verified = "failing" | "passing" | "no-ci" | "unavailable" | "unverified";

export function verifiedState(state: RepoState | undefined): { kind: Verified; label: string; stale: boolean } {
  if (!state || state.kind === "loading") return { kind: "unverified", label: "Not verified yet", stale: false };
  const snap = repoData(state);
  if (!snap) return { kind: "unavailable", label: "GitHub data unavailable", stale: false };
  const stale = state.kind === "error" || state.stale;
  const ci = ciHealth(snap);
  const kind: Verified = ci.health === "bad" ? "failing" : ci.value === "No workflows" ? "no-ci" : "passing";
  const label = kind === "failing" ? `CI ${ci.value} now` : kind === "no-ci" ? "No CI workflows" : `CI ${ci.value.toLowerCase()}`;
  return { kind, label: stale ? `${label} · last known` : label, stale };
}
