// Atlas Executive: the durable orchestration engine. Runs on the site (Pages Functions) against the
// Atlas PostgreSQL database, never in the app: closing the Mac app or the page stops nothing, and a
// restart loses nothing, because every state lives in the database (db/migrations/0002_executive.sql).
//
// Work moves forward only on events: a goal Khaneil submits, a workflow result coming back, a
// button in Mission Control, or the n8n schedule's reconciliation tick. There is no loop that runs
// on its own and no model call here; plans come from templates and checks are plain code.
//
// Safety rules enforced here, before anything runs:
// - every state change is checked against src/executive/control/lifecycle.ts and logged;
// - a task runs only on an agent picked by select.ts, through a mapped workflow, after the
//   autonomy policy allows it (policy.ts) or Khaneil approved that exact action;
// - dispatch is claimed with a conditional UPDATE, so two ticks can't send the same task;
// - budget, per-agent concurrency, the daily cap and the emergency stop are checked per dispatch;
// - a task completes only when Atlas's own checks pass on the returned output (verify.ts).

import { canMoveGoal, canMoveTask, isTerminalGoal, taskCenterStatus } from "../../src/executive/control/lifecycle";
import { checkPlan, draftPlan, draftTemplatePlan, validateGoal } from "../../src/executive/control/plan";
import { APPROVAL_TTL_MS, authorizeTask, bindingHash, checkApproval, type ActionBinding } from "../../src/executive/control/policy";
import { actionLevel, selectAgent, type AgentStats, type RosterAgent } from "../../src/executive/control/select";
import { estimateCost, WORKFLOW_ROUTES, type DispatchEnvelope, type ResultBody, type WorkflowRoute } from "../../src/executive/control/contracts";
import { parseReport, summarise, verifyReport } from "../../src/executive/control/verify";
import { capability } from "../../src/intelligence/capabilities";
import {
  DEFAULT_AUTONOMY,
  EXECUTIVE_AGENT_ID,
  PLAN_LIMITS,
  RUN_LIMITS,
  type ApprovalView,
  type Autonomy,
  type EventView,
  type ExecutivePlan,
  type ExecutiveOverview,
  type GoalState,
  type GoalView,
  type OpportunityReport,
  type TaskState,
  type TaskView,
  type Verification,
} from "../../src/executive/control/types";
import type { Db } from "../data/db";
import { ENGINEERING_LIMITS } from "../../src/engineering/types";
import { engineeringHandlers, engineeringSummary, isEngineeringGoal, onEngineeringClaim, onEngineeringStage } from "../engineering/handlers";

export interface DispatchAnswer {
  state: "accepted" | "refused" | "unknown";
  error?: string;
}

/** What carries a task out. The site uses the n8n adapter; tests use the mock in mockAdapter.ts. */
export interface ExecutionAdapter {
  name: string;
  configured: boolean;
  dispatch(route: WorkflowRoute, envelope: DispatchEnvelope): Promise<DispatchAnswer>;
}

/** Work that runs inside the site through the normal claim and result path (QA). Keyed by route. */
export type LocalRunner = (envelope: DispatchEnvelope) => Promise<ResultBody>;

export interface Deps {
  db: Db;
  adapter: ExecutionAdapter;
  /** In-site runners by route (route.local). A missing one holds the task with the reason. */
  local?: Partial<Record<string, LocalRunner>>;
  /** The Agent Registry as it is on main. Throws when it can't be read. */
  roster: () => Promise<RosterAgent[]>;
  /** The Phase 9 emergency stop: a reason while it's on, null when off. Must fail closed. */
  stop: () => Promise<string | null>;
  now?: () => number;
  /** Random hex (nonces, keys). */
  random?: () => string;
}

const nowOf = (d: Deps) => (d.now ? d.now() : Date.now());
const iso = (d: Deps) => new Date(nowOf(d)).toISOString();
const randomHex = (d: Deps) => {
  if (d.random) return d.random();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);

export class ExecRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---- Rows -----------------------------------------------------------------------------------------

