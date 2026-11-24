// Engineering Division hooks inside the Atlas Executive engine (server/executive/engine.ts). The
// engine stays the one coordinator: it claims, dispatches, retries and records every task the same
// way. These hooks only add what engineering needs on top:
//
// - an atlas.eng_executions row per runner attempt, with its lifecycle phase (TASK_ASSIGNED ...
//   PR_READY) logged to the append-only atlas.exec_events;
// - result checks for engineering-change/1 (the runner's report), qa-report/1 (Atlas QA) and
//   pr-delivery/1 (the pull request n8n opened);
// - QA's bounded repair loop: a failed QA adds one implement + QA pair with QA's feedback, at most
//   twice, then the job goes to Khaneil;
// - incident status, Khaneil's escalation task, the completion summary and an unverified lesson.
//
// This file imports only types from the engine, so there's no import cycle.

import type { Db } from "../data/db";
import type { Checked, GoalRow, Kit, RouteHandler, SettleContext, TaskRow } from "../executive/engine";
import { WORKFLOW_ROUTES, type WorkflowRoute } from "../../src/executive/control/contracts";
import { ENGINEERING_TEMPLATE } from "../../src/executive/control/plan";
import { authorizeTask } from "../../src/executive/control/policy";
import { RUN_LIMITS, type Autonomy, type GoalState, type Verification } from "../../src/executive/control/types";
import { branchFor, parseChange, parseDelivery, pullRequestText, verifyChange } from "../../src/engineering/contracts";
import { canMovePhase, routeModel } from "../../src/engineering/lifecycle";
import { engineeringRepo } from "../../src/engineering/repos";
import { CATEGORY_LABEL, ENGINEER_AGENT_ID, ENGINEERING_LIMITS, QA_AGENT_ID, type EngineeringPhase, type FailureCategory, type QaReport } from "../../src/engineering/types";

export const isEngineeringGoal = (g: { template?: string | null }) => g.template === ENGINEERING_TEMPLATE;

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);
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
const inputsOf = (g: GoalRow) => json<Record<string, string>>(g.template_inputs, {});

interface ExecRow {
  id: string;
  exec_task_id: string;
  attempt: number;
  phase: EngineeringPhase;
  head_sha: string | null;
  branch: string | null;
  runner_url: string | null;
  hypothesis: string | null;
  repair_iteration: number;
}

async function setPhase(db: Db, kit: Kit, g: GoalRow, ex: ExecRow, to: EngineeringPhase, actor: string, detail: string | null = null, at?: string): Promise<ExecRow> {
  if (!canMovePhase(ex.phase, to)) return ex;
  await db.query("UPDATE atlas.eng_executions SET phase = $2 WHERE id = $1", [ex.id, to]);
  await kit.logEvent(db, { goalId: g.id, taskId: ex.exec_task_id, kind: "engineering.phase", from: ex.phase, to, actor, detail: clip(`${detail ?? ""}${at ? `${detail ? " " : ""}(at ${at})` : ""}`, 500) || null });
  return { ...ex, phase: to };
}

async function executionFor(db: Db, taskId: string, attempt: number): Promise<ExecRow | null> {
  const [ex] = await db.query<ExecRow>("SELECT id, exec_task_id, attempt, phase, head_sha, branch, runner_url, hypothesis, repair_iteration FROM atlas.eng_executions WHERE exec_task_id = $1 AND attempt = $2", [taskId, attempt]);
  return ex ?? null;
}

/** The newest attempt that produced a pushed change: the one QA reviews and delivery opens. */
async function latestChange(db: Db, goalId: string): Promise<(ExecRow & { base_sha: string; repo: string }) | null> {
  const [ex] = await db.query<ExecRow & { base_sha: string; repo: string }>(
    "SELECT id, exec_task_id, attempt, phase, head_sha, branch, runner_url, hypothesis, repair_iteration, base_sha, repo FROM atlas.eng_executions WHERE exec_goal_id = $1 AND head_sha IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    [goalId],
  );
  return ex ?? null;
}

