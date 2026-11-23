// ATLAS_QA_VALIDATION: Atlas QA's run, inside the site. It goes through the Executive's normal claim
// and result path (a "local" route), so it has an attempt, an idempotency key and an audit trail like
// any other task. The only thing it takes from Engineering's report is which run and branch to look
// at; the evidence comes from GitHub, read with the site's own read-only token.

import type { Db } from "../data/db";
import type { DispatchEnvelope, ResultBody } from "../../src/executive/control/contracts";
import { parseChange } from "../../src/engineering/contracts";
import { evaluateQa, type QaEvidence } from "../../src/engineering/qa";
import { engineeringRepo } from "../../src/engineering/repos";
import type { GithubReader } from "./github";
import type { RunFacts } from "../../src/engineering/classify";

const facts = (r: RunFacts) => ({ id: r.runId, path: r.workflowPath, event: r.event, status: r.status, conclusion: r.conclusion, headSha: r.headSha, htmlUrl: r.url, branch: r.branch });

export function qaRunner(db: Db, github: GithubReader, now: () => number = Date.now) {
  return async (e: DispatchEnvelope): Promise<ResultBody> => {
    const base = { contract: "ATLAS_WORKFLOW_RESULT" as const, version: 1 as const, eventId: `${e.idempotencyKey}:qa`, taskId: e.taskId, attempt: e.attempt, correlationId: e.correlationId, idempotencyKey: e.idempotencyKey, nonce: e.nonce, executionId: "atlas-qa", at: new Date(now()).toISOString() };
    const [row] = await db.query<{ body: unknown }>(
      `SELECT a.body FROM atlas.exec_artifacts a JOIN atlas.exec_tasks t ON t.id = a.exec_task_id
        WHERE a.exec_goal_id = $1 AND a.schema = 'engineering-change/1' AND a.verified ORDER BY a.created_at DESC LIMIT 1`,
      [e.goalId],
    );
    const parsed = parseChange(typeof row?.body === "string" ? JSON.parse(row.body) : row?.body);
    if (!parsed.ok) return { ...base, contract: "ATLAS_EXECUTIVE_ERROR", kind: "failed", error: "There is no verified engineering change for QA to check." };
    const change = parsed.value;
    const repo = engineeringRepo(change.repo);
    if (!repo || !change.branch) return { ...base, contract: "ATLAS_EXECUTIVE_ERROR", kind: "failed", error: "The change has no allowlisted repository or branch." };
    let evidence: QaEvidence;
    try {
      const [run, validations, compare] = await Promise.all([github.run(repo.repo, change.runId), github.dispatchedRuns(repo.repo, repo.validateWorkflow, change.branch), github.compare(repo.repo, change.baseSha, change.branch)]);
      // The newest validate run for exactly the reported commit; its jobs hold the check results.
      const v = validations.find((x) => x.headSha === change.headSha) ?? null;
      const jobs = v ? await github.jobs(repo.repo, v.runId) : [];
      evidence = { run: run ? facts(run) : null, validation: v ? facts(v) : null, jobs, compare };
    } catch (err) {
      evidence = { run: null, validation: null, jobs: [], compare: null, error: err instanceof Error ? err.message : String(err) };
    }
    const report = evaluateQa(repo, change, evidence, base.at);
    return { ...base, kind: "succeeded", artifact: report };
  };
}