export interface GoalRow {
  id: string;
  goal_id: string | null;
  objective: string;
  state: GoalState;
  resume_state: GoalState | null;
  state_reason: string | null;
  autonomy: number;
  budget_usd: number;
  spent_usd: number;
  summary: string | null;
  template: string | null;
  template_inputs: Record<string, string> | null;
  area: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskRow {
  id: string;
  exec_goal_id: string;
  plan_key: string;
  task_id: string | null;
  title: string;
  capability: string;
  depends_on: string[];
  inputs: Record<string, string>;
  agent_id: string | null;
  workflow: string | null;
  state: TaskState;
  action_level: number;
  max_cost_usd: number;
  cost_usd: number;
  attempts: number;
  max_attempts: number;
  timeout_seconds: number;
  lease_until: string | null;
  correlation_id: string | null;
  idempotency_key: string | null;
  nonce_hash: string | null;
  external_execution_id: string | null;
  run_id: string | null;
  approval_id: string | null;
  blocked_reason: string | null;
  error: string | null;
  dispatched_at: string | null;
  finished_at: string | null;
}

const GOAL_COLS = "id, goal_id, objective, state, resume_state, state_reason, autonomy, budget_usd::float8 AS budget_usd, spent_usd::float8 AS spent_usd, summary, template, template_inputs, area, created_at, updated_at, completed_at";
const TASK_COLS =
  "id, exec_goal_id, plan_key, task_id, title, capability, depends_on, inputs, agent_id, workflow, state, action_level, max_cost_usd::float8 AS max_cost_usd, cost_usd::float8 AS cost_usd, attempts, max_attempts, timeout_seconds, lease_until, correlation_id, idempotency_key, nonce_hash, external_execution_id, run_id, approval_id, blocked_reason, error, dispatched_at, finished_at";

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
const fixTask = (r: TaskRow): TaskRow => ({ ...r, depends_on: json<string[]>(r.depends_on, []), inputs: json<Record<string, string>>(r.inputs, {}), lease_until: ts(r.lease_until), dispatched_at: ts(r.dispatched_at), finished_at: ts(r.finished_at) });

async function lockGoal(db: Db, id: string): Promise<GoalRow | null> {
  const [g] = await db.query<GoalRow>(`SELECT ${GOAL_COLS} FROM atlas.exec_goals WHERE id = $1 FOR UPDATE`, [id]);
  return g ?? null;
}

async function tasksOf(db: Db, goalId: string, lock = false): Promise<TaskRow[]> {
  return (await db.query<TaskRow>(`SELECT ${TASK_COLS} FROM atlas.exec_tasks WHERE exec_goal_id = $1 ORDER BY created_at, plan_key${lock ? " FOR UPDATE" : ""}`, [goalId])).map(fixTask);
}

async function logEvent(db: Db, e: { goalId: string; taskId?: string | null; kind: string; from?: string | null; to?: string | null; actor: string; detail?: string | null; correlationId?: string | null; key?: string }): Promise<boolean> {
  const rows = await db.query<{ id: number }>(
    `INSERT INTO atlas.exec_events (exec_goal_id, exec_task_id, kind, from_state, to_state, actor, detail, correlation_id, event_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
    [e.goalId, e.taskId ?? null, e.kind, e.from ?? null, e.to ?? null, e.actor.slice(0, 120), clip(e.detail ?? null, 500), e.correlationId ?? null, e.key ?? null],
  );
  return rows.length > 0;
}

async function moveGoal(db: Db, g: GoalRow, to: GoalState, actor: string, reason: string | null = null, resume?: GoalState | null): Promise<GoalRow> {
  if (g.state === to) return g;
  if (!canMoveGoal(g.state, to)) throw new Error(`Goal can't move from ${g.state} to ${to}.`);
  const completed = to === "GOAL_COMPLETED" ? ", completed_at = now()" : "";
  const [n] = await db.query<GoalRow>(`UPDATE atlas.exec_goals SET state = $2, state_reason = $3, resume_state = $4${completed} WHERE id = $1 RETURNING ${GOAL_COLS}`, [g.id, to, clip(reason, 1000), resume === undefined ? g.resume_state : resume]);
  await logEvent(db, { goalId: g.id, kind: "goal.state", from: g.state, to, actor, detail: reason });
  if (isEngineeringGoal(g)) await onEngineeringStage(db, n, to, reason);
  return n;
}

async function moveTask(db: Db, t: TaskRow, to: TaskState, actor: string, fields: Partial<Record<"blocked_reason" | "error", string | null>> = {}, detail?: string): Promise<TaskRow> {
  if (t.state === to && fields.blocked_reason === undefined && fields.error === undefined) return t;
  if (t.state !== to && !canMoveTask(t.state, to)) throw new Error(`Task can't move from ${t.state} to ${to}.`);
  const finished = to === "completed" || to === "failed" || to === "cancelled" ? ", finished_at = now(), lease_until = NULL" : "";
  const [n] = await db.query<TaskRow>(
    `UPDATE atlas.exec_tasks SET state = $2, blocked_reason = COALESCE($3, CASE WHEN $2 = 'blocked' THEN blocked_reason ELSE NULL END), error = COALESCE($4, error)${finished} WHERE id = $1 RETURNING ${TASK_COLS}`,
    [t.id, to, clip(fields.blocked_reason ?? null, 1000), clip(fields.error ?? null, 1000)],
  );
  if (t.task_id) await db.query("UPDATE atlas.tasks SET status = $2, updated_by = $3 WHERE id = $1 AND status <> $2", [t.task_id, taskCenterStatus(to), EXECUTIVE_AGENT_ID]);
  if (t.state !== to) await logEvent(db, { goalId: t.exec_goal_id, taskId: t.id, kind: "task.state", from: t.state, to, actor, detail: detail ?? fields.blocked_reason ?? fields.error ?? null, correlationId: t.correlation_id });
  return fixTask(n);
}

// ---- Goal intake ----------------------------------------------------------------------------------

/** Khaneil submits a goal (GOAL_RECEIVED), then it advances as far as it can on its own. */
export async function submitGoal(d: Deps, input: unknown, owner: string): Promise<GoalView> {
  const v = validateGoal(input, RUN_LIMITS.maxBudgetUsd);
  if (!v.ok) throw new ExecRefusal(400, v.problems.join(" "));
  const id = await d.db.tx(async (db) => {
    const [{ n }] = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM atlas.exec_goals WHERE state NOT IN ('GOAL_COMPLETED', 'FAILED', 'CANCELLED')");
    if (n >= PLAN_LIMITS.maxActiveGoals) throw new ExecRefusal(429, `${n} goals are already open; finish or cancel one first (the limit is ${PLAN_LIMITS.maxActiveGoals}).`);
    const [goal] = await db.query<{ id: string }>(
      `INSERT INTO atlas.goals (title, description, area, priority, status, origin, created_by, updated_by, owner_confirmed_at)
       VALUES ($1, $2, 'business', 'medium', 'active', 'owner', $3, $3, now()) RETURNING id`,
      [v.value.objective.slice(0, 200), v.value.objective, owner.slice(0, 120)],
    );
    const [eg] = await db.query<{ id: string }>("INSERT INTO atlas.exec_goals (goal_id, objective, autonomy, budget_usd, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id", [
      goal.id,
      v.value.objective,
      v.value.autonomy ?? DEFAULT_AUTONOMY,
      v.value.budgetUsd ?? RUN_LIMITS.defaultBudgetUsd,
      owner.slice(0, 120),
    ]);
    await logEvent(db, { goalId: eg.id, kind: "goal.state", to: "GOAL_RECEIVED", actor: owner, detail: "Goal received from Khaneil" });
    return eg.id;
  });
  await advance(d, id, owner);
  return (await goalView(d.db, id))!;
}

// ---- The step machine -----------------------------------------------------------------------------

interface Send {
  task: TaskRow;
  route: WorkflowRoute;
  envelope: DispatchEnvelope;
}

const MAX_STEPS = 16;

/**
 * Moves one goal forward as far as it can go right now. Each step runs in its own transaction with
 * the goal row locked; sends to n8n happen between transactions so no lock is held on the network.
 */
export async function advance(d: Deps, goalId: string, actor: string): Promise<void> {
  let unblocked = false;
  for (let i = 0; i < MAX_STEPS; i++) {
    let roster: RosterAgent[] | Error | null = null;
    // Assignment needs the registry; read it before locking anything.
    const [peek] = await d.db.query<{ state: GoalState; resume_state: GoalState | null }>("SELECT state, resume_state FROM atlas.exec_goals WHERE id = $1", [goalId]);
    if (!peek) return;
    if (peek.state === "TASKS_CREATED" || (peek.state === "BLOCKED" && peek.resume_state === "TASKS_CREATED" && !unblocked)) {
      try {
        roster = await d.roster();
      } catch (e) {
        roster = e instanceof Error ? e : new Error(String(e));
      }
    }
    const stopped = await d.stop();
    const out = await d.db.tx((db) => step(d, db, goalId, actor, roster, stopped, unblocked));
    if (out.unblocked) unblocked = true;
    for (const s of out.sends) await send(d, s, actor);
    if (!out.moved && !out.sends.length) return;
  }
}

type StepOut = { moved: boolean; sends: Send[]; unblocked?: boolean };

async function step(d: Deps, db: Db, goalId: string, actor: string, roster: RosterAgent[] | Error | null, stopped: string | null, unblocked: boolean): Promise<StepOut> {
  const g = await lockGoal(db, goalId);
  if (!g || isTerminalGoal(g.state) || g.state === "PAUSED") return { moved: false, sends: [] };
  const done = (moved: boolean, sends: Send[] = []): StepOut => ({ moved, sends });
  switch (g.state) {
    case "GOAL_RECEIVED": {
      const v = validateGoal({ objective: g.objective }, RUN_LIMITS.maxBudgetUsd);
      if (!v.ok) return done(!!(await moveGoal(db, g, "FAILED", actor, v.problems.join(" "))));
      await moveGoal(db, g, "GOAL_VALIDATED", EXECUTIVE_AGENT_ID, "Objective is clear and within limits");
      return done(true);
    }
    case "GOAL_VALIDATED": {
      const p = g.template ? draftTemplatePlan(g.template, json<Record<string, string>>(g.template_inputs, {}), ENGINEERING_LIMITS.implementCapUsd) : draftPlan(g.objective);
      if (!p.ok) {
        await moveGoal(db, g, "BLOCKED", EXECUTIVE_AGENT_ID, p.reason, "GOAL_VALIDATED");
        return done(false);
      }
      await db.query("INSERT INTO atlas.exec_plans (exec_goal_id, plan, accepted) VALUES ($1, $2::jsonb, false)", [g.id, JSON.stringify(p.plan)]);
      await moveGoal(db, g, "PLAN_GENERATED", EXECUTIVE_AGENT_ID, `Template ${p.plan.template}: ${p.plan.tasks.length} tasks, up to $${p.plan.estimatedCostUsd.toFixed(2)}`);
      return done(true);
    }
    case "PLAN_GENERATED": {
      const [row] = await db.query<{ id: string; plan: unknown }>("SELECT id, plan FROM atlas.exec_plans WHERE exec_goal_id = $1 ORDER BY created_at DESC LIMIT 1", [g.id]);
      const checked = checkPlan(json(row?.plan, null), { budgetUsd: g.budget_usd });
      if (!checked.ok) {
        if (row) await db.query("UPDATE atlas.exec_plans SET problems = $2::jsonb WHERE id = $1", [row.id, JSON.stringify(checked.problems)]);
        await moveGoal(db, g, "FAILED", EXECUTIVE_AGENT_ID, `Plan rejected: ${checked.problems.join(" ")}`);
        return done(false);
      }
      await db.query("UPDATE atlas.exec_plans SET accepted = true WHERE id = $1", [row.id]);
      await moveGoal(db, g, "PLAN_CHECKED", EXECUTIVE_AGENT_ID, "Shape, capabilities, dependencies, limits and budget checked");
      return done(true);
    }
    case "PLAN_CHECKED": {
      const plan = await acceptedPlan(db, g.id);
      if (!plan) return done(!!(await moveGoal(db, g, "FAILED", EXECUTIVE_AGENT_ID, "The accepted plan is missing.")));
      for (const t of plan.tasks) {
        const route = WORKFLOW_ROUTES[t.capability];
        const [task] = await db.query<{ id: string }>(
          `INSERT INTO atlas.tasks (title, description, area, status, priority, goal_id, source, origin, created_by, updated_by)
           VALUES ($1, $2, $5, 'queued', $6, $3, 'agent', 'agent', $4, $4) RETURNING id`,
          [t.title.slice(0, 200), `Atlas Executive task. Done when: ${t.acceptance.join("; ")}`.slice(0, 4000), g.goal_id, EXECUTIVE_AGENT_ID, g.area ?? "business", isEngineeringGoal(g) ? "high" : "medium"],
        );
        const [et] = await db.query<{ id: string }>(
          `INSERT INTO atlas.exec_tasks (exec_goal_id, plan_key, task_id, title, capability, depends_on, inputs, max_cost_usd, max_attempts, timeout_seconds)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10) RETURNING id`,
          [g.id, t.key, task.id, t.title, t.capability, JSON.stringify(t.dependsOn), JSON.stringify(t.inputs), t.maxCostUsd, route?.maxAttempts ?? 1, route?.timeoutSeconds ?? 60],
        );
        await logEvent(db, { goalId: g.id, taskId: et.id, kind: "task.created", to: "pending", actor: EXECUTIVE_AGENT_ID, detail: `${t.title} (Task Center ${task.id.slice(0, 8)})` });
      }
      await moveGoal(db, g, "TASKS_CREATED", EXECUTIVE_AGENT_ID, `${plan.tasks.length} Task Center tasks created`);
      return done(true);
    }
    case "BLOCKED": {
      if (g.resume_state !== "TASKS_CREATED" || unblocked) return done(false);
      await moveGoal(db, g, "TASKS_CREATED", actor, "Trying agent assignment again", null);
      for (const t of await tasksOf(db, g.id, true)) if (t.state === "blocked") await moveTask(db, t, "pending", actor);
      return { moved: true, sends: [], unblocked: true };
    }
    case "TASKS_CREATED":
      return done(await assign(db, g, roster));
    case "AGENTS_ASSIGNED":
      return done(await authorize(d, db, g));
    case "AWAITING_APPROVAL":
      return done(await reviewApprovals(d, db, g));
    case "EXECUTION_AUTHORIZED":
    case "EXECUTION_STARTED":
    case "EXECUTION_MONITORED":
      return run(d, db, g, actor, stopped);
    case "RESULTS_VERIFIED": {
      await moveGoal(db, g, "GOAL_COMPLETED", EXECUTIVE_AGENT_ID, "Every task completed and passed verification");
      return done(true);
    }
    default:
      return done(false);
  }
}

async function acceptedPlan(db: Db, goalId: string): Promise<ExecutivePlan | null> {
  const [row] = await db.query<{ plan: unknown }>("SELECT plan FROM atlas.exec_plans WHERE exec_goal_id = $1 AND accepted ORDER BY created_at DESC LIMIT 1", [goalId]);
  return row ? json<ExecutivePlan | null>(row.plan, null) : null;
}

async function agentStats(db: Db): Promise<Map<string, AgentStats>> {
  const out = new Map<string, AgentStats>();
  const active = await db.query<{ agent_id: string; n: number }>("SELECT agent_id, COUNT(*)::int AS n FROM atlas.exec_tasks WHERE state IN ('dispatching', 'running') AND agent_id IS NOT NULL GROUP BY agent_id");
  const runs = await db.query<{ agent_id: string; ok: number; bad: number }>(
    "SELECT agent_id, COUNT(*) FILTER (WHERE status = 'succeeded')::int AS ok, COUNT(*) FILTER (WHERE status = 'failed')::int AS bad FROM atlas.agent_runs WHERE started_at > now() - interval '30 days' GROUP BY agent_id",
  );
  for (const r of runs) out.set(r.agent_id, { active: 0, succeeded: r.ok, failed: r.bad });
  for (const a of active) out.set(a.agent_id, { ...(out.get(a.agent_id) ?? { succeeded: 0, failed: 0 }), active: a.n });
  return out;
}

/** TASKS_CREATED -> AGENTS_ASSIGNED, or BLOCKED with the missing capability. */
async function assign(db: Db, g: GoalRow, roster: RosterAgent[] | Error | null): Promise<boolean> {
  if (!Array.isArray(roster)) {
    await moveGoal(db, g, "BLOCKED", EXECUTIVE_AGENT_ID, `The Agent Registry couldn't be read (${roster instanceof Error ? roster.message : "not loaded"}). Atlas tries again on the next check.`, "TASKS_CREATED");
    return false;
  }
  const stats = await agentStats(db);
  const blocked: string[] = [];
  for (const t of await tasksOf(db, g.id, true)) {
    if (t.state !== "pending" || t.agent_id) continue;
    const sel = selectAgent(t.capability, roster, stats);
    if (!sel.ok) {
      blocked.push(`${t.title}: ${sel.reason}`);
      await moveTask(db, t, "blocked", EXECUTIVE_AGENT_ID, { blocked_reason: sel.reason });
      await logEvent(db, { goalId: g.id, taskId: t.id, kind: "capability.missing", actor: EXECUTIVE_AGENT_ID, detail: `${sel.missingCapability ?? t.capability}: ${sel.reason}` });
      continue;
    }
    const route = WORKFLOW_ROUTES[t.capability];
    await db.query("UPDATE atlas.exec_tasks SET agent_id = $2, workflow = $3, action_level = $4 WHERE id = $1", [t.id, sel.agent.id, route?.workflow ?? "Atlas (in process)", actionLevel(sel.capability)]);
    await logEvent(db, {
      goalId: g.id,
      taskId: t.id,
      kind: "agent.assigned",
      actor: EXECUTIVE_AGENT_ID,
      detail: `${sel.agent.name} (${sel.agent.id}); candidates: ${sel.candidates.map((c) => `${c.agentId} ${c.eligible ? c.score : "ineligible"}`).join(", ")}`,
    });
  }
  if (blocked.length) {
    await moveGoal(db, g, "BLOCKED", EXECUTIVE_AGENT_ID, `No eligible agent: ${blocked.join(" | ")}`, "TASKS_CREATED");
    return false;
  }
  await moveGoal(db, g, "AGENTS_ASSIGNED", EXECUTIVE_AGENT_ID, "Every task has an eligible registered agent");
  return true;
}

function bindingFor(g: GoalRow, t: TaskRow): ActionBinding {
  return { action: "executive.run_task", target: `${t.capability}:${t.id}`, params: { agentId: t.agent_id ?? "", workflow: t.workflow ?? "", maxCostUsd: Number(t.max_cost_usd), goalId: g.id }, requestedBy: EXECUTIVE_AGENT_ID };
}

async function reservedUsd(db: Db, goalId: string): Promise<number> {
  const [r] = await db.query<{ n: number }>("SELECT COALESCE(SUM(max_cost_usd), 0)::float8 AS n FROM atlas.exec_tasks WHERE exec_goal_id = $1 AND state IN ('dispatching', 'running')", [goalId]);
  return r.n;
}

/** AGENTS_ASSIGNED -> EXECUTION_AUTHORIZED, or AWAITING_APPROVAL, or BLOCKED. */
async function authorize(d: Deps, db: Db, g: GoalRow): Promise<boolean> {
  const tasks = await tasksOf(db, g.id, true);
  let waiting = false;
  for (const t of tasks) {
    if (t.state !== "pending") continue;
    const a = authorizeTask({ goalAutonomy: g.autonomy as Autonomy, actionLevel: t.action_level as Autonomy, estimatedCostUsd: t.max_cost_usd, budgetRemainingUsd: g.budget_usd - g.spent_usd, autoSpendCeilingUsd: RUN_LIMITS.autoSpendCeilingUsd });
    if (a.kind === "refused") {
      await moveTask(db, t, "blocked", EXECUTIVE_AGENT_ID, { blocked_reason: a.reason });
      await moveGoal(db, g, "BLOCKED", EXECUTIVE_AGENT_ID, a.reason, "AGENTS_ASSIGNED");
      return false;
    }
    await logEvent(db, { goalId: g.id, taskId: t.id, kind: "policy.decision", actor: EXECUTIVE_AGENT_ID, detail: a.kind === "allowed" ? `Allowed: ${a.note}` : `Needs approval: ${a.reason}` });
    if (a.kind === "needs_approval") {
      await fileApproval(d, db, g, t, a.reason);
      await moveTask(db, t, "awaiting_approval", EXECUTIVE_AGENT_ID);
      waiting = true;
    }
  }
  await moveGoal(db, g, waiting ? "AWAITING_APPROVAL" : "EXECUTION_AUTHORIZED", EXECUTIVE_AGENT_ID, waiting ? "At least one task needs Khaneil's approval" : "Every task is allowed at this goal's autonomy level");
  return true;
}

async function fileApproval(d: Deps, db: Db, g: GoalRow, t: TaskRow, reason: string): Promise<void> {
  const binding = bindingFor(g, t);
  const hash = await bindingHash(binding);
  const cap = capability(t.capability);
  const [a] = await db.query<{ id: string }>(
    `INSERT INTO atlas.approvals (kind, proposed_action, context, area, payload, requested_by, task_id, goal_id, expires_at)
     VALUES ($1, $2, $3, 'business', $4::jsonb, $5, $6, $7, $8) RETURNING id`,
    [
      cap?.sideEffect === "spend" ? "financial" : "other",
      `Let ${t.agent_id} run "${t.title}" via ${t.workflow} (up to $${t.max_cost_usd.toFixed(2)})`.slice(0, 500),
      `Atlas Executive goal: ${g.objective}. ${reason}`.slice(0, 4000),
      JSON.stringify({ executive: { binding, bindingHash: hash } }),
      EXECUTIVE_AGENT_ID,
      t.task_id,
      g.goal_id,
      new Date(nowOf(d) + APPROVAL_TTL_MS).toISOString(),
    ],
  );
  await db.query("UPDATE atlas.exec_tasks SET approval_id = $2 WHERE id = $1", [t.id, a.id]);
  await logEvent(db, { goalId: g.id, taskId: t.id, kind: "approval.requested", actor: EXECUTIVE_AGENT_ID, detail: `Approval ${a.id.slice(0, 8)} expires in 48 hours` });
}

/** AWAITING_APPROVAL: apply Khaneil's decisions; rejected or expired approvals fail the task. */
async function reviewApprovals(d: Deps, db: Db, g: GoalRow): Promise<boolean> {
  const tasks = await tasksOf(db, g.id, true);
  for (const t of tasks) {
    if (t.state !== "awaiting_approval" || !t.approval_id) continue;
    const [a] = await db.query<{ status: string; reviewer: string | null; requested_by: string; expires_at: unknown; payload: unknown }>("SELECT status, reviewer, requested_by, expires_at, payload FROM atlas.approvals WHERE id = $1 FOR UPDATE", [t.approval_id]);
    const payload = json<{ executive?: { bindingHash?: string } }>(a?.payload, {});
    const check = a
      ? await checkApproval({ status: a.status, reviewer: a.reviewer, requestedBy: a.requested_by, expiresAt: ts(a.expires_at), bindingHash: payload.executive?.bindingHash ?? null }, bindingFor(g, t), nowOf(d))
      : ({ ok: false, state: "invalid", reason: "The approval record is missing." } as const);
    if (check.ok) {
      // Back to pending: run() releases it once its dependencies finish.
      await moveTask(db, t, "pending", EXECUTIVE_AGENT_ID, {}, "Khaneil approved this exact action");
      continue;
    }
    if (check.state === "pending") continue;
    if (check.state === "expired" && a?.status === "pending") await db.query("UPDATE atlas.approvals SET status = 'expired', decided_at = now() WHERE id = $1", [t.approval_id]);
    await moveTask(db, t, "failed", EXECUTIVE_AGENT_ID, { error: check.reason });
  }
  const after = await tasksOf(db, g.id);
  if (after.some((t) => t.state === "failed")) {
    await moveGoal(db, g, "FAILED", EXECUTIVE_AGENT_ID, after.find((t) => t.state === "failed")?.error ?? "A task failed");
    return false;
  }
  if (after.some((t) => t.state === "awaiting_approval")) return false;
  const started = after.some((t) => t.attempts > 0 || t.state === "completed");
  await moveGoal(db, g, started ? "EXECUTION_MONITORED" : "EXECUTION_AUTHORIZED", EXECUTIVE_AGENT_ID, "Approvals settled");
  return true;
}

async function dispatchesToday(db: Db): Promise<number> {
  const [r] = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM atlas.exec_events WHERE kind = 'task.dispatched' AND created_at > now() - interval '24 hours'");
  return r.n;
}

/** EXECUTION_AUTHORIZED / STARTED / MONITORED: release ready tasks, dispatch them, run in-process ones, settle. */
async function run(d: Deps, db: Db, g: GoalRow, actor: string, stopped: string | null): Promise<StepOut> {
  const tasks = await tasksOf(db, g.id, true);
  const byKey = new Map(tasks.map((t) => [t.plan_key, t]));
  let moved = false;
  for (const t of tasks) {
    if (t.state !== "pending") continue;
    const deps = t.depends_on.map((k) => byKey.get(k));
    if (deps.some((x) => !x || x.state === "failed" || x.state === "cancelled")) {
      await moveTask(db, t, "cancelled", EXECUTIVE_AGENT_ID, { error: "A task it depends on didn't finish" });
      moved = true;
    } else if (deps.every((x) => x!.state === "completed")) {
      await moveTask(db, t, "ready", EXECUTIVE_AGENT_ID);
      moved = true;
    }
  }
  const sends: Send[] = [];
  const fresh = await tasksOf(db, g.id, true);
  for (const t of fresh) {
    if (t.state !== "ready") continue;
    const route = WORKFLOW_ROUTES[t.capability];
    if (!route) {
      await runInProcess(d, db, g, t);
      moved = true;
      continue;
    }
    const s = await claim(d, db, g, t, route, stopped, sends.length);
    if (s) sends.push(s);
  }
  const now = await tasksOf(db, g.id);
  if (now.some((t) => t.state === "failed")) {
    await moveGoal(db, g, "FAILED", EXECUTIVE_AGENT_ID, now.find((t) => t.state === "failed")?.error ?? "A task failed");
    return { moved: false, sends };
  }
  if (now.length && now.every((t) => t.state === "completed")) {
    if (g.state === "EXECUTION_AUTHORIZED") g = await moveGoal(db, g, "EXECUTION_STARTED", EXECUTIVE_AGENT_ID);
    if (g.state === "EXECUTION_STARTED") g = await moveGoal(db, g, "EXECUTION_MONITORED", EXECUTIVE_AGENT_ID);
    await moveGoal(db, g, "RESULTS_VERIFIED", EXECUTIVE_AGENT_ID, "All tasks completed and verified by Atlas's checks");
    return { moved: true, sends };
  }
  if (g.state === "EXECUTION_AUTHORIZED" && (sends.length || now.some((t) => t.attempts > 0 || t.state === "completed"))) {
    g = await moveGoal(db, g, "EXECUTION_STARTED", EXECUTIVE_AGENT_ID, sends.length ? `Dispatched ${sends.length} task(s)` : null);
    moved = true;
  }
  if (g.state === "EXECUTION_STARTED") {
    await moveGoal(db, g, "EXECUTION_MONITORED", EXECUTIVE_AGENT_ID);
    moved = true;
  }
  void actor;
  return { moved, sends };
}

/** Claims one ready task for sending: the conditional UPDATE is the lock against double dispatch. */
async function claim(d: Deps, db: Db, g: GoalRow, t: TaskRow, route: WorkflowRoute, stopped: string | null, sentThisStep: number): Promise<Send | null> {
  const hold = async (why: string) => {
    if (t.blocked_reason !== why) await db.query("UPDATE atlas.exec_tasks SET blocked_reason = $2 WHERE id = $1", [t.id, why]);
    return null;
  };
  if (stopped) return hold(stopped);
  if (route.local ? !d.local?.[route.route] : !d.adapter.configured)
    return hold(route.local ? `${route.workflow} isn't set up on the site yet.` : "The n8n Executive Dispatch workflow isn't set up on the site yet (N8N_BRIDGE_TOKEN / N8N_BRIDGE_CALLBACK_TOKEN).");
  if (t.attempts >= t.max_attempts) {
    await moveTask(db, t, "failed", EXECUTIVE_AGENT_ID, { error: `Gave up after ${t.attempts} attempts.` });
    return null;
  }
  // A local retry can carry a "not before" time (QA waiting for GitHub to answer again), so it waits
  // for a later schedule tick instead of spending every attempt at once.
  if (route.local && t.lease_until && Date.parse(t.lease_until) > Date.now()) return hold("Waiting a few minutes before trying again.");
  if (!route.local && (await dispatchesToday(db)) + sentThisStep >= RUN_LIMITS.dailyDispatchCap) return hold(`The daily limit of ${RUN_LIMITS.dailyDispatchCap} Executive dispatches is reached.`);
  const [busy] = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM atlas.exec_tasks WHERE agent_id = $1 AND state IN ('dispatching', 'running') AND id <> $2", [t.agent_id, t.id]);
  if (busy.n >= RUN_LIMITS.perAgentConcurrency) return hold(`${t.agent_id} is already running ${busy.n} task(s); waiting for a free slot.`);
  const left = g.budget_usd - g.spent_usd - (await reservedUsd(db, g.id));
  if (t.max_cost_usd > left) {
    await moveTask(db, t, "failed", EXECUTIVE_AGENT_ID, { error: `Not enough budget left ($${Math.max(0, left).toFixed(2)}) for another attempt (up to $${t.max_cost_usd.toFixed(2)}).` });
    return null;
  }
  const attempt = t.attempts + 1;
  const correlationId = `exec-${g.id.slice(0, 8)}-${t.plan_key}`;
  const idempotencyKey = `${t.id}:${attempt}`;
  const nonce = randomHex(d);
  const [claimed] = await db.query<TaskRow>(
    `UPDATE atlas.exec_tasks SET state = 'dispatching', attempts = $3, correlation_id = $4, idempotency_key = $5, nonce_hash = $6,
       lease_until = now() + make_interval(secs => timeout_seconds), dispatched_at = now(), blocked_reason = NULL, error = NULL
     WHERE id = $1 AND state = 'ready' AND attempts = $2 RETURNING ${TASK_COLS}`,
    [t.id, t.attempts, attempt, correlationId, idempotencyKey, await sha256(nonce)],
  );
  if (!claimed) return null;
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO atlas.agent_runs (agent_id, workflow_id, idempotency_key, input_ref, status, goal_id, task_id)
     VALUES ($1, $2, $3, $4, 'running', $5, $6) ON CONFLICT (idempotency_key) DO UPDATE SET status = 'running' RETURNING id`,
    [t.agent_id, route.workflowId && !route.workflowId.startsWith("N8N_") ? route.workflowId : route.workflow, `exec:${idempotencyKey}`, `atlas-executive goal ${g.id}`, g.goal_id, t.task_id],
  );
  await db.query("UPDATE atlas.exec_tasks SET run_id = $2 WHERE id = $1", [t.id, r.id]);
  if (t.task_id) await db.query("UPDATE atlas.tasks SET status = 'running', updated_by = $2 WHERE id = $1", [t.task_id, EXECUTIVE_AGENT_ID]);
  await logEvent(db, { goalId: g.id, taskId: t.id, kind: route.local ? "task.started_local" : "task.dispatched", from: "ready", to: "dispatching", actor: EXECUTIVE_AGENT_ID, detail: `Attempt ${attempt} to ${route.workflow} (${t.agent_id})`, correlationId });
  const extra = isEngineeringGoal(g) ? await onEngineeringClaim(db, { g, t: fixTask(claimed), attempt, route, runId: r.id }) : {};
  return {
    task: fixTask(claimed),
    route,
    envelope: {
      contract: "ATLAS_EXECUTIVE_DISPATCH",
      version: 1,
      route: route.route,
      goalId: g.id,
      taskId: t.id,
      attempt,
      correlationId,
      idempotencyKey,
      nonce,
      deadlineAt: new Date(nowOf(d) + route.timeoutSeconds * 1000).toISOString(),
      inputs: { ...t.inputs, ...extra },
      limits: { maxSearches: route.maxSearches, maxOutputTokens: 6000 },
    },
  };
}

/** Sends a claimed task (outside any transaction) and records what n8n answered. */
async function send(d: Deps, s: Send, actor: string): Promise<void> {
  if (s.route.local) {
    // In-site work (QA): no network send to n8n. Its result goes through the same checks as any other.
    let result: ResultBody;
    try {
      result = await d.local![s.route.route]!(s.envelope);
    } catch (e) {
      result = { contract: "ATLAS_EXECUTIVE_ERROR", version: 1, eventId: `${s.envelope.idempotencyKey}:local`, taskId: s.envelope.taskId, attempt: s.envelope.attempt, correlationId: s.envelope.correlationId, idempotencyKey: s.envelope.idempotencyKey, nonce: s.envelope.nonce, executionId: "local", kind: "failed", error: clip(e instanceof Error ? e.message : String(e), 900) ?? "Local run failed", transient: true, at: iso(d) };
    }
    await applyResult(d, result);
    return;
  }
  let answer: DispatchAnswer;
  try {
    answer = await d.adapter.dispatch(s.route, s.envelope);
  } catch (e) {
    answer = { state: "unknown", error: e instanceof Error ? e.message : String(e) };
  }
  await d.db.tx(async (db) => {
    const [t] = (await db.query<TaskRow>(`SELECT ${TASK_COLS} FROM atlas.exec_tasks WHERE id = $1 FOR UPDATE`, [s.task.id])).map(fixTask);
    if (!t || t.idempotency_key !== s.envelope.idempotencyKey) return;
    await logEvent(db, { goalId: t.exec_goal_id, taskId: t.id, kind: `dispatch.${answer.state}`, actor: d.adapter.name, detail: answer.error ?? null, correlationId: t.correlation_id });
    if (t.state !== "dispatching") return; // the result already arrived
    if (answer.state === "accepted") await moveTask(db, t, "running", actor);
    else if (answer.state === "refused") {
      await db.query("UPDATE atlas.agent_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [t.run_id, clip(answer.error ?? "Refused", 2000)]);
      if (t.attempts < t.max_attempts) await moveTask(db, t, "ready", actor, { error: answer.error ?? "n8n refused the task" });
      else await moveTask(db, t, "failed", actor, { error: answer.error ?? "n8n refused the task" });
    }
    // unknown: leave it dispatching; the lease runs out and the reconciliation tick decides.
  });
}

/** In-process work (executive.verify): re-check the research results and write the summary. No model. */
async function runInProcess(d: Deps, db: Db, g: GoalRow, t: TaskRow): Promise<void> {
  if (t.capability === "executive.verify" && isEngineeringGoal(g)) {
    await engineeringSummary(db, g, t, kit(d));
    return;
  }
  if (t.capability !== "executive.verify") {
    await moveTask(db, t, "failed", EXECUTIVE_AGENT_ID, { error: `Atlas has no way to run ${t.capability} itself.` });
    return;
  }
  await db.query("UPDATE atlas.exec_tasks SET attempts = attempts + 1, dispatched_at = now() WHERE id = $1", [t.id]);
  // Same path as outside work, in one transaction: ready -> dispatching -> running -> verifying.
  t = await moveTask(db, await moveTask(db, t, "dispatching", EXECUTIVE_AGENT_ID), "running", EXECUTIVE_AGENT_ID, {}, "Runs inside Atlas (no model)");
  const artifacts = await db.query<{ body: unknown; verification: unknown; verified: boolean; exec_task_id: string }>(
    "SELECT a.body, a.verification, a.verified, a.exec_task_id FROM atlas.exec_artifacts a JOIN atlas.exec_tasks t ON t.id = a.exec_task_id WHERE a.exec_goal_id = $1 AND t.state = 'completed' ORDER BY a.created_at DESC",
    [g.id],
  );
  const good = artifacts.find((a) => a.verified);
  if (!good) {
    await moveTask(db, t, "failed", EXECUTIVE_AGENT_ID, { error: "No verified result to summarise." });
    return;
  }
  const report = json<OpportunityReport>(good.body, null as unknown as OpportunityReport);
  const v = json<Verification | null>(good.verification, null);
  if (!v?.passed) {
    await moveTask(db, t, "failed", EXECUTIVE_AGENT_ID, { error: "The research result didn't pass verification." });
    return;
  }
  const summary = summarise(report);
  await db.query("UPDATE atlas.exec_goals SET summary = $2 WHERE id = $1", [g.id, summary.slice(0, 2000)]);
  if (g.goal_id)
    await db.query("INSERT INTO atlas.ai_notes (subject_table, subject_id, kind, body, area, agent_id) VALUES ('goals', $1, 'recommendation', $2, 'business', $3)", [g.goal_id, summary.slice(0, 4000), EXECUTIVE_AGENT_ID]);
  const verifying = await moveTask(db, t, "verifying", EXECUTIVE_AGENT_ID);
  await moveTask(db, verifying, "completed", EXECUTIVE_AGENT_ID, {}, "Summary and recommended next step recorded");
}

// ---- Results from n8n -----------------------------------------------------------------------------

export type ResultAnswer = { status: number; body: { stored: boolean; duplicate?: boolean; stale?: boolean; message?: string } };

/** What a route's output became after Atlas checked it. */
export interface Checked {
  schema: string;
  body: unknown;
  searched?: string[];
  verification: Verification;
  /** agent_runs.result_summary when it passed. */
  summary: string | null;
}

/** Tools the route handlers get, so they never import the engine (no cycle) and use the same checked writes. */
export interface Kit {
  moveTask: typeof moveTask;
  moveGoal: typeof moveGoal;
  logEvent: typeof logEvent;
  tasksOf: typeof tasksOf;
  lockGoal: typeof lockGoal;
  fixTask: typeof fixTask;
  /** Files an owner approval bound to this exact task action (same rules as the Executive's own). */
  fileApproval: (db: Db, g: GoalRow, t: TaskRow, reason: string) => Promise<void>;
  now: () => number;
}

export interface SettleContext {
  d: Deps;
  g: GoalRow;
  t: TaskRow;
  r: ResultBody;
  checked: Checked;
  kit: Kit;
}

/**
 * One handler per result schema. check() decides whether the output is acceptable; settle() may take
 * over what happens next (QA's repair loop). Returning "default" keeps the normal rule: passed ->
 * completed, failed -> retry while attempts are left, then failed.
 */
export interface RouteHandler {
  check(db: Db, ctx: { d: Deps; g: GoalRow; t: TaskRow; r: ResultBody; at: string }): Promise<Checked>;
  settle?(db: Db, ctx: SettleContext): Promise<"default" | "handled">;
}

const researchHandler: RouteHandler = {
  async check(_db, { r, at }) {
    const parsed = parseReport(r.report);
    const verification: Verification = parsed.ok ? verifyReport(parsed.report, r.searched ?? [], at) : { passed: false, checkedAt: at, checks: [{ name: "Report has the expected shape", passed: false, detail: parsed.error }] };
    return {
      schema: "opportunity-report/1",
      body: parsed.ok ? parsed.report : { invalid: true },
      searched: (r.searched ?? []).slice(0, 100),
      verification,
      summary: parsed.ok ? `${parsed.report.productName}: verified opportunity report, ${parsed.report.sources.length} sources` : null,
    };
  },
};

const kit = (d: Deps): Kit => ({ moveTask, moveGoal, logEvent, tasksOf, lockGoal, fixTask, fileApproval: (db, g, t, reason) => fileApproval(d, db, g, t, reason), now: () => nowOf(d) });

function handlerFor(capabilityId: string): RouteHandler {
  const route = WORKFLOW_ROUTES[capabilityId];
  if (route && engineeringHandlers[route.resultSchema]) return engineeringHandlers[route.resultSchema]!;
  return researchHandler;
}

/** ATLAS_WORKFLOW_RESULT / ATLAS_EXECUTIVE_ERROR, already authenticated by the callback key. */
export async function receiveResult(d: Deps, r: ResultBody): Promise<ResultAnswer> {
  const out = await applyResult(d, r);
  if (out.goalId) {
    await advance(d, out.goalId, "n8n");
    // The agent's slot may be free now: move on other goals whose next task waits for it.
    const waiting = await d.db.query<{ id: string }>(
      `SELECT DISTINCT w.exec_goal_id AS id FROM atlas.exec_tasks w JOIN atlas.exec_tasks done ON done.id = $1
        WHERE w.state = 'ready' AND w.agent_id = done.agent_id AND w.exec_goal_id <> $2 LIMIT 5`,
      [r.taskId, out.goalId],
    );
    for (const w of waiting) await advance(d, w.id, "n8n");
  }
  return { status: out.status, body: out.body };
}

/** Records and checks one result in a transaction. Doesn't move the goal on (callers do). */
export async function applyResult(d: Deps, r: ResultBody): Promise<ResultAnswer & { goalId?: string }> {
  return d.db.tx(async (db): Promise<ResultAnswer & { goalId?: string }> => {
    const [t] = (await db.query<TaskRow>(`SELECT ${TASK_COLS} FROM atlas.exec_tasks WHERE id = $1 FOR UPDATE`, [r.taskId])).map(fixTask);
    if (!t) return { status: 404, body: { stored: false, message: "Atlas didn't send this task." } };
    // The result must name the attempt the site sent: same key, correlation id and attempt, and the nonce.
    const expectedKey = `${t.id}:${r.attempt}`;
    if (r.idempotencyKey !== expectedKey || r.correlationId !== t.correlation_id || r.attempt > t.attempts) return { status: 409, body: { stored: false, message: "The result doesn't match a dispatch Atlas made." } };
    const fresh = await logEvent(db, { goalId: t.exec_goal_id, taskId: t.id, kind: r.contract === "ATLAS_EXECUTIVE_ERROR" ? "result.error" : `result.${r.kind}`, actor: "n8n", detail: clip(r.error ?? `execution ${r.executionId}`, 300), correlationId: r.correlationId, key: `result:${r.eventId}` });
    if (!fresh) return { status: 200, body: { stored: true, duplicate: true } };
    if (r.idempotencyKey !== t.idempotency_key || r.attempt !== t.attempts || !(t.state === "dispatching" || t.state === "running")) {
      await logEvent(db, { goalId: t.exec_goal_id, taskId: t.id, kind: "result.stale", actor: "n8n", detail: `Attempt ${r.attempt} arrived while the task is ${t.state} at attempt ${t.attempts}; ignored` });
      return { status: 200, body: { stored: true, stale: true } };
    }
    if (!t.nonce_hash || (await sha256(r.nonce)) !== t.nonce_hash) return { status: 403, body: { stored: false, message: "The result's nonce doesn't match the dispatch." } };
    const [g] = await db.query<GoalRow>(`SELECT ${GOAL_COLS} FROM atlas.exec_goals WHERE id = $1 FOR UPDATE`, [t.exec_goal_id]);
    const cost = r.usage ? estimateCost(r.usage) : 0;
    await db.query("UPDATE atlas.exec_tasks SET external_execution_id = $2, cost_usd = cost_usd + $3 WHERE id = $1", [t.id, r.executionId.slice(0, 60), cost]);
    await db.query("UPDATE atlas.exec_goals SET spent_usd = spent_usd + $2 WHERE id = $1", [t.exec_goal_id, cost]);
    const runFields = [t.run_id, r.executionId.slice(0, 120), r.usage?.model ?? null, r.usage?.inputTokens ?? null, r.usage?.outputTokens ?? null, cost];
    const finishRun = (status: "succeeded" | "failed", summary: string | null, error: string | null) =>
      db.query(
        "UPDATE atlas.agent_runs SET status = $7, external_run_id = $2, model = $3, input_tokens = $4, output_tokens = $5, cost_usd = $6, result_summary = $8, error = $9, finished_at = now() WHERE id = $1",
        [...runFields, status, clip(summary, 2000), clip(error, 2000)],
      );
    const running = t.state === "dispatching" ? await moveTask(db, t, "running", "n8n") : t;
    const retryOrFail = async (task: TaskRow, why: string, retryable: boolean) => {
      if (retryable && task.attempts < task.max_attempts) await moveTask(db, task, "ready", "n8n", { error: why }, `Will retry: ${why}`);
      else await moveTask(db, task, "failed", "n8n", { error: why });
    };
    const handler = handlerFor(t.capability);
    if (r.kind === "failed") {
      await finishRun("failed", null, r.error ?? "The workflow reported a failure.");
      // Engineering records the failed attempt (runner diagnostics) before the normal retry rule runs.
      if (handler.settle && g) {
        const checked: Checked = { schema: "failure", body: { error: r.error ?? null }, verification: { passed: false, checkedAt: iso(d), checks: [{ name: "The run finished", passed: false, detail: r.error }] }, summary: null };
        if ((await handler.settle(db, { d, g, t: running, r, checked, kit: kit(d) })) === "handled") return { status: 202, body: { stored: true }, goalId: t.exec_goal_id };
      }
      await retryOrFail(running, r.error ?? "The workflow reported a failure.", !!r.transient);
      return { status: 202, body: { stored: true }, goalId: t.exec_goal_id };
    }
    // Succeeded: Atlas checks the output itself before anything counts as done.
    const verifying = await moveTask(db, running, "verifying", EXECUTIVE_AGENT_ID);
    const checked = await handler.check(db, { d, g, t: verifying, r, at: iso(d) });
    const { verification } = checked;
    await db.query("INSERT INTO atlas.exec_artifacts (exec_task_id, exec_goal_id, attempt, schema, body, searched, verification, verified) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)", [
      t.id,
      t.exec_goal_id,
      r.attempt,
      checked.schema,
      JSON.stringify(checked.body),
      JSON.stringify(checked.searched ?? []),
      JSON.stringify(verification),
      verification.passed,
    ]);
    const failedChecks = verification.checks.filter((c) => !c.passed);
    await logEvent(db, { goalId: t.exec_goal_id, taskId: t.id, kind: verification.passed ? "verification.passed" : "verification.failed", actor: EXECUTIVE_AGENT_ID, detail: verification.passed ? `${verification.checks.length} checks passed` : failedChecks.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join("; ") });
    await finishRun(verification.passed ? "succeeded" : "failed", verification.passed ? checked.summary : null, verification.passed ? null : `Verification failed: ${failedChecks.map((c) => c.name).join(", ")}`);
    if (handler.settle && g && (await handler.settle(db, { d, g, t: verifying, r, checked, kit: kit(d) })) === "handled") return { status: 202, body: { stored: true }, goalId: t.exec_goal_id };
    if (verification.passed) await moveTask(db, verifying, "completed", EXECUTIVE_AGENT_ID, {}, "Output passed Atlas's checks");
    else await retryOrFail(verifying, `The output failed Atlas's checks: ${failedChecks.map((c) => c.name).join(", ")}`, true);
    return { status: 202, body: { stored: true }, goalId: t.exec_goal_id };
  });
}