// ---- Claims --------------------------------------------------------------------------------------

/** When the engine claims an engineering task: the execution row and the envelope's extra inputs. */
export async function onEngineeringClaim(db: Db, c: { g: GoalRow; t: TaskRow; attempt: number; route: WorkflowRoute; runId: string }): Promise<Record<string, string>> {
  const gi = inputsOf(c.g);
  if (c.route.route === "engineering-repair") {
    const repo = engineeringRepo(c.t.inputs.repo);
    if (!repo) throw new Error(`${c.t.inputs.repo} isn't on the engineering allowlist.`);
    const iteration = Math.min(2, Math.max(0, Number(c.t.inputs.repair_iteration ?? 0) || 0));
    const [ex] = await db.query<{ id: string }>(
      `INSERT INTO atlas.eng_executions (exec_goal_id, exec_task_id, attempt, repair_iteration, incident_id, repo, base_sha)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (exec_task_id, attempt) DO UPDATE SET phase = 'TASK_ASSIGNED' RETURNING id`,
      [c.g.id, c.t.id, c.attempt, iteration, gi.incident_id || null, repo.repo, c.t.inputs.base_sha],
    );
    await db.query("INSERT INTO atlas.exec_events (exec_goal_id, exec_task_id, kind, to_state, actor, detail) VALUES ($1, $2, 'engineering.phase', 'TASK_ASSIGNED', $3, $4)", [
      c.g.id,
      c.t.id,
      ENGINEER_AGENT_ID,
      clip(`Attempt ${c.attempt}${iteration ? `, repair ${iteration}` : ""}: runner ${repo.runnerWorkflow} on ${repo.repo}@${c.t.inputs.base_sha.slice(0, 7)} (execution ${ex.id.slice(0, 8)})`, 500),
    ]);
    // Nothing secret: the runner gets the branch it may push to and its limits. Commands are fixed in
    // the runner workflow itself, never sent.
    return { branch: branchFor(c.t.id, c.attempt), max_turns: String(ENGINEERING_LIMITS.maxTurns), runner_workflow: repo.runnerWorkflow };
  }
  if (c.route.route === "qa-validation") {
    const ex = await latestChange(db, c.g.id);
    if (ex && ex.phase !== "QA_REVIEW_REQUESTED") {
      await db.query("UPDATE atlas.eng_executions SET phase = 'QA_REVIEW_REQUESTED' WHERE id = $1", [ex.id]);
      await db.query("INSERT INTO atlas.exec_events (exec_goal_id, exec_task_id, kind, from_state, to_state, actor, detail) VALUES ($1, $2, 'engineering.phase', $3, 'QA_REVIEW_REQUESTED', $4, $5)", [
        c.g.id,
        ex.exec_task_id,
        ex.phase,
        QA_AGENT_ID,
        `QA checks ${ex.branch ?? "the change"} from GitHub's own results`,
      ]);
    }
  }
  return {};
}

// ---- Goal stage -> incident ----------------------------------------------------------------------

const STAGE_STATUS: Partial<Record<GoalState, string>> = {
  AWAITING_APPROVAL: "awaiting_approval",
  EXECUTION_AUTHORIZED: "repairing",
  EXECUTION_STARTED: "repairing",
  EXECUTION_MONITORED: "repairing",
  GOAL_COMPLETED: "pr_open",
  FAILED: "failed",
  CANCELLED: "ignored",
};

