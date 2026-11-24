// ATLAS_GITHUB_MONITOR: from a failed GitHub Actions run to an Atlas Executive goal.
//
// Two ways in, one path: the GitHub App webhook the site already verifies (server/live.ts,
// GITHUB_WEBHOOK_SECRET), and a reconciliation sweep on the Executive's existing schedule tick that
// catches a missed delivery. Both call ingestRun(), which re-reads the run from GitHub itself (the
// webhook body only says where to look), deduplicates on repository + workflow + commit, classifies
// the failure with plain rules and lets the Executive's intake rule decide: ignore, escalate to
// Khaneil, or open an engineering goal (implement -> QA -> deliver -> report).

import type { Db } from "../data/db";
import { advance, type Deps } from "../executive/engine";
import { ENGINEERING_TEMPLATE } from "../../src/executive/control/plan";
import { classify, decideIntake, incidentKey, runFacts, type Classification, type RunFacts } from "../../src/engineering/classify";
import { modelTiers, routeModel } from "../../src/engineering/lifecycle";
import { engineeringRepo, ENGINEERING_REPOS } from "../../src/engineering/repos";
import { CATEGORY_LABEL, ENGINEERING_LIMITS, MONITOR_ACTOR, type FailureCategory } from "../../src/engineering/types";
import { escalate } from "./handlers";
import type { GithubReader } from "./github";

export interface IntakeDeps extends Deps {
  github: GithubReader;
  /** ATLAS_ENGINEERING_ENABLED. */
  enabled: boolean;
  /** ATLAS_ENGINEERING_MODELS. */
  models?: string;
}

export type IngestOutcome =
  | { kind: "duplicate"; incidentId: string }
  | { kind: "ignored"; reason: string }
  | { kind: "escalated"; incidentId: string; reason: string }
  | { kind: "goal"; incidentId: string; goalId: string; autonomy: 2 | 3; reason: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const nowOf = (d: Deps) => (d.now ? d.now() : Date.now());

/** A verified webhook delivery. Only completed workflow runs on allowlisted repositories go further. */
export async function ingestWebhook(d: IntakeDeps, event: string, payload: unknown): Promise<IngestOutcome> {
  if (event !== "workflow_run") return { kind: "ignored", reason: "Not a workflow run." };
  const p = (payload ?? {}) as { action?: unknown; repository?: { full_name?: unknown }; workflow_run?: unknown };
  if (p.action !== "completed") return { kind: "ignored", reason: "The run isn't finished." };
  const hint = runFacts(p.repository?.full_name, p.workflow_run);
  if (!hint || !engineeringRepo(hint.repo)) return { kind: "ignored", reason: "Not an allowlisted repository." };
  if (hint.conclusion !== "failure" && hint.conclusion !== "timed_out") return { kind: "ignored", reason: "The run didn't fail." };
  // Don't trust the delivery's details beyond where to look: read the run from GitHub.
  const facts: RunFacts | null = await d.github.run(hint.repo, hint.runId).catch(() => null);
  if (!facts) return { kind: "ignored", reason: "GitHub couldn't confirm the run; the next reconciliation tries again." };
  return ingestRun(d, facts, "webhook");
}

async function openOnRepo(db: Db, repo: string): Promise<number> {
  const [r] = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM atlas.eng_incidents WHERE repo = $1 AND status IN ('assigned', 'awaiting_approval', 'repairing')", [repo]);
  return r.n;
}

async function autoToday(db: Db): Promise<number> {
  const [r] = await db.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM atlas.eng_incidents i JOIN atlas.exec_goals g ON g.id = i.exec_goal_id WHERE g.autonomy = 3 AND i.created_at > now() - interval '24 hours' AND i.source <> 'fixture'",
  );
  return r.n;
}

/** Lessons Atlas already holds for this kind of failure (titles only, so nothing is rediscovered). */
async function knownLessons(db: Db, repo: string, category: string): Promise<string> {
  try {
    const rows = await db.query<{ title: string }>(
      "SELECT title FROM atlas.memory_items WHERE category = 'operational' AND error_class = $1 AND tags LIKE $2 AND retired_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY (verification = 'verified') DESC, updated_at DESC LIMIT 3",
      [category, `%${repo}%`],
    );
    return rows.map((r) => r.title).join(" | ").slice(0, 600);
  } catch {
    return "";
  }
}