// ---- Reconciliation (ATLAS_EXECUTIVE_SCHEDULE and the Check now button) ---------------------------

export interface TickReport {
  goals: number;
  timedOut: number;
  advanced: number;
}

/**
 * Finds stalled attempts (lease ran out) and retries or fails them, then moves every open goal on.
 * It creates no goals and no tasks: an idle Atlas stays idle however often the schedule fires.
 */
export async function tick(d: Deps, actor: string): Promise<TickReport> {
  const stalled = await d.db.tx(async (db) => {
    const rows = (await db.query<TaskRow>(`SELECT ${TASK_COLS} FROM atlas.exec_tasks WHERE state IN ('dispatching', 'running') AND lease_until < now() FOR UPDATE SKIP LOCKED`)).map(fixTask);
    for (const t of rows) {
      const why = `No result within ${t.timeout_seconds} seconds (attempt ${t.attempts}).`;
      if (t.run_id) await db.query("UPDATE atlas.agent_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status IN ('queued', 'running')", [t.run_id, why]);
      await logEvent(db, { goalId: t.exec_goal_id, taskId: t.id, kind: "task.stalled", actor, detail: why, correlationId: t.correlation_id });
      if (t.attempts < t.max_attempts) await moveTask(db, t, "ready", actor, { error: why }, `Will retry: ${why}`);
      else await moveTask(db, t, "failed", actor, { error: `${why} Gave up after ${t.attempts} attempts.` });
    }
    return rows.length;
  });
  const open = await d.db.query<{ id: string }>("SELECT id FROM atlas.exec_goals WHERE state NOT IN ('GOAL_COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED') ORDER BY updated_at LIMIT 20");
  let advanced = 0;
  for (const g of open) {
    const before = await d.db.query<{ version: number }>("SELECT version FROM atlas.exec_goals WHERE id = $1", [g.id]);
    await advance(d, g.id, actor);
    const after = await d.db.query<{ version: number }>("SELECT version FROM atlas.exec_goals WHERE id = $1", [g.id]);
    if (after[0]?.version !== before[0]?.version) advanced++;
  }
  return { goals: open.length, timedOut: stalled, advanced };
}

