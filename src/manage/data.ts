import { toRun } from "../github/fetchRepo";
import { githubGet, GithubError } from "../github/transport";
import type { WorkflowRun } from "../github/types";
import { describeCron, nextRun, parseCron } from "./cron";
import type { ManagedAgent, Manifest } from "./manifest";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const RECENT_RUNS = 10;

/** GitHub's own state for a workflow: `active`, `disabled_manually` or `disabled_inactivity`. */
export interface WorkflowState {
  state: string;
  url: string;
}

export interface ManageData {
  /** Workflow state by file name. Missing when the list couldn't be read. */
  workflows: Record<string, WorkflowState> | null;
  /** Recent runs on main by workflow file, newest first. */
  runs: Record<string, WorkflowRun[]>;
  /** Why some or all of it couldn't be read, in words. */
  problems: string[];
  fetchedAt: string;
}

const fileOf = (path: unknown) => String(path ?? "").split("/").pop() ?? "";

const why = (e: unknown) =>
  e instanceof GithubError && (e.status === 401 || e.status === 403)
    ? `GitHub refused the request (${e.status}): ${e.message}`
    : e instanceof Error
      ? e.message
      : String(e);

/**
 * Reads what the Manage view shows: one request for every workflow's state, then one per
 * managed agent for its last runs on main. All go through the read-only GitHub client, which
 * sends If-None-Match, so an unchanged answer costs a 304 and nothing is downloaded again.
 * Called on open and on Refresh only; nothing polls.
 */
export async function fetchManageData(m: Manifest, now = Date.now()): Promise<ManageData> {
  const base = `/repos/${m.repository}/actions`;
  const problems: string[] = [];
  const [workflows, ...runs] = await Promise.all([
    (githubGet(`${base}/workflows?per_page=100`) as Promise<J>).then(
      (body) => {
        const out: Record<string, WorkflowState> = {};
        for (const w of (body?.workflows ?? []) as J[]) out[fileOf(w.path)] = { state: String(w.state ?? ""), url: String(w.html_url ?? "") };
        return out;
      },
      (e) => {
        problems.push(`Couldn't read which workflows are enabled. ${why(e)}`);
        return null;
      },
    ),
    ...m.agents.map((a) =>
      (githubGet(`${base}/workflows/${a.workflow}/runs?branch=main&per_page=${RECENT_RUNS}`) as Promise<J>).then(
        (body) => ((body?.workflow_runs ?? []) as J[]).map(toRun),
        (e) => {
          problems.push(`Couldn't read runs of ${a.workflow}. ${why(e)}`);
          return null;
        },
      ),
    ),
  ]);
  const byFile: Record<string, WorkflowRun[]> = {};
  m.agents.forEach((a, i) => {
    const r = runs[i];
    if (r) byFile[a.workflow] = r;
  });
  return { workflows, runs: byFile, problems: [...new Set(problems)], fetchedAt: new Date(now).toISOString() };
}

export type ManageStatus = "disabled" | "running" | "failing" | "ok" | "never" | "unknown";

export const MANAGE_STATUS_LABEL: Record<ManageStatus, string> = {
  disabled: "Disabled",
  running: "Running",
  failing: "Last run failed",
  ok: "Enabled",
  never: "No runs yet",
  unknown: "Unknown",
};

export interface ManageRow {
  agent: ManagedAgent;
  status: ManageStatus;
  /** GitHub's raw workflow state, when it was read. */
  workflowState: string | null;
  schedule: string;
  nextRunAt: string | null;
  lastRun: WorkflowRun | null;
  runs: WorkflowRun[] | null;
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

/** One row per managed agent. Anything not read is shown as unknown, never guessed. */
export function manageRows(m: Manifest, data: ManageData | null, now = Date.now()): ManageRow[] {
  return m.agents.map((agent) => {
    const wf = data?.workflows?.[agent.workflow] ?? null;
    const runs = data?.runs[agent.workflow] ?? null;
    const lastRun = runs?.[0] ?? null;
    let status: ManageStatus = "unknown";
    if (wf?.state.startsWith("disabled")) status = "disabled";
    else if (runs && lastRun && lastRun.status !== "completed") status = "running";
    else if (runs && lastRun && FAILED.has(lastRun.conclusion ?? "")) status = "failing";
    else if (wf?.state === "active" && runs) status = lastRun ? "ok" : "never";
    let nextRunAt: string | null = null;
    if (status !== "disabled") {
      try {
        const t = nextRun(parseCron(agent.schedule), now);
        nextRunAt = t === null ? null : new Date(t).toISOString();
      } catch {
        // The manifest test keeps every schedule valid; an invalid one just shows no next run.
      }
    }
    return { agent, status, workflowState: wf?.state ?? null, schedule: describeCron(agent.schedule), nextRunAt, lastRun, runs };
  });
}