export async function ingestRun(d: IntakeDeps, facts: RunFacts, source: "webhook" | "reconcile" | "fixture"): Promise<IngestOutcome> {
  const repo = engineeringRepo(facts.repo);
  if (!repo) return { kind: "ignored", reason: `${facts.repo} isn't on the engineering allowlist.` };
  const key = incidentKey(facts);
  const [dup] = await d.db.query<{ id: string }>("SELECT id FROM atlas.eng_incidents WHERE dedupe_key = $1", [key]);
  if (dup) return { kind: "duplicate", incidentId: dup.id };

  let cls: Classification | null = null;
  let laterRunPassed = false;
  try {
    cls = classify(repo, await d.github.jobs(repo.repo, facts.runId));
    const later = await d.github.recentRuns(repo.repo, facts.branch, "success");
    laterRunPassed = later.some((r) => r.workflowName === facts.workflowName && Date.parse(r.createdAt) > Date.parse(facts.createdAt));
  } catch {
    cls = null;
  }
  const stopped = await d.stop().catch(() => "The emergency stop state couldn't be read.");
  const decision = decideIntake(facts, cls, { enabled: d.enabled, openOnRepo: await openOnRepo(d.db, repo.repo), autoToday: await autoToday(d.db), laterRunPassed, stopped, now: nowOf(d) });
  if (decision.kind === "ignore") return { kind: "ignored", reason: decision.reason };
  const category: FailureCategory = cls?.category ?? "unknown";

  const made = await d.db.tx(async (db): Promise<IngestOutcome> => {
    const [inc] = await db.query<{ id: string }>(
      `INSERT INTO atlas.eng_incidents (repo, workflow_name, workflow_path, run_id, run_attempt, run_url, head_sha, branch, category, supported, failed_jobs, status, decision, source, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'detected', $12, $13, $14) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [repo.repo, facts.workflowName, facts.workflowPath, facts.runId, facts.runAttempt, facts.url, facts.headSha, facts.branch, category, !!cls?.supported, JSON.stringify(cls?.failedJobs ?? []), clip(decision.reason, 1000), source, key],
    );
    if (!inc) {
      const [again] = await db.query<{ id: string }>("SELECT id FROM atlas.eng_incidents WHERE dedupe_key = $1", [key]);
      return { kind: "duplicate", incidentId: again?.id ?? "" };
    }
    if (decision.kind === "escalate") {
      const owner = await escalate(db, { incidentId: inc.id, repo: repo.repo, category, headSha: facts.headSha, runUrl: facts.url, why: decision.reason });
      await db.query("UPDATE atlas.eng_incidents SET status = 'escalated', owner_task_id = $2 WHERE id = $1", [inc.id, owner]);
      return { kind: "escalated", incidentId: inc.id, reason: decision.reason };
    }
    const sha7 = facts.headSha.slice(0, 7);
    const objective = `Fix the failing ${CATEGORY_LABEL[category].toLowerCase()} check in ${repo.repo} at ${sha7}${source === "fixture" ? " (local fixture, not a real repair)" : ""}`;
    const model = routeModel(category, 0, modelTiers(d.models));
    const inputs: Record<string, string> = {
      repo: repo.repo,
      base_sha: facts.headSha,
      failed_run_id: String(facts.runId),
      failed_run_url: facts.url ?? "",
      workflow: facts.workflowName,
      category,
      incident_id: inc.id,
      incident_key: key,
      model: model.model,
      source,
      failed_steps: clip((cls?.failedJobs ?? []).map((j) => `${j.name}: ${j.steps.join(", ")}`).join(" | "), 600),
      known_lessons: await knownLessons(db, repo.repo, category),
    };
    const [goal] = await db.query<{ id: string }>(
      `INSERT INTO atlas.goals (title, description, area, priority, status, origin, created_by, updated_by)
       VALUES ($1, $2, 'projects', 'high', 'active', 'system', $3, $3) RETURNING id`,
      [objective.slice(0, 200), `${objective}. ${decision.reason}`.slice(0, 4000), MONITOR_ACTOR],
    );
    const [eg] = await db.query<{ id: string }>(
      `INSERT INTO atlas.exec_goals (goal_id, objective, autonomy, budget_usd, created_by, template, template_inputs, area)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'projects') RETURNING id`,
      [goal.id, objective, decision.autonomy, ENGINEERING_LIMITS.goalBudgetUsd, MONITOR_ACTOR, ENGINEERING_TEMPLATE, JSON.stringify(inputs)],
    );
    try {
      await db.query("UPDATE atlas.eng_incidents SET status = 'assigned', exec_goal_id = $2 WHERE id = $1", [inc.id, eg.id]);
    } catch {
      // The one-open-job-per-repository index refused it: another job got there first.
      throw new ConflictingJob(inc.id);
    }
    await db.query("INSERT INTO atlas.exec_events (exec_goal_id, kind, to_state, actor, detail, event_key) VALUES ($1, 'goal.state', 'GOAL_RECEIVED', $2, $3, $4)", [
      eg.id,
      MONITOR_ACTOR,
      clip(`${source === "fixture" ? "FIXTURE: " : ""}${facts.workflowName} failed on ${repo.repo}@${sha7} (run ${facts.runId}). ${decision.reason}`, 500),
      `intake:${key}`,
    ]);
    return { kind: "goal", incidentId: inc.id, goalId: eg.id, autonomy: decision.autonomy, reason: decision.reason };
  }).catch(async (e) => {
    if (!(e instanceof ConflictingJob)) throw e;
    // Record it as escalated instead (outside the rolled-back transaction).
    return ingestEscalated(d, facts, repo.repo, category, cls, key, source, "An engineering job is already open on this repository; two at once could write over each other.");
  });
  if (made.kind === "goal") await advance(d, made.goalId, MONITOR_ACTOR);
  return made;
}

class ConflictingJob extends Error {
  constructor(readonly incidentId: string) {
    super("conflicting job");
  }
}

async function ingestEscalated(d: IntakeDeps, facts: RunFacts, repo: string, category: FailureCategory, cls: Classification | null, key: string, source: string, why: string): Promise<IngestOutcome> {
  return d.db.tx(async (db) => {
    const [inc] = await db.query<{ id: string }>(
      `INSERT INTO atlas.eng_incidents (repo, workflow_name, workflow_path, run_id, run_attempt, run_url, head_sha, branch, category, supported, failed_jobs, status, decision, source, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'escalated', $12, $13, $14) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [repo, facts.workflowName, facts.workflowPath, facts.runId, facts.runAttempt, facts.url, facts.headSha, facts.branch, category, !!cls?.supported, JSON.stringify(cls?.failedJobs ?? []), why, source, key],
    );
    if (!inc) return { kind: "duplicate" as const, incidentId: "" };
    const owner = await escalate(db, { incidentId: inc.id, repo, category, headSha: facts.headSha, runUrl: facts.url, why });
    await db.query("UPDATE atlas.eng_incidents SET owner_task_id = $2 WHERE id = $1", [inc.id, owner]);
    return { kind: "escalated" as const, incidentId: inc.id, reason: why };
  });
}