// ---- Owner controls -------------------------------------------------------------------------------

export async function pauseGoal(d: Deps, id: string, owner: string): Promise<void> {
  await d.db.tx(async (db) => {
    const g = await lockGoal(db, id);
    if (!g) throw new ExecRefusal(404, "No such goal.");
    if (isTerminalGoal(g.state)) throw new ExecRefusal(409, "This goal is already closed.");
    if (g.state === "PAUSED") return;
    await moveGoal(db, g, "PAUSED", owner, "Paused by Khaneil. Running work finishes; nothing new starts.", g.state);
  });
}

export async function resumeGoal(d: Deps, id: string, owner: string): Promise<void> {
  await d.db.tx(async (db) => {
    const g = await lockGoal(db, id);
    if (!g) throw new ExecRefusal(404, "No such goal.");
    if (g.state !== "PAUSED") throw new ExecRefusal(409, "This goal isn't paused.");
    await moveGoal(db, g, g.resume_state ?? "GOAL_RECEIVED", owner, "Resumed by Khaneil", null);
  });
  await advance(d, id, owner);
}

/** Cancels the goal and every unfinished task. n8n has no cancel for a running execution, so a late result is recorded and ignored. */
export async function cancelGoal(d: Deps, id: string, owner: string): Promise<void> {
  await d.db.tx(async (db) => {
    const g = await lockGoal(db, id);
    if (!g) throw new ExecRefusal(404, "No such goal.");
    if (isTerminalGoal(g.state)) throw new ExecRefusal(409, "This goal is already closed.");
    for (const t of await tasksOf(db, g.id, true)) {
      if (t.state === "completed" || t.state === "failed" || t.state === "cancelled") continue;
      if (t.approval_id) await db.query("UPDATE atlas.approvals SET status = 'cancelled', decided_at = now() WHERE id = $1 AND status = 'pending'", [t.approval_id]);
      if (t.run_id) await db.query("UPDATE atlas.agent_runs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status IN ('queued', 'running')", [t.run_id]);
      await moveTask(db, t, "cancelled", owner, { error: "Goal cancelled by Khaneil" });
    }
    await moveGoal(db, g, "CANCELLED", owner, "Cancelled by Khaneil");
  });
}

