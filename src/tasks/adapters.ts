import type { Outcome } from "../actions/types";
import type { WorkflowRun } from "../github/types";
import { managedAgent } from "../manage/manifest";
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
// n8n: Atlas reads n8n with a read-only API key that only the site holds (server/n8n.ts), so the
// Task Center can show a workflow's recent runs but can't start one. That's said plainly.

export type Availability =
  | { mode: "execute"; executor: "github"; note: string }
  | { mode: "read-only"; reason: string; need: string }
  | { mode: "manual" };

export interface ExecContext {
  /** Running inside the Mac app. */
  desktop: boolean;
  /** The Mac app holds a Manage agents token (the token itself never reaches the page). */
  agentsToken: boolean;
}

export const N8N_READ_ONLY = {
  reason: "Atlas reads n8n with a read-only key, so it can show this workflow's runs but can't start it.",
  need: "To start n8n work from Atlas: an allow-listed webhook per workflow, a signing secret kept only on the site, and an input schema for each workflow.",
};

export function availability(task: Pick<StoredTask, "workflow" | "agentId">, ctx: ExecContext): Availability {
  const w = task.workflow;
  if (!w || w.kind === "manual") return { mode: "manual" };
  if (w.kind === "n8n") return { mode: "read-only", ...N8N_READ_ONLY };
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

/** n8n runs that started after the task did. Shown as context only, never claimed as the task's own run. */
export function n8nRunsSince(runs: readonly N8nRun[], since: string | undefined): N8nRun[] {
  if (!since) return [];
  const t = Date.parse(since);
  return runs.filter((r) => r.startedAt && Date.parse(r.startedAt) >= t);
}
