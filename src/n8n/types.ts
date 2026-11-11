// Live n8n runs, as the site's server function summarizes them (server/n8n.ts). Read only: the
// site lists the instance's workflows and recent executions with KC's read-only n8n API key, which
// lives only in the site's secrets. Nothing here can start, edit or stop a workflow.

/** n8n's execution statuses. Anything else n8n adds later is kept as "unknown". */
export type N8nRunStatus = "success" | "error" | "crashed" | "canceled" | "running" | "waiting" | "new" | "unknown";

export interface N8nRun {
  id: string;
  status: N8nRunStatus;
  /** How the run started: trigger, webhook, manual, retry and so on, as n8n reports it. */
  mode: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface N8nWorkflowRuns {
  id: string;
  name: string;
  /** Whether n8n has the workflow switched on (published). */
  active: boolean;
  /** Newest first, at most RUNS_PER_WORKFLOW. Empty when none of the recent executions are this workflow's. */
  runs: N8nRun[];
  /** Failed runs (error or crashed) among the recent executions in the last 24 hours. */
  failures24h: number;
}

export type N8nSnapshot =
  | { state: "ok"; instance: string; fetchedAt: string; /** How many recent executions the summary covers. */ window: number; workflows: N8nWorkflowRuns[] }
  | { state: "not-configured"; need: string };

export const RUNS_PER_WORKFLOW = 5;

export const FAILED: ReadonlySet<N8nRunStatus> = new Set(["error", "crashed"]);