// ---- Reads ----------------------------------------------------------------------------------------

function taskView(t: TaskRow, names: ReadonlyMap<string, string>, art: { body: unknown; verification: unknown } | undefined): TaskView {
  return {
    id: t.id,
    key: t.plan_key,
    title: t.title,
    taskRecordId: t.task_id,
    capability: t.capability,
    agentId: t.agent_id,
    agentName: t.agent_id ? (names.get(t.agent_id) ?? t.agent_id) : null,
    workflow: t.workflow,
    state: t.state,
    actionLevel: t.action_level as Autonomy,
    dependsOn: t.depends_on,
    attempts: t.attempts,
    maxAttempts: t.max_attempts,
    correlationId: t.correlation_id,
    externalExecutionId: t.external_execution_id,
    blockedReason: t.blocked_reason,
    error: t.error,
    costUsd: t.cost_usd,
    dispatchedAt: t.dispatched_at,
    finishedAt: t.finished_at,
    artifact: art ? { report: json<OpportunityReport | null>(art.body, null), verification: json<Verification | null>(art.verification, null) } : null,
  };
}

export async function goalView(db: Db, id: string, names: ReadonlyMap<string, string> = new Map()): Promise<GoalView | null> {
  const [g] = await db.query<GoalRow>(`SELECT ${GOAL_COLS} FROM atlas.exec_goals WHERE id = $1`, [id]);
  if (!g) return null;
  return (await goalViews(db, [g], names))[0];
}

