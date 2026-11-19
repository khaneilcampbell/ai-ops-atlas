import type { Outcome } from "../actions/types";
import type { WorkflowRun } from "../github/types";
import { managedAgent } from "../manage/manifest";
import { startableByWorkflowId, type StartAnswer, type StartableWorkflow } from "../n8n/startable";
import type { N8nRun } from "../n8n/types";
import type { AttemptUpdate } from "./lifecycle";
import type { ExecutionAttempt, StoredTask } from "./types";

// What each kind of workflow can do from the Task Center, decided from what is actually set up.
//
// GitHub: Atlas can start only the agents on the Manage agents allow-list (src/manage/agents.json),
// only in the Mac app, and only through its existing write path: the Rust side reads the workflow
// again, shows a macOS dialog, asks for Touch ID and writes the audit log. The page never holds a
// GitHub token. Everything else on GitHub is read-only here.
//
// n8n: Atlas reads n8n with a read-only API key that only the site holds (server/n8n.ts). It can
// start only the workflows on src/n8n/startable.ts, through each one's signed "Atlas Start" webhook:
// the site checks the input against that workflow's schema and signs the request with a secret only
// it and n8n hold (server/n8nStart.ts). On the Mac, Touch ID approves each start. Every other n8n
// workflow stays read-only, and that's said plainly.

export type Availability =
  | { mode: "execute"; executor: "github"; note: string }
  | { mode: "execute"; executor: "n8n"; note: string; startable: StartableWorkflow }
  | { mode: "read-only"; reason: string; need: string }
  | { mode: "manual" };

export interface ExecContext {
  /** Running inside the Mac app. */
  desktop: boolean;
  /** The Mac app holds a Manage agents token (the token itself never reaches the page). */
  agentsToken: boolean;
}

export const N8N_READ_ONLY = {
  reason: "Atlas has this n8n workflow read-only: it isn't on Atlas's start list, so Atlas only shows its runs.",
  need: "Adding it takes an Atlas Start webhook in n8n and an entry with its input schema in src/n8n/startable.ts (docs/n8n-start.md).",
};

export function availability(task: Pick<StoredTask, "workflow" | "agentId">, ctx: ExecContext): Availability {
  const w = task.workflow;
  if (!w || w.kind === "manual") return { mode: "manual" };
  if (w.kind === "n8n") {
    const startable = startableByWorkflowId(w.id);
    if (!startable) return { mode: "read-only", ...N8N_READ_ONLY };
    return { mode: "execute", executor: "n8n", startable, note: ctx.desktop ? "Starts in n8n after you fill in its form and confirm with Touch ID. The site signs the request; n8n checks it." : "Starts in n8n after you fill in its form and confirm. The site signs the request; n8n checks it." };
  }
  const managed = task.agentId ? managedAgent(task.agentId) : undefined;
  if (!managed || managed.workflow !== w.id)
    return { mode: "read-only", reason: `${w.id} isn't on Atlas's Manage agents allow-list, so Atlas only shows its runs.`, need: "Adding a workflow to src/manage/agents.json (a high-risk change Khaneil approves) lets the Mac app start it." };
  if (!ctx.desktop) return { mode: "read-only", reason: "GitHub workflows start from the Mac app, where Touch ID approves each run. This page is read-only.", need: "Open Atlas on the Mac." };
  if (!ctx.agentsToken) return { mode: "read-only", reason: "The Mac app has no Manage agents token yet.", need: "Save one in Settings → Actions → Manage agents." };
  return { mode: "execute", executor: "github", note: "Starts on main after the macOS dialog and Touch ID. The Mac app logs it." };
}

/** What the Mac app's answer to a "run now" means for the attempt. */
export function outcomeToUpdate(o: Outcome): AttemptUpdate {
  if (o.stage === "started") return { state: "running", auditId: o.audit_id };
  if (o.stage === "unknown") return { state: "unknown", error: `GitHub's answer was unclear: ${o.message}. Check the run list before retrying.` };
  if (o.stage === "refused" || o.stage === "cancelled") return { state: "failed", error: `Not sent: ${o.message}` };
  return { state: "failed", error: o.message || "The Mac app reported a failure." };
}

const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

/**
 * Finds the GitHub run an attempt started: the oldest manual (workflow_dispatch) run created
 * after the request, not already claimed by another attempt. Returns null until GitHub shows one.
 */
export function matchGithubRun(a: ExecutionAttempt, runs: readonly WorkflowRun[], claimed: ReadonlySet<string>): WorkflowRun | null {
  const since = Date.parse(a.requestedAt) - 60_000;
  const candidates = runs.filter((r) => r.event === "workflow_dispatch" && Date.parse(r.createdAt) >= since && r.id !== undefined && !claimed.has(String(r.id)));
  return candidates.sort((x, y) => x.createdAt.localeCompare(y.createdAt))[0] ?? null;
}

/** GitHub's report on a matched run, as an attempt update; null when nothing changed. */
export function githubRunUpdate(a: ExecutionAttempt, run: WorkflowRun): AttemptUpdate | null {
  const ref = { externalId: String(run.id), externalUrl: run.url };
  if (run.status !== "completed") return a.externalId === ref.externalId && a.state === "running" ? null : { state: "running", ...ref };
  if (run.conclusion === "success") return { state: "succeeded", ...ref, result: { conclusion: "success", run: run.url } };
  if (run.conclusion === "cancelled") return { state: "cancelled", ...ref };
  return { state: "failed", ...ref, error: `GitHub run ${FAILED.has(run.conclusion ?? "") ? "failed" : "ended"}: ${(run.conclusion ?? "unknown").replace(/_/g, " ")}.` };
}

/** What the site's answer to a start means for the attempt. */
export function startAnswerToUpdate(a: StartAnswer): AttemptUpdate {
  const ref = a.executionId ? { externalId: a.executionId, ...(a.executionUrl ? { externalUrl: a.executionUrl } : {}) } : {};
  if (a.state === "accepted") return { state: "running", ...ref };
  if (a.state === "refused") return { state: "failed", error: `Not started: ${a.error ?? "the site refused it."}` };
  return { state: "unknown", error: `${a.error ?? "No clear answer."} Check the workflow's executions in n8n before retrying.` };
}

/** n8n's report on the execution an attempt started; null while it's still going or not listed yet. */
export function n8nRunUpdate(a: ExecutionAttempt, runs: readonly N8nRun[]): AttemptUpdate | null {
  if (!a.externalId) return null;
  const run = runs.find((r) => r.id === a.externalId);
  if (!run) return null;
  const ref = { externalId: run.id, ...(a.externalUrl ? { externalUrl: a.externalUrl } : {}) };
  if (run.status === "success") return { state: "succeeded", ...ref, result: { conclusion: "success", execution: run.id } };
  if (run.status === "error" || run.status === "crashed") return { state: "failed", ...ref, error: `The n8n run ${run.status === "crashed" ? "crashed" : "failed"}. Its steps are in n8n's executions list.` };
  if (run.status === "canceled") return { state: "cancelled", ...ref };
  return null;
}

/** n8n runs that started after the task did. Shown as context only, never claimed as the task's own run. */
export function n8nRunsSince(runs: readonly N8nRun[], since: string | undefined): N8nRun[] {
  if (!since) return [];
  const t = Date.parse(since);
  return runs.filter((r) => r.startedAt && Date.parse(r.startedAt) >= t);
}
