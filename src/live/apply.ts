import { toRun } from "../github/fetchRepo";
import type { Commit, RepoSnapshot, WorkflowRun } from "../github/types";
import type { Run } from "../intel/types";

/** One entry of the site's live feed (server/live.ts). */
export interface LiveEvent {
  id: number;
  at: string;
  source: "github" | "atlas" | "agent";
  kind: string;
  repo: string | null;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const STAGE: Record<string, number> = { completed: 3, in_progress: 2 };
const stage = (r: WorkflowRun) => STAGE[r.status] ?? 1;

/**
 * Whether `next` is a newer view of the same run than `prev`. Deliveries can arrive out of
 * order and a snapshot can be fresher than an event, so a run never moves backwards.
 */
function newer(prev: WorkflowRun, next: WorkflowRun): boolean {
  const a = prev.attempt ?? 1;
  const b = next.attempt ?? 1;
  return b !== a ? b > a : stage(next) >= stage(prev);
}

const sameRun = (a: WorkflowRun, b: WorkflowRun) => (a.id != null && a.id === b.id) || a.url === b.url;

/** Puts a run into a newest-first list, replacing an older view of it. Returns null if nothing changed. */
export function upsertRun(list: WorkflowRun[], run: WorkflowRun, limit: number): WorkflowRun[] | null {
  const i = list.findIndex((r) => sameRun(r, run));
  if (i >= 0) {
    if (!newer(list[i], run)) return null;
    const next = list.slice();
    next[i] = run;
    return next;
  }
  // Older than everything kept: the list wouldn't show it anyway.
  if (list.length >= limit && run.createdAt < list[list.length - 1].createdAt) return null;
  return [run, ...list].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, limit);
}

/**
 * A pull request run must not push the workflow's newest default-branch run out of the list:
 * that run decides the agent's status, as in fetchRepo's withMainline.
 */
function keepMainline(list: WorkflowRun[], prev: WorkflowRun[], branch: string | undefined): WorkflowRun[] {
  if (!branch || list.some((r) => r.branch === branch)) return list;
  const main = prev.find((r) => r.branch === branch);
  return main ? [...list, main] : list;
}

const fileOf = (path: unknown) => String(path ?? "").split("/").pop() ?? "";

/**
 * A repository snapshot with one live GitHub event applied, or the same object when the event
 * changes nothing Atlas shows. Uses only what the event carries: no GitHub requests.
 */
export function applyGithubEvent(snap: RepoSnapshot, e: LiveEvent): RepoSnapshot {
  if (e.kind === "workflow_run" && e.body?.run) {
    const raw = e.body.run;
    const run = toRun(raw);
    if (!run.url || !run.createdAt) return snap;
    let next = snap;
    if (run.branch === snap.defaultBranch) {
      const runs = upsertRun(snap.runs, run, 10);
      if (runs) next = { ...next, runs };
    }
    const file = fileOf(raw.path);
    if (file && file in snap.workflowRuns) {
      const prev = snap.workflowRuns[file];
      const list = upsertRun(prev, run, 5);
      if (list) next = { ...next, workflowRuns: { ...next.workflowRuns, [file]: keepMainline(list, prev, snap.defaultBranch) } };
    }
    return next;
  }
  if (e.kind === "push" && e.body && !e.body.deleted && e.body.branch === snap.defaultBranch && Array.isArray(e.body.commits) && e.body.commits.length) {
    const seen = new Set(snap.commits.map((c) => c.sha));
    const fresh = (e.body.commits as Commit[]).filter((c) => c.sha && !seen.has(c.sha)).reverse();
    if (!fresh.length) return snap;
    return { ...snap, commits: [...fresh, ...snap.commits].slice(0, 10) };
  }
  return snap;
}

/** What a live event says is happening, in a few words, for the header's live indicator. */
export function describe(e: LiveEvent): string | null {
  const repo = (e.repo ?? "").split("/").pop() ?? "";
  if (e.kind === "workflow_run") {
    const r = e.body?.run ?? {};
    const what = r.status === "completed" ? ({ success: "passed", failure: "failed" } as Record<string, string>)[r.conclusion] ?? r.conclusion ?? "finished" : r.status === "in_progress" ? "running" : "queued";
    return `${r.name ?? "Workflow"} ${what} · ${repo}`;
  }
  if (e.kind === "workflow_job") {
    const j = e.body?.job ?? {};
    if (j.status !== "in_progress") return null;
    return `${j.name ?? "Job"} running · ${repo}`;
  }
  if (e.kind === "push") {
    const n = e.body?.commits?.length ?? 0;
    return n ? `${n} commit${n === 1 ? "" : "s"} pushed · ${repo}` : null;
  }
  if (e.kind === "agent_run") {
    const r = e.body as Partial<AgentRun>;
    return `${r.phase ?? "Pipeline phase"} ${RUN_WORD[r.status ?? ""] ?? "reported"} · ${r.project ?? "pipeline"}`;
  }
  if (e.kind === "inquiry") return typeof e.body?.detail === "string" ? e.body.detail.slice(0, 120) : "New website inquiry";
  if (e.kind === "agent_report") return `New report · ${typeof e.body?.agent === "string" ? e.body.agent : "agent"}`;
  if (e.kind === "intel_run") {
    const r = e.body as Partial<Run>;
    return `Repository Intelligence ${r.status ?? "updated"} · ${(r.repo ?? repo).split("/").pop()}`;
  }
  return null;
}

/** One phase result a pipeline outside Atlas reported (server/live.ts agentRun). */
export interface AgentRun {
  /** The feed's event id, so a run seen twice is kept once. */
  id: number;
  project: string;
  agents: string[];
  phase: string;
  status: "ok" | "failed" | "skipped" | "paused";
  detail: string;
  at: string;
}

const RUN_WORD: Record<string, string> = { ok: "finished", failed: "failed", skipped: "skipped", paused: "paused" };

/** The run an agent_run event carries, or null when it isn't one. */
export function toAgentRun(e: LiveEvent): AgentRun | null {
  const b = e.body;
  if (e.kind !== "agent_run" || !b || typeof b.phase !== "string" || !Array.isArray(b.agents) || !RUN_WORD[b.status]) return null;
  return { id: e.id, project: String(b.project ?? ""), agents: b.agents.filter((a: unknown) => typeof a === "string"), phase: b.phase, status: b.status, detail: typeof b.detail === "string" ? b.detail : "", at: typeof b.at === "string" ? b.at : e.at };
}

/** Adds new pipeline runs to a newest-first list, dropping ones already there. */
export function mergeAgentRuns(list: AgentRun[], runs: AgentRun[], limit = 200): AgentRun[] {
  if (!runs.length) return list;
  const seen = new Set(list.map((r) => r.id));
  const fresh = runs.filter((r) => !seen.has(r.id));
  if (!fresh.length) return list;
  return [...fresh, ...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Folds a Mac-reported agent run into the web's list of them, newest first. */
export function upsertIntelRun(list: Run[], run: Run, limit = 50): Run[] {
  const rest = list.filter((r) => r.id !== run.id);
  return [run, ...rest].sort((a, b) => (b.queued_at ?? "").localeCompare(a.queued_at ?? "")).slice(0, limit);
}