async function goalViews(db: Db, goals: GoalRow[], names: ReadonlyMap<string, string>): Promise<GoalView[]> {
  if (!goals.length) return [];
  const ids = goals.map((g) => g.id).join(",");
  const tasks = (await db.query<TaskRow>(`SELECT ${TASK_COLS} FROM atlas.exec_tasks WHERE exec_goal_id::text = ANY(string_to_array($1, ',')) ORDER BY created_at, plan_key`, [ids])).map(fixTask);
  const plans = await db.query<{ exec_goal_id: string; plan: unknown; problems: unknown }>(`SELECT DISTINCT ON (exec_goal_id) exec_goal_id, plan, problems FROM atlas.exec_plans WHERE exec_goal_id::text = ANY(string_to_array($1, ',')) ORDER BY exec_goal_id, created_at DESC`, [ids]);
  const arts = await db.query<{ exec_task_id: string; body: unknown; verification: unknown }>(
    `SELECT DISTINCT ON (exec_task_id) exec_task_id, body, verification FROM atlas.exec_artifacts WHERE exec_goal_id::text = ANY(string_to_array($1, ',')) ORDER BY exec_task_id, created_at DESC`,
    [ids],
  );
  const artBy = new Map(arts.map((a) => [a.exec_task_id, a]));
  return goals.map((g) => {
    const p = plans.find((x) => x.exec_goal_id === g.id);
    return {
      id: g.id,
      goalRecordId: g.goal_id,
      objective: g.objective,
      state: g.state,
      stateReason: g.state_reason,
      autonomy: g.autonomy as Autonomy,
      budgetUsd: g.budget_usd,
      spentUsd: g.spent_usd,
      createdAt: ts(g.created_at)!,
      updatedAt: ts(g.updated_at)!,
      completedAt: ts(g.completed_at),
      summary: g.summary,
      plan: p ? json<ExecutivePlan | null>(p.plan, null) : null,
      planProblems: p ? json<string[]>(p.problems, []) : [],
      tasks: tasks.filter((t) => t.exec_goal_id === g.id).map((t) => taskView(t, names, artBy.get(t.id))),
    };
  });
}