export async function onEngineeringStage(db: Db, g: GoalRow, to: GoalState, reason: string | null): Promise<void> {
  const status = STAGE_STATUS[to];
  const [inc] = await db.query<{ id: string; repo: string; category: string; run_url: string | null; head_sha: string; owner_task_id: string | null; status: string }>(
    "SELECT id, repo, category, run_url, head_sha, owner_task_id, status FROM atlas.eng_incidents WHERE exec_goal_id = $1",
    [g.id],
  );
  if (!inc) return;
  if (status && status !== inc.status) await db.query("UPDATE atlas.eng_incidents SET status = $2, decision = COALESCE($3, decision), resolved_at = CASE WHEN $2 IN ('failed', 'ignored') THEN now() ELSE resolved_at END WHERE id = $1", [inc.id, status, clip(reason, 1000)]);
  else if (to === "BLOCKED") await db.query("UPDATE atlas.eng_incidents SET decision = $2 WHERE id = $1", [inc.id, clip(reason, 1000)]);
  if (to === "FAILED" && !inc.owner_task_id) {
    const ownerTask = await escalate(db, { incidentId: inc.id, repo: inc.repo, category: inc.category as FailureCategory, headSha: inc.head_sha, runUrl: inc.run_url, why: reason ?? "The engineering job failed." });
    await db.query("UPDATE atlas.eng_incidents SET owner_task_id = $2 WHERE id = $1", [inc.id, ownerTask]);
  }
}

/** A Task Center task for Khaneil: the failure Atlas won't (or couldn't) fix on its own. */
export async function escalate(db: Db, e: { incidentId: string; repo: string; category: FailureCategory; headSha: string; runUrl: string | null; why: string }): Promise<string | null> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO atlas.tasks (title, description, area, status, priority, source, origin, created_by, updated_by, dedupe_key)
     VALUES ($1, $2, 'projects', 'queued', 'high', 'github', 'system', 'atlas-executive', 'atlas-executive', $3)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running', 'blocked', 'awaiting_approval') DO NOTHING RETURNING id`,
    [
      clip(`Needs Khaneil: ${CATEGORY_LABEL[e.category]} failure in ${e.repo} (${e.headSha.slice(0, 7)})`, 200),
      clip(`Atlas Engineering didn't fix this on its own. Why: ${e.why}${e.runUrl ? ` Failed run: ${e.runUrl}` : ""}`, 4000),
      `esc:${e.incidentId}`,
    ],
  );
  return row?.id ?? null;
}

// ---- Result checks -------------------------------------------------------------------------------

const changeHandler: RouteHandler = {
  async check(_db, { t, r, at }): Promise<Checked> {
    const parsed = parseChange(r.artifact);
    if (!parsed.ok) return { schema: "engineering-change/1", body: { invalid: true }, verification: { passed: false, checkedAt: at, checks: [{ name: "Report has the expected shape", passed: false, detail: parsed.error }] }, summary: null };
    const v = verifyChange(parsed.value, { repo: t.inputs.repo, baseSha: t.inputs.base_sha, taskId: t.id, attempt: r.attempt }, at);
    const c = parsed.value;
    return { schema: "engineering-change/1", body: c, verification: v, summary: v.passed ? `${c.filesChanged.length} file(s) changed on ${c.branch}; waiting for QA` : null };
  },
  async settle(db, ctx: SettleContext) {
    const { g, t, r, checked, kit } = ctx;
    let ex = await executionFor(db, t.id, r.attempt);
    if (!ex) return "default";
    const parsed = parseChange(r.artifact);
    if (parsed.ok) {
      const c = parsed.value;
      await db.query(
        `UPDATE atlas.eng_executions SET runner_run_id = $2, runner_url = $3, head_sha = $4, branch = $5, model = $6, input_tokens = $7, output_tokens = $8, cost_usd = $9, turns = $10,
           files_changed = $11::jsonb, claimed_validation = $12::jsonb, hypothesis = $13, error = $14 WHERE id = $1`,
        [
          ex.id,
          String(c.runId),
          c.runUrl,
          c.outcome === "changed" ? c.headSha : null,
          c.outcome === "changed" ? c.branch : null,
          c.usage?.model ?? r.usage?.model ?? null,
          c.usage?.inputTokens ?? r.usage?.inputTokens ?? null,
          c.usage?.outputTokens ?? r.usage?.outputTokens ?? null,
          c.usage?.costUsd ?? r.usage?.costUsd ?? 0,
          c.usage?.turns ?? null,
          JSON.stringify(c.filesChanged.slice(0, 50)),
          JSON.stringify(c.validation),
          c.plan,
          c.error,
        ],
      );
      // The phases the runner went through, with its own job times (recorded, not invented).
      for (const p of c.phases) ex = await setPhase(db, kit, g, ex, p.phase, "atlas-runner", null, p.at);
    } else if (r.kind === "failed" && r.executionId && /^[0-9]{1,20}$/.test(r.executionId)) {
      await db.query("UPDATE atlas.eng_executions SET runner_run_id = $2, error = $3 WHERE id = $1", [ex.id, r.executionId, clip(r.error ?? null, 1000)]);
    }
    if (r.kind === "failed" || !checked.verification.passed) {
      const outcome = parsed.ok ? parsed.value.outcome : "invalid";
      const category = r.kind === "failed" ? "runner_failed" : outcome === "changed" ? "change_rejected" : outcome;
      await db.query("UPDATE atlas.eng_executions SET failure_category = $2, error = COALESCE(error, $3) WHERE id = $1", [ex.id, category, clip(r.error ?? checked.verification.checks.filter((c) => !c.passed).map((c) => c.name).join(", "), 1000)]);
      await setPhase(db, kit, g, ex, "FAILED", ENGINEER_AGENT_ID, r.error ?? checked.verification.checks.filter((c) => !c.passed).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join("; "));
      // No change or an out-of-bounds change won't get better by running the same thing again.
      if (r.kind !== "failed" && (outcome === "no_change" || outcome === "out_of_bounds" || outcome === "changed")) {
        await kit.moveTask(db, t, "failed", ENGINEER_AGENT_ID, { error: `Engineering produced no usable change (${category}).` });
        return "handled";
      }
    }
    return "default";
  },
};

