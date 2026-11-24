// GET reports/agents: per-agent counts for the Data Intelligence Center's daily agent self-reports
// (n8n "Data Intelligence · Agent Self-Reports", docs/agent-self-reports.md). Counts only: no run
// summaries, errors, inputs or memory content ever leave here, so the key that reads it needs no
// areas or tables. Each row is keyed by the catalog agent it belongs to: an agent key's runs count
// for the catalog entry its policy names (task-writer -> atlas-task-writer); a run recorded under a
// catalog id counts for that id.

import type { Db } from "./db";
import { AGENT_POLICIES } from "./policy";

export interface AgentReportRow {
  catalogId: string;
  runs: number;
  succeeded: number;
  failed: number;
  running: number;
  lastRunAt: string | null;
  lastFailureAt: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  memoryItems: number;
  feedback: number;
  feedbackPassed: number;
}

/** How many days of runs the counts cover. */
export const REPORT_WINDOW_DAYS = 30;

const catalogOf = (agentId: string) => AGENT_POLICIES[agentId]?.catalogId ?? agentId;
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export async function agentReports(db: Db, memoryReady: boolean): Promise<{ windowDays: number; agents: AgentReportRow[] }> {
  const runs = await db.query<Record<string, unknown>>(
    `SELECT agent_id, count(*)::int AS runs,
            count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            count(*) FILTER (WHERE status IN ('queued', 'running'))::int AS running,
            max(started_at) AS last_run, max(started_at) FILTER (WHERE status = 'failed') AS last_failure,
            coalesce(sum(input_tokens), 0)::bigint AS input_tokens, coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
            coalesce(sum(cost_usd), 0)::float8 AS cost
       FROM atlas.agent_runs WHERE started_at > now() - make_interval(days => $1) GROUP BY agent_id`,
    [REPORT_WINDOW_DAYS],
  );
  const memory = memoryReady
    ? await db.query<Record<string, unknown>>("SELECT agent_id, count(*)::int AS n FROM atlas.memory_items WHERE agent_id IS NOT NULL AND retired_at IS NULL AND (expires_at IS NULL OR expires_at > now()) GROUP BY agent_id")
    : [];
  const feedback = memoryReady
    ? await db.query<Record<string, unknown>>("SELECT agent_id, count(*)::int AS n, count(*) FILTER (WHERE verdict = 'passed')::int AS passed FROM atlas.run_feedback WHERE created_at > now() - make_interval(days => $1) GROUP BY agent_id", [REPORT_WINDOW_DAYS])
    : [];
  const rows = new Map<string, AgentReportRow>();
  const row = (agentId: string) => {
    const id = catalogOf(String(agentId));
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { catalogId: id, runs: 0, succeeded: 0, failed: 0, running: 0, lastRunAt: null, lastFailureAt: null, inputTokens: 0, outputTokens: 0, costUsd: 0, memoryItems: 0, feedback: 0, feedbackPassed: 0 }));
    return r;
  };
  const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  for (const x of runs) {
    const r = row(x.agent_id as string);
    r.runs += Number(x.runs); r.succeeded += Number(x.succeeded); r.failed += Number(x.failed); r.running += Number(x.running);
    r.lastRunAt = later(r.lastRunAt, iso(x.last_run)); r.lastFailureAt = later(r.lastFailureAt, iso(x.last_failure));
    r.inputTokens += Number(x.input_tokens); r.outputTokens += Number(x.output_tokens);
    r.costUsd = Math.round((r.costUsd + Number(x.cost)) * 10000) / 10000;
  }
  for (const x of memory) row(x.agent_id as string).memoryItems += Number(x.n);
  for (const x of feedback) { const r = row(x.agent_id as string); r.feedback += Number(x.n); r.feedbackPassed += Number(x.passed); }
  return { windowDays: REPORT_WINDOW_DAYS, agents: [...rows.values()].sort((a, b) => a.catalogId.localeCompare(b.catalogId)) };
}