export async function overview(d: Deps, configured: ExecutiveOverview["configured"], names: ReadonlyMap<string, string> = new Map()): Promise<ExecutiveOverview> {
  const db = d.db;
  const goals = await db.query<GoalRow>(`SELECT ${GOAL_COLS} FROM atlas.exec_goals ORDER BY (state IN ('GOAL_COMPLETED', 'FAILED', 'CANCELLED')), updated_at DESC LIMIT 20`);
  const approvals = await db.query<{ id: string; goal_id: string | null; task_id: string | null; proposed_action: string; status: string; expires_at: unknown; created_at: unknown; payload: unknown }>(
    "SELECT id, goal_id, task_id, proposed_action, status, expires_at, created_at, payload FROM atlas.approvals WHERE requested_by = $1 ORDER BY created_at DESC LIMIT 20",
    [EXECUTIVE_AGENT_ID],
  );
  const events = await db.query<{ id: number | string; exec_goal_id: string; exec_task_id: string | null; kind: string; from_state: string | null; to_state: string | null; actor: string; detail: string | null; correlation_id: string | null; created_at: unknown }>(
    "SELECT id, exec_goal_id, exec_task_id, kind, from_state, to_state, actor, detail, correlation_id, created_at FROM atlas.exec_events ORDER BY id DESC LIMIT 60",
  );
  const [spend] = await db.query<{ usd: number }>("SELECT COALESCE(SUM(cost_usd), 0)::float8 AS usd FROM atlas.agent_runs WHERE idempotency_key LIKE 'exec:%' AND started_at > now() - interval '24 hours'");
  return {
    configured,
    emergencyStop: await d.stop().catch(() => "The emergency stop state couldn't be read."),
    goals: await goalViews(db, goals, names),
    approvals: approvals.map(
      (a): ApprovalView => ({
        id: a.id,
        goalId: a.goal_id,
        taskId: a.task_id,
        action: a.proposed_action,
        target: json<{ executive?: { binding?: { target?: string } } }>(a.payload, {}).executive?.binding?.target ?? "",
        status: a.status,
        expiresAt: ts(a.expires_at),
        createdAt: ts(a.created_at)!,
      }),
    ),
    events: events.map((e): EventView => ({ id: Number(e.id), goalId: e.exec_goal_id, taskId: e.exec_task_id, kind: e.kind, fromState: e.from_state, toState: e.to_state, actor: e.actor, detail: e.detail, correlationId: e.correlation_id, at: ts(e.created_at)! })),
    spend: { todayUsd: spend.usd, dispatchesToday: await dispatchesToday(db), dailyCap: RUN_LIMITS.dailyDispatchCap },
  };
}