export interface ReconcileReport {
  repos: number;
  seen: number;
  outcomes: IngestOutcome["kind"][];
}

/**
 * The scheduled sweep (runs inside the Executive's existing schedule tick): the newest failed runs of
 * each allowlisted repository's default branch, inside the pickup window. Duplicates are cheap no-ops.
 * Records each repository's newest seen commit, so it reads incrementally and never clones anything.
 */
export async function reconcile(d: IntakeDeps): Promise<ReconcileReport> {
  const out: ReconcileReport = { repos: 0, seen: 0, outcomes: [] };
  for (const repo of ENGINEERING_REPOS) {
    out.repos++;
    let runs: RunFacts[];
    try {
      runs = await d.github.recentRuns(repo.repo, repo.defaultBranch);
    } catch {
      continue;
    }
    const newest = runs[0];
    if (newest)
      await d.db.query(
        `INSERT INTO atlas.eng_repo_state (repo, default_branch, last_seen_sha, last_run_id, last_checked_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (repo) DO UPDATE SET last_seen_sha = EXCLUDED.last_seen_sha, last_run_id = EXCLUDED.last_run_id, last_checked_at = now(), updated_at = now()`,
        [repo.repo, repo.defaultBranch, newest.headSha, newest.runId],
      );
    const windowStart = nowOf(d) - ENGINEERING_LIMITS.reconcileWindowHours * 3_600_000;
    // Only the newest run per workflow matters: an older failure that a later run fixed is not news.
    const latestPerWorkflow = new Map<string, RunFacts>();
    for (const r of runs) if (!latestPerWorkflow.has(r.workflowName)) latestPerWorkflow.set(r.workflowName, r);
    for (const r of latestPerWorkflow.values()) {
      if (!repo.watchedWorkflows.includes(r.workflowName) || (r.conclusion !== "failure" && r.conclusion !== "timed_out") || Date.parse(r.createdAt) < windowStart) continue;
      out.seen++;
      out.outcomes.push((await ingestRun(d, r, "reconcile")).kind);
    }
  }
  return out;
}