function parseQa(raw: unknown): QaReport | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as QaReport;
  if (q.schema !== "qa-report/1" || !["PASS", "FAIL", "BLOCKED", "NEEDS_REVIEW"].includes(q.outcome) || !Array.isArray(q.checks)) return null;
  return q;
}

const qaHandler: RouteHandler = {
  async check(_db, { r, at }): Promise<Checked> {
    const q = parseQa(r.artifact);
    if (!q) return { schema: "qa-report/1", body: { invalid: true }, verification: { passed: false, checkedAt: at, checks: [{ name: "QA report has the expected shape", passed: false }] }, summary: null };
    const verification: Verification = { passed: q.outcome === "PASS" || q.outcome === "NEEDS_REVIEW", checkedAt: q.checkedAt, checks: q.checks.map((c) => ({ name: c.name, passed: c.passed, ...(c.detail ? { detail: c.detail } : {}) })) };
    return { schema: "qa-report/1", body: q, verification, summary: `QA ${q.outcome}: ${q.checks.filter((c) => c.passed).length} of ${q.checks.length} checks passed` };
  },
  async settle(db, ctx: SettleContext) {
    const { d, g, t, checked, kit } = ctx;
    const q = parseQa(checked.body);
    const ex = await latestChange(db, g.id);
    if (!q || !ex) return "default";
    await db.query("UPDATE atlas.eng_executions SET qa_outcome = $2, qa_report = $3::jsonb, qa_at = now() WHERE id = $1", [ex.id, q.outcome, JSON.stringify(q)]);
    await kit.logEvent(db, { goalId: g.id, taskId: t.id, kind: "qa.outcome", actor: QA_AGENT_ID, detail: clip(`${q.outcome}: ${q.checks.filter((c) => !c.passed).map((c) => c.name).join("; ") || "every check passed"}`, 500) });
    const tasks = await kit.tasksOf(db, g.id, true);
    const deliver = tasks.find((x) => x.plan_key === "deliver");
    if (q.outcome === "BLOCKED") {
      // Evidence unreadable (GitHub down, run not finished): try again on a later tick, never pass it.
      if (t.attempts >= t.max_attempts) {
        await kit.moveTask(db, t, "failed", QA_AGENT_ID, { error: `QA couldn't read GitHub's evidence after ${t.attempts} attempts.` });
        return "handled";
      }
      await setPhase(db, kit, g, ex, "BLOCKED", QA_AGENT_ID, "QA couldn't read GitHub's evidence; trying again shortly");
      await kit.moveTask(db, t, "ready", QA_AGENT_ID, { error: "QA couldn't read GitHub's evidence" }, "Will try again on the next schedule tick");
      await db.query("UPDATE atlas.exec_tasks SET lease_until = now() + interval '5 minutes' WHERE id = $1", [t.id]);
      return "handled";
    }
    if (q.outcome === "PASS" || q.outcome === "NEEDS_REVIEW") {
      if (!deliver || !ex.head_sha || !ex.branch) return "default";
      const repo = engineeringRepo(ex.repo)!;
      const gi = inputsOf(g);
      const text = pullRequestText({
        repo,
        category: (gi.category as FailureCategory) ?? "unknown",
        workflowName: gi.workflow ?? "CI",
        failedRunUrl: gi.failed_run_url || null,
        baseSha: ex.base_sha,
        branch: ex.branch,
        qa: q,
        runUrl: ex.runner_url,
        plan: ex.hypothesis,
        goalId: g.id,
        taskRecordId: t.task_id,
        today: new Date(kit.now()).toISOString().slice(0, 10),
      });
      const inputs = { repo: repo.repo, base: repo.defaultBranch, branch: ex.branch, head_sha: ex.head_sha, title: text.title, body: text.body, qa_outcome: q.outcome };
      await db.query("UPDATE atlas.exec_tasks SET inputs = $2::jsonb WHERE id = $1", [deliver.id, JSON.stringify(inputs)]);
      if (q.outcome === "PASS") {
        await setPhase(db, kit, g, ex, "PR_READY", QA_AGENT_ID, "QA passed on GitHub's own results");
        return "default";
      }
      // NEEDS_REVIEW: a dependency or security-relevant change. Khaneil approves the pull request first.
      await setPhase(db, kit, g, ex, "AWAITING_APPROVAL", QA_AGENT_ID, `Needs Khaneil: ${[...q.dependencyChanges, ...q.securityRelevant].join(", ")}`);
      await kit.moveTask(db, t, "completed", QA_AGENT_ID, {}, "QA NEEDS_REVIEW: the pull request waits for Khaneil");
      const fresh = (await kit.tasksOf(db, g.id, true)).find((x) => x.id === deliver.id)!;
      await kit.fileApproval(db, g, fresh, `QA found changes that need a person: ${[...q.dependencyChanges.map((f) => `dependency file ${f}`), ...q.securityRelevant.map((f) => `security-relevant ${f}`)].join(", ")}.`);
      await kit.moveTask(db, fresh, "awaiting_approval", QA_AGENT_ID);
      const goal = await kit.lockGoal(db, g.id);
      if (goal && goal.state !== "AWAITING_APPROVAL") await kit.moveGoal(db, goal, "AWAITING_APPROVAL", QA_AGENT_ID, "QA asks Khaneil to look at the change before a pull request opens");
      return "handled";
    }
    // FAIL: back to Engineering with QA's feedback, at most maxRepairIterations times.
    await setPhase(db, kit, g, ex, "FAILED", QA_AGENT_ID, `QA FAIL: ${q.feedback.slice(0, 3).join(" ")}`);
    await db.query("UPDATE atlas.eng_executions SET failure_category = 'qa_fail' WHERE id = $1", [ex.id]);
    const done = tasks.filter((x) => x.capability === "engineering.implement_fix").length - 1;
    const next = done + 1;
    const left = g.budget_usd - g.spent_usd;
    if (next > ENGINEERING_LIMITS.maxRepairIterations || left < ENGINEERING_LIMITS.implementCapUsd || !deliver) {
      const why = next > ENGINEERING_LIMITS.maxRepairIterations ? `QA failed after ${ENGINEERING_LIMITS.maxRepairIterations} repair attempts` : `QA failed and only $${Math.max(0, left).toFixed(2)} of the budget is left`;
      await kit.moveTask(db, t, "failed", QA_AGENT_ID, { error: clip(`${why}: ${q.feedback.join(" ")}`, 1000) });
      return "handled";
    }
    await kit.moveTask(db, t, "completed", QA_AGENT_ID, {}, `QA FAIL: sent back to Engineering (repair ${next} of ${ENGINEERING_LIMITS.maxRepairIterations})`);
    await addRepair(db, ctx, next, q, deliver);
    void d;
    return "handled";
  },
};

