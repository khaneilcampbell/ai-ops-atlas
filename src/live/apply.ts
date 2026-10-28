import { toRun } from "../github/fetchRepo";
import type { Commit, RepoSnapshot, WorkflowRun } from "../github/types";
import type { Run } from "../intel/types";

/** One entry of the site's live feed (server/live.ts). */
export interface LiveEvent {
  id: number;
  at: string;
  source: "github" | "atlas";
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
      const list = upsertRun(snap.workflowRuns[file], run, 5);
      if (list) next = { ...next, workflowRuns: { ...next.workflowRuns, [file]: list } };
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
  if (e.kind === "intel_run") {
    const r = e.body as Partial<Run>;
    return `Repository Intelligence ${r.status ?? "updated"} · ${(r.repo ?? repo).split("/").pop()}`;
  }
  return null;
}

/** Folds a Mac-reported agent run into the web's list of them, newest first. */
export function upsertIntelRun(list: Run[], run: Run, limit = 50): Run[] {
  const rest = list.filter((r) => r.id !== run.id);
  return [run, ...rest].sort((a, b) => (b.queued_at ?? "").localeCompare(a.queued_at ?? "")).slice(0, limit);
}
