// GET /api/executive/engineering: what the Engineering Operations panel shows. Real records only:
// incidents, executions, QA reports and pull requests from the Atlas database. Nothing is invented
// when a table is empty; fixture runs carry their "fixture" source so the panel labels them.

import type { Db } from "../data/db";
import type { RosterAgent } from "../../src/executive/control/select";
import { engineerActivity } from "../../src/engineering/lifecycle";
import { ENGINEERING_REPOS } from "../../src/engineering/repos";
import { ENGINEER_AGENT_ID, QA_AGENT_ID, type EngineeringOverview, type EngineeringPhase, type ExecutionView, type IncidentView, type QaReport } from "../../src/engineering/types";

const json = <T,>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};
const ts = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function engineeringOverview(db: Db, configured: EngineeringOverview["configured"], roster: RosterAgent[]): Promise<EngineeringOverview> {
  const inc = await db.query<Record<string, unknown>>(
    "SELECT id, repo, workflow_name, workflow_path, run_id, run_url, head_sha, branch, category, supported, failed_jobs, status, decision, source, exec_goal_id, owner_task_id, created_at, updated_at FROM atlas.eng_incidents ORDER BY created_at DESC LIMIT 30",
  );
  const ex = await db.query<Record<string, unknown>>(
    `SELECT e.*, e.cost_usd::float8 AS cost_f, t.task_id AS task_record_id FROM atlas.eng_executions e JOIN atlas.exec_tasks t ON t.id = e.exec_task_id ORDER BY e.created_at DESC LIMIT 30`,
  );
  const states = await db.query<{ repo: string; last_seen_sha: string | null; last_checked_at: unknown }>("SELECT repo, last_seen_sha, last_checked_at FROM atlas.eng_repo_state");
  const [spend] = await db.query<{ usd: number; n: number; i: number; o: number }>(
    "SELECT COALESCE(SUM(cost_usd), 0)::float8 AS usd, COUNT(*)::int AS n, COALESCE(SUM(input_tokens), 0)::float8 AS i, COALESCE(SUM(output_tokens), 0)::float8 AS o FROM atlas.eng_executions WHERE created_at > now() - interval '30 days'",
  );
  const qaBusy = await db.query<{ id: string }>("SELECT id FROM atlas.exec_tasks WHERE agent_id = $1 AND state IN ('dispatching', 'running', 'verifying') LIMIT 1", [QA_AGENT_ID]);
  const incidents: IncidentView[] = inc.map((r) => ({
    id: String(r.id),
    repo: String(r.repo),
    workflowName: String(r.workflow_name),
    workflowPath: (r.workflow_path as string | null) ?? null,
    runId: Number(r.run_id),
    runUrl: (r.run_url as string | null) ?? null,
    headSha: String(r.head_sha),
    branch: String(r.branch),
    category: r.category as IncidentView["category"],
    supported: !!r.supported,
    failedJobs: json(r.failed_jobs, []),
    status: r.status as IncidentView["status"],
    decision: (r.decision as string | null) ?? null,
    source: r.source as IncidentView["source"],
    goalId: (r.exec_goal_id as string | null) ?? null,
    ownerTaskId: (r.owner_task_id as string | null) ?? null,
    createdAt: ts(r.created_at)!,
    updatedAt: ts(r.updated_at)!,
  }));
  const executions: ExecutionView[] = ex.map((r) => ({
    id: String(r.id),
    goalId: String(r.exec_goal_id),
    taskId: String(r.exec_task_id),
    taskRecordId: (r.task_record_id as string | null) ?? null,
    incidentId: (r.incident_id as string | null) ?? null,
    repo: String(r.repo),
    attempt: Number(r.attempt),
    repairIteration: Number(r.repair_iteration),
    phase: r.phase as EngineeringPhase,
    runner: String(r.runner),
    runnerRunId: (r.runner_run_id as string | null) ?? null,
    runnerUrl: (r.runner_url as string | null) ?? null,
    baseSha: String(r.base_sha),
    headSha: (r.head_sha as string | null) ?? null,
    branch: (r.branch as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    inputTokens: r.input_tokens === null ? null : Number(r.input_tokens),
    outputTokens: r.output_tokens === null ? null : Number(r.output_tokens),
    costUsd: Number(r.cost_f ?? 0),
    turns: r.turns === null ? null : Number(r.turns),
    filesChanged: json<{ path: string }[]>(r.files_changed, []).map((f) => f.path),
    claimedValidation: json(r.claimed_validation, []),
    qaOutcome: (r.qa_outcome as ExecutionView["qaOutcome"]) ?? null,
    qaReport: json<QaReport | null>(r.qa_report, null),
    prUrl: (r.pr_url as string | null) ?? null,
    prNumber: r.pr_number === null ? null : Number(r.pr_number),
    failureCategory: (r.failure_category as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: ts(r.created_at)!,
    updatedAt: ts(r.updated_at)!,
  }));
  const live = executions.find((e) => !["PR_READY", "FAILED", "CANCELLED"].includes(e.phase));
  const agent = (id: string, fallback: string) => roster.find((a) => a.id === id) ?? { id, name: fallback, status: "unknown", projectId: "ai-ops-atlas" };
  const eng = agent(ENGINEER_AGENT_ID, "Atlas Engineering");
  const qa = agent(QA_AGENT_ID, "Atlas Quality Assurance");
  return {
    configured,
    agents: [
      { id: eng.id, name: eng.name, status: eng.status, activity: live && live.phase !== "QA_REVIEW_REQUESTED" ? engineerActivity(live.phase) : "IDLE", currentTaskId: live && live.phase !== "QA_REVIEW_REQUESTED" ? live.taskId : null },
      { id: qa.id, name: qa.name, status: qa.status, activity: qaBusy.length || live?.phase === "QA_REVIEW_REQUESTED" ? "REVIEWING" : "IDLE", currentTaskId: qaBusy[0]?.id ?? null },
    ],
    repos: ENGINEERING_REPOS.map((r) => {
      const s = states.find((x) => x.repo === r.repo);
      return { repo: r.repo, defaultBranch: r.defaultBranch, autoRepair: r.autoRepair, lastSeenSha: s?.last_seen_sha ?? null, lastCheckedAt: ts(s?.last_checked_at) };
    }),
    incidents,
    executions,
    spend: { last30Usd: spend.usd, runs30: spend.n, inputTokens30: spend.i, outputTokens30: spend.o },
  };
}
