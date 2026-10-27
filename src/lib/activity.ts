import type { Catalog } from "../catalog/types";
import type { RepoState, WorkflowRun } from "../github/types";
import { repoData } from "./derive";
import type { Run as IntelRun } from "../intel/types";
import { RUN_LABEL, usd } from "../intel/format";

export type EventKind = "commit" | "ci" | "agent" | "intel" | "manifest";
export type EventResult = "success" | "failure" | "running" | "other";

export interface AtlasEvent {
  id: string;
  at: string;
  kind: EventKind;
  result?: EventResult;
  title: string;
  detail: string;
  repo?: string;
  projectId?: string;
  agentId?: string;
  url?: string;
}

export function runResult(r: WorkflowRun): EventResult {
  if (r.status !== "completed") return "running";
  if (r.conclusion === "success") return "success";
  if (r.conclusion === "failure" || r.conclusion === "timed_out") return "failure";
  return "other";
}

/**
 * Every event Atlas has actually seen: commits and workflow runs from the GitHub snapshots,
 * runs of workflows that agents declare as their live source, and history written in manifests.
 */
export function intelResult(r: IntelRun): EventResult {
  if (r.status === "queued" || r.status === "running") return "running";
  if (r.status === "succeeded" || r.status === "reused") return "success";
  if (r.status === "failed" || r.status === "interrupted" || r.status === "blocked") return "failure";
  return "other";
}

export function workspaceEvents(catalog: Catalog, repos: Record<string, RepoState>, uncataloged: string[] = [], intelRuns: IntelRun[] = []): AtlasEvent[] {
  const out: AtlasEvent[] = [];
  const seen = new Set<string>();
  const projectByRepo = new Map(catalog.projects.map((p) => [p.repository, p]));
  const names = [...new Set(catalog.projects.map((p) => p.repository).concat(catalog.agents.map((a) => a.repository), uncataloged))];
  const label = (repo: string) => projectByRepo.get(repo)?.name ?? repo;

  // Agent-attributed runs first, so a run that is also in the repository list keeps the agent.
  for (const a of catalog.agents) {
    const wf = a.observe?.githubWorkflow;
    const snap = repoData(repos[a.repository]);
    for (const r of (wf && snap?.workflowRuns[wf]) || []) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({
        id: `run:${r.url}`,
        at: r.createdAt,
        kind: "agent",
        result: runResult(r),
        title: `${a.name}: ${r.name}`,
        detail: `${label(a.repository)} · ${r.event} on ${r.branch}`,
        repo: a.repository,
        projectId: a.projectId,
        agentId: a.id,
        url: r.url,
      });
    }
  }
  for (const name of names) {
    const snap = repoData(repos[name]);
    if (!snap) continue;
    const projectId = projectByRepo.get(name)?.id;
    for (const r of snap.runs) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ id: `run:${r.url}`, at: r.createdAt, kind: "ci", result: runResult(r), title: r.name, detail: `${label(name)} · ${r.event} on ${r.branch}`, repo: name, projectId, url: r.url });
    }
    for (const c of snap.commits) {
      out.push({ id: `commit:${name}:${c.sha}`, at: c.date, kind: "commit", title: c.message.split("\n")[0], detail: `${label(name)} · ${c.author} · ${c.sha.slice(0, 7)}`, repo: name, projectId, url: c.url });
    }
  }
  for (const a of catalog.agents) {
    for (const h of a.history) {
      out.push({ id: `hist:${a.id}:${h.at}:${h.event}`, at: h.at, kind: "manifest", title: h.event, detail: `${a.name} · recorded in the manifest`, repo: a.repository, projectId: a.projectId, agentId: a.id });
    }
  }
  // Runs of the repository intelligence agent, recorded by the desktop app.
  for (const r of intelRuns) {
    const project = projectByRepo.get(r.repo);
    const cost = r.cost_usd != null ? ` · ${usd(r.cost_usd)}` : "";
    out.push({
      id: `intel:${r.id}`,
      at: r.started_at ?? r.queued_at,
      kind: "intel",
      result: intelResult(r),
      title: `Repository intelligence: ${RUN_LABEL[r.status]}`,
      detail: `${label(r.repo)} · ${r.trigger} · ${r.model}${cost}`,
      repo: r.repo,
      projectId: project?.id,
    });
  }
  return out.sort((x, y) => y.at.localeCompare(x.at));
}

export interface EventFilter {
  kinds: EventKind[];
  project: string;
  result: "" | EventResult;
  sinceMs: number | null;
  query: string;
}

export function filterEvents(events: AtlasEvent[], f: EventFilter, now = Date.now()): AtlasEvent[] {
  const q = f.query.trim().toLowerCase();
  return events.filter(
    (e) =>
      (f.kinds.length === 0 || f.kinds.includes(e.kind)) &&
      (!f.project || e.projectId === f.project) &&
      (!f.result || e.result === f.result) &&
      (f.sinceMs === null || now - Date.parse(e.at) <= f.sinceMs) &&
      (!q || `${e.title} ${e.detail}`.toLowerCase().includes(q)),
  );
}