/** Adds implement-rN and qa-rN after a failed QA and points delivery at the new QA. */
async function addRepair(db: Db, ctx: SettleContext, n: number, q: QaReport, deliver: TaskRow): Promise<void> {
  const { g, kit } = ctx;
  const tasks = await kit.tasksOf(db, g.id, true);
  const first = tasks.find((x) => x.plan_key === "implement")!;
  const prev = await latestChange(db, g.id);
  const category = (first.inputs.category as FailureCategory) ?? "unknown";
  const model = routeModel(category, n);
  const feedback = q.feedback.join(" ").slice(0, 1500);
  const implRoute = WORKFLOW_ROUTES["engineering.implement_fix"];
  const qaRoute = WORKFLOW_ROUTES["qa.verify_change"];
  const make = async (key: string, title: string, capabilityId: string, agentId: string, route: WorkflowRoute, level: number, cap: number, dependsOn: string[], inputs: Record<string, string>, description: string) => {
    const [task] = await db.query<{ id: string }>(
      `INSERT INTO atlas.tasks (title, description, area, status, priority, goal_id, source, origin, created_by, updated_by)
       VALUES ($1, $2, $3, 'queued', 'high', $4, 'agent', 'agent', 'atlas-executive', 'atlas-executive') RETURNING id`,
      [title.slice(0, 200), description.slice(0, 4000), g.area, g.goal_id],
    );
    const [row] = await db.query<{ id: string }>(
      `INSERT INTO atlas.exec_tasks (exec_goal_id, plan_key, task_id, title, capability, depends_on, inputs, agent_id, workflow, action_level, max_cost_usd, max_attempts, timeout_seconds)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [g.id, key, task.id, title, capabilityId, JSON.stringify(dependsOn), JSON.stringify(inputs), agentId, route.workflow, level, cap, route.maxAttempts, route.timeoutSeconds],
    );
    await kit.logEvent(db, { goalId: g.id, taskId: row.id, kind: "task.created", to: "pending", actor: "atlas-executive", detail: clip(`${title} (repair ${n}, Task Center ${task.id.slice(0, 8)})`, 500) });
    return row.id;
  };
  const implKey = `implement-r${n}`;
  const qaKey = `qa-r${n}`;
  const implId = await make(
    implKey,
    `Repair ${n}: fix what QA found`,
    "engineering.implement_fix",
    ENGINEER_AGENT_ID,
    implRoute,
    first.action_level,
    ENGINEERING_LIMITS.implementCapUsd,
    [],
    { ...first.inputs, repair_iteration: String(n), feedback, model: model.model, previous_branch: prev?.branch ?? "" },
    `Atlas QA sent the change back. QA feedback: ${feedback}`,
  );
  await make(qaKey, `Repair ${n}: verify again`, "qa.verify_change", QA_AGENT_ID, qaRoute, 1, 0, [implKey], { repo: first.inputs.repo, base_sha: first.inputs.base_sha }, "Atlas QA checks the repaired change from GitHub's own results.");
  await db.query("UPDATE atlas.exec_tasks SET depends_on = $2::jsonb WHERE id = $1", [deliver.id, JSON.stringify([qaKey])]);
  // The repair runs under the same policy as the first attempt: allowed, or Khaneil approves it.
  const impl = (await kit.tasksOf(db, g.id, true)).find((x) => x.id === implId)!;
  const a = authorizeTask({ goalAutonomy: g.autonomy as Autonomy, actionLevel: impl.action_level as Autonomy, estimatedCostUsd: impl.max_cost_usd, budgetRemainingUsd: g.budget_usd - g.spent_usd, autoSpendCeilingUsd: RUN_LIMITS.autoSpendCeilingUsd });
  await kit.logEvent(db, { goalId: g.id, taskId: impl.id, kind: "policy.decision", actor: "atlas-executive", detail: a.kind === "allowed" ? `Allowed: ${a.note}` : a.reason });
  if (a.kind === "needs_approval") {
    await kit.fileApproval(db, g, impl, a.reason);
    await kit.moveTask(db, impl, "awaiting_approval", "atlas-executive");
    const goal = await kit.lockGoal(db, g.id);
    if (goal && goal.state !== "AWAITING_APPROVAL") await kit.moveGoal(db, goal, "AWAITING_APPROVAL", "atlas-executive", "A repair attempt needs Khaneil's approval");
  } else if (a.kind === "refused") await kit.moveTask(db, impl, "failed", "atlas-executive", { error: a.reason });
}

const deliveryHandler: RouteHandler = {
  async check(_db, { t, r, at }): Promise<Checked> {
    const parsed = parseDelivery(r.artifact);
    if (!parsed.ok) return { schema: "pr-delivery/1", body: { invalid: true }, verification: { passed: false, checkedAt: at, checks: [{ name: "Delivery report has the expected shape", passed: false, detail: parsed.error }] }, summary: null };
    const p = parsed.value;
    const checks = [
      { name: "Pull request is in the repository Atlas named", passed: p.repo === t.inputs.repo },
      { name: "Pull request is for the branch QA checked", passed: p.branch === t.inputs.branch },
      { name: "Pull request head is the exact commit QA checked", passed: p.headSha === t.inputs.head_sha },
    ];
    return { schema: "pr-delivery/1", body: p, verification: { passed: checks.every((c) => c.passed), checkedAt: at, checks }, summary: `Pull request #${p.prNumber} opened` };
  },
  async settle(db, ctx: SettleContext) {
    const p = parseDelivery(ctx.r.artifact);
    if (!p.ok || !ctx.checked.verification.passed) return "default";
    await db.query("UPDATE atlas.eng_executions SET pr_url = $1, pr_number = $2 WHERE exec_goal_id = $3 AND head_sha = $4", [p.value.prUrl, p.value.prNumber, ctx.g.id, p.value.headSha]);
    await ctx.kit.logEvent(db, { goalId: ctx.g.id, taskId: ctx.t.id, kind: "pr.opened", actor: ENGINEER_AGENT_ID, detail: `${p.value.prUrl} (head ${p.value.headSha.slice(0, 7)}). Atlas never merges it.` });
    return "default";
  },
};

export const engineeringHandlers: Readonly<Record<string, RouteHandler>> = {
  "engineering-change/1": changeHandler,
  "qa-report/1": qaHandler,
  "pr-delivery/1": deliveryHandler,
};

// ---- Completion ----------------------------------------------------------------------------------

/** The report task: the Executive's completion summary and an unverified lesson. No model. */
export async function engineeringSummary(db: Db, g: GoalRow, t: TaskRow, kit: Kit): Promise<void> {
  await db.query("UPDATE atlas.exec_tasks SET attempts = attempts + 1, dispatched_at = now() WHERE id = $1", [t.id]);
  t = await kit.moveTask(db, await kit.moveTask(db, t, "dispatching", "atlas-executive"), "running", "atlas-executive", {}, "Runs inside Atlas (no model)");
  const gi = inputsOf(g);
  const execs = await db.query<{ attempt: number; repair_iteration: number; qa_outcome: string | null; pr_url: string | null; cost_usd: number; files_changed: unknown; head_sha: string | null; branch: string | null; runner_url: string | null }>(
    "SELECT attempt, repair_iteration, qa_outcome, pr_url, cost_usd::float8 AS cost_usd, files_changed, head_sha, branch, runner_url FROM atlas.eng_executions WHERE exec_goal_id = $1 ORDER BY created_at",
    [g.id],
  );
  const delivered = execs.find((e) => e.pr_url);
  if (!delivered) {
    await kit.moveTask(db, t, "failed", "atlas-executive", { error: "No pull request was recorded for a QA-checked change." });
    return;
  }
  const files = json<{ path: string }[]>(delivered.files_changed, []).map((f) => f.path);
  const cost = execs.reduce((s, e) => s + Number(e.cost_usd), 0);
  const repairs = Math.max(0, ...execs.map((e) => e.repair_iteration));
  const category = (gi.category as FailureCategory) ?? "unknown";
  const risks = [
    delivered.qa_outcome === "NEEDS_REVIEW" ? "QA flagged dependency or security-relevant changes; Khaneil approved opening the pull request." : null,
    "CI runs again on the pull request; merge only when it's green.",
    gi.source === "fixture" ? "This was a labelled local fixture, not a real production repair." : null,
  ].filter(Boolean);
  const summary = clip(
    `${CATEGORY_LABEL[category]} failure in ${gi.repo} at ${String(gi.base_sha ?? "").slice(0, 7)} fixed on ${delivered.branch} (${files.length} file${files.length === 1 ? "" : "s"}: ${files.slice(0, 4).join(", ")}). QA ${delivered.qa_outcome} from GitHub's own results after ${repairs} repair${repairs === 1 ? "" : "s"}. Pull request ${delivered.pr_url} is ready for Khaneil's review. Model cost $${cost.toFixed(2)}. Remaining risks: ${risks.join(" ")}`,
    2000,
  )!;
  await db.query("UPDATE atlas.exec_goals SET summary = $2 WHERE id = $1", [g.id, summary]);
  if (g.goal_id) await db.query("INSERT INTO atlas.ai_notes (subject_table, subject_id, kind, body, area, agent_id) VALUES ('goals', $1, 'recommendation', $2, $3, 'atlas-executive')", [g.goal_id, summary.slice(0, 4000), g.area]);
  // Operational knowledge for next time: verified facts only (category, files, outcome), stored as an
  // unverified lesson until Khaneil verifies it. Engineering's own explanation is not copied in.
  if (gi.source !== "fixture")
    await db.query(
      `INSERT INTO atlas.memory_items (category, kind, title, content, tags, area, agent_id, task_key, error_class, source_kind, source_ref, source_url, origin, created_by, updated_by)
       VALUES ('operational', 'lesson', $1, $2, $3, $4, $5, $6, $7, 'run', $8, $9, 'agent', $5, $5)`,
      [
        clip(`${CATEGORY_LABEL[category]} failure in ${gi.repo} fixed in ${files.slice(0, 2).join(", ") || "the code"}`, 160),
        clip(`A ${category} failure on ${gi.repo}@${String(gi.base_sha ?? "").slice(0, 7)} (${gi.workflow ?? "CI"}) was fixed by changing ${files.join(", ")}. QA ${delivered.qa_outcome} after ${repairs} repair(s). PR ${delivered.pr_url}.`, 2000),
        clip(`engineering,${category},${gi.repo}`, 500),
        g.area,
        ENGINEER_AGENT_ID,
        gi.incident_key && /^[A-Za-z0-9._:-]{3,160}$/.test(gi.incident_key) ? gi.incident_key : null,
        category,
        `exec_goal:${g.id}`,
        delivered.pr_url,
      ],
    );
  const verifying = await kit.moveTask(db, t, "verifying", "atlas-executive");
  await kit.moveTask(db, verifying, "completed", "atlas-executive", {}, "Completion summary and lesson recorded");
}
