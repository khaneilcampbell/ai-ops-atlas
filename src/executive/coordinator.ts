import type { Catalog } from "../catalog/types";
import { spend } from "../execution/policy";
import type { Workspace } from "../product/workspace";
import { newId } from "../tasks/lifecycle";
import type { TaskService } from "../tasks/store";
import { SENSITIVE_CATEGORIES, TASK_PRIORITIES, type Actor, type SensitiveCategory, type StoredTask, type TaskPriority } from "../tasks/types";
import { liveStatus } from "../workflows/engine";
import { startLiveRun, type RunStore } from "../workflows/runs";
import type { Goal, NodeStatus, WorkflowRun } from "../workflows/types";
import type { ModelRoute } from "../intelligence/routing";
import { authorizeAction } from "./autonomy";
import { buildPlan, validatePlan, type PlanValidation } from "./plan";
import { matchTemplate } from "./templates";
import type { AutonomyLevel, ExecutiveGoal, ExecutivePlan, GoalState } from "./types";

// The coordination layer Agent Operations Lead runs: goal intake, planning, plan approval,
// delegation through the existing Task Center (startLiveRun), and status read back from the tasks.
// It owns no execution. Every write here is Khaneil's; an agent or workflow is refused.

export type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface GoalInput {
  objective: string;
  projectId?: string;
  priority?: TaskPriority;
  deadline?: string;
  successCriteria?: string[];
  constraints?: string[];
  budgetUsd?: number;
  requiredApprovals?: SensitiveCategory[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (xs: readonly string[] | undefined) => (xs ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 12);
const personOnly = (actor: Actor, what: string): string | null => (actor.kind === "person" ? null : `${actor.name} can't ${what}: only Khaneil can.`);

function checkInput(i: GoalInput, catalog: Catalog): string | null {
  const objective = i.objective.trim();
  if (!objective) return "Write the objective.";
  if (objective.length > 500) return "Keep the objective under 500 characters.";
  if (i.projectId && !catalog.projects.some((p) => p.id === i.projectId)) return "That project isn't in Atlas.";
  if (i.priority && !TASK_PRIORITIES.includes(i.priority)) return "Unknown priority.";
  if (i.deadline && (!DATE.test(i.deadline) || Number.isNaN(Date.parse(i.deadline)))) return "Use a deadline like 2026-12-01, or leave it empty.";
  if (i.budgetUsd !== undefined && (!Number.isFinite(i.budgetUsd) || i.budgetUsd < 0)) return "The budget must be a positive number of dollars, or empty.";
  if ((i.requiredApprovals ?? []).some((c) => !SENSITIVE_CATEGORIES.includes(c))) return "Unknown approval category.";
  return null;
}

const businessOf = (catalog: Catalog, projectId: string) => catalog.projects.find((x) => x.id === projectId)?.organization ?? "";

/** A new goal from Khaneil's words. Deadline and budget only when he gave them. */
export function draftGoal(i: GoalInput, actor: Actor, at: string, catalog: Catalog, autonomy: AutonomyLevel): Ok<{ goal: ExecutiveGoal }> {
  const refused = personOnly(actor, "set a goal");
  if (refused) return { ok: false, error: refused };
  const bad = checkInput(i, catalog);
  if (bad) return { ok: false, error: bad };
  const id = newId("goal");
  const matched = matchTemplate(i.objective);
  const projectId = i.projectId ?? matched?.template.projectId ?? "";
  return {
    ok: true,
    goal: {
      id,
      objective: i.objective.trim(),
      projectId,
      business: businessOf(catalog, projectId),
      priority: i.priority ?? "medium",
      ...(i.deadline ? { deadline: i.deadline } : {}),
      successCriteria: i.successCriteria?.length ? clean(i.successCriteria) : (matched?.template.criteria ?? []),
      constraints: clean(i.constraints),
      ...(i.budgetUsd !== undefined ? { budgetUsd: i.budgetUsd } : {}),
      requiredApprovals: [...new Set(i.requiredApprovals ?? [])],
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      state: "draft",
      autonomy,
      runIds: [],
      edits: [],
      rev: 0,
    },
  };
}

const EDITABLE: ReadonlySet<GoalState> = new Set(["draft", "planned", "approved"]);

/** Manual edits before execution. Editing a planned goal sends its plan back for review. */
export function editGoal(g: ExecutiveGoal, patch: Partial<GoalInput>, actor: Actor, at: string, catalog: Catalog): Ok<{ goal: ExecutiveGoal }> {
  const refused = personOnly(actor, "edit a goal");
  if (refused) return { ok: false, error: refused };
  if (!EDITABLE.has(g.state)) return { ok: false, error: "A goal can only be edited before its plan starts." };
  const merged: GoalInput = { objective: g.objective, projectId: g.projectId || undefined, priority: g.priority, deadline: g.deadline, successCriteria: g.successCriteria, constraints: g.constraints, budgetUsd: g.budgetUsd, requiredApprovals: g.requiredApprovals, ...patch };
  const bad = checkInput(merged, catalog);
  if (bad) return { ok: false, error: bad };
  const fields = Object.keys(patch);
  const next: ExecutiveGoal = {
    ...g,
    objective: merged.objective.trim(),
    projectId: merged.projectId ?? "",
    business: businessOf(catalog, merged.projectId ?? ""),
    priority: merged.priority ?? "medium",
    deadline: merged.deadline || undefined,
    successCriteria: clean(merged.successCriteria),
    constraints: clean(merged.constraints),
    budgetUsd: merged.budgetUsd,
    requiredApprovals: [...new Set(merged.requiredApprovals ?? [])],
    updatedAt: at,
    edits: [...g.edits, { at, actor, fields }].slice(-50),
  };
  if (g.state === "approved" || g.state === "planned") {
    next.state = next.plan ? "planned" : "draft";
    delete next.planApprovedAt;
    delete next.planApprovedBy;
  }
  return { ok: true, goal: next };
}

/** Drafts the plan (deterministic template). Level 0 never drafts plans. */
export function planGoal(g: ExecutiveGoal, actor: Actor, at: string, templateId?: string): { ok: true; goal: ExecutiveGoal } | { ok: false; error: string; route?: ModelRoute } {
  const refused = personOnly(actor, "plan a goal");
  if (refused) return { ok: false, error: refused };
  if (!EDITABLE.has(g.state)) return { ok: false, error: "This goal's plan has already started." };
  const d = authorizeAction(g.autonomy, { kind: "draft_plan", resource: g.id, environment: "atlas", risk: "low", categories: [], actor });
  if (!d.allowed) return { ok: false, error: d.reason };
  const r = buildPlan(g, at, templateId);
  if (!r.ok) return { ok: false, error: r.error, ...(r.route ? { route: r.route } : {}) };
  return { ok: true, goal: { ...g, plan: r.plan, state: "planned", updatedAt: at, planApprovedAt: undefined, planApprovedBy: undefined } };
}

/** Khaneil approves the plan. Refused while the plan is invalid. */
export function approvePlan(g: ExecutiveGoal, actor: Actor, at: string, catalog: Catalog, workspace: Workspace | null): Ok<{ goal: ExecutiveGoal; validation: PlanValidation }> {
  const refused = personOnly(actor, "approve a plan");
  if (refused) return { ok: false, error: refused };
  if (g.state !== "planned" || !g.plan) return { ok: false, error: "There's no plan waiting for review." };
  const validation = validatePlan(g.plan, g, catalog, workspace);
  if (!validation.ok) return { ok: false, error: `The plan can't be approved: ${validation.problems[0]}` };
  return { ok: true, goal: { ...g, state: "approved", planApprovedAt: at, planApprovedBy: actor, updatedAt: at }, validation };
}

/** The Workflow Intelligence goal for an executive goal's plan (same ids, so runs link back). */
export function workflowGoal(g: ExecutiveGoal & { plan: ExecutivePlan }): Goal {
  return { id: g.id, name: g.objective.length > 80 ? `${g.objective.slice(0, 77)}...` : g.objective, objective: g.objective, expectedOutcome: g.successCriteria.join("; ") || "Not documented", definitionId: g.plan.definition.id };
}

/**
 * Delegates the approved plan: one Task Center task per step, with the step's registry agent,
 * dependencies and approval gates (startLiveRun). Re-validates first, checks the autonomy level and
 * budget, and never executes anything: steps start from the Task Center as usual.
 */
export function delegate(g: ExecutiveGoal, deps: { svc: TaskService; runs: RunStore; catalog: Catalog; workspace: Workspace | null; tasks: readonly StoredTask[] }, actor: Actor, at: string): Ok<{ goal: ExecutiveGoal; run: WorkflowRun; warning: string | null }> {
  if (!g.plan || (g.state !== "approved" && g.state !== "running")) return { ok: false, error: "Approve the plan first." };
  const d = authorizeAction(g.autonomy, { kind: "create_tasks", resource: g.id, environment: "atlas", risk: "low", categories: [], actor, planApproved: !!g.planApprovedAt });
  if (!d.allowed) return { ok: false, error: d.reason };
  const v = validatePlan(g.plan, g, deps.catalog, deps.workspace);
  if (!v.ok) return { ok: false, error: `The plan no longer validates: ${v.problems[0]}` };
  const b = goalBudget(g, deps.tasks, deps.runs.list());
  if (b.exceeded) return { ok: false, error: `The goal's $${g.budgetUsd!.toFixed(2)} budget is used ($${b.usedUsd.toFixed(2)} reported).` };
  const plan = g.plan;
  const r = startLiveRun(workflowGoal({ ...g, plan }), plan.definition, deps.svc, deps.runs, deps.catalog, actor, at);
  if (!r.run) return { ok: false, error: r.error ?? "The run couldn't start." };
  return { ok: true, goal: { ...g, state: "running", runIds: [...g.runIds, r.run.id], updatedAt: at }, run: r.run, warning: r.error };
}

export interface GoalBudget {
  usedUsd: number;
  estimated: boolean;
  limitUsd: number | null;
  exceeded: boolean;
  /** 80% of the budget or more. */
  warning: boolean;
}

/** Reported model spend on the goal's tasks (never estimated by another model call). */
export function goalBudget(g: ExecutiveGoal, tasks: readonly StoredTask[], runs: readonly WorkflowRun[]): GoalBudget {
  const ids = new Set(runs.filter((r) => g.runIds.includes(r.id)).flatMap((r) => Object.values(r.nodeTasks)));
  let used = 0;
  let estimated = false;
  for (const t of tasks) {
    if (!ids.has(t.id)) continue;
    const s = spend(t);
    used += s.billedUsd + s.estimatedUsd;
    if (s.estimatedUsd > 0) estimated = true;
  }
  const limit = g.budgetUsd ?? null;
  return { usedUsd: used, estimated, limitUsd: limit, exceeded: limit !== null && used >= limit, warning: limit !== null && limit > 0 && used >= limit * 0.8 };
}

export interface GoalStatus {
  done: number;
  total: number;
  /** 0..1 share of the latest run's countable steps completed, or null before delegation. */
  progress: number | null;
  agents: { id: string; name: string; status: NodeStatus }[];
  nextMilestone: string | null;
  /** Every countable step finished or was skipped: work done, outcome still for Khaneil to judge. */
  workFinished: boolean;
  status: ReadonlyMap<string, NodeStatus>;
  run: WorkflowRun | null;
}

const FINISHED: ReadonlySet<NodeStatus> = new Set(["completed", "skipped", "cancelled"]);

/** Status read straight from the Task Center through the latest linked run. */
export function goalStatus(g: ExecutiveGoal, runs: readonly WorkflowRun[], tasks: ReadonlyMap<string, StoredTask>, catalog: Catalog): GoalStatus {
  const run = [...runs].reverse().find((r) => g.runIds.includes(r.id)) ?? null;
  const empty: GoalStatus = { done: 0, total: 0, progress: null, agents: [], nextMilestone: g.plan ? (g.state === "planned" ? "Review the plan" : g.state === "approved" ? "Start the plan" : null) : g.state === "draft" ? "Draft a plan" : null, workFinished: false, status: new Map(), run: null };
  if (!run) return empty;
  const status = liveStatus(run.snapshot, run, tasks);
  const steps = run.snapshot.nodes.filter((n) => n.kind !== "outcome" && status.get(n.id) !== "skipped");
  const done = steps.filter((n) => status.get(n.id) === "completed").length;
  const nameOf = (id: string) => {
    const a = catalog.agents.find((x) => x.id === id);
    return a?.registry?.title ?? a?.name ?? id;
  };
  const agents = steps.filter((n) => n.agentId).map((n) => ({ id: n.agentId!, name: nameOf(n.agentId!), status: status.get(n.id) ?? "not_started" }));
  const next = steps.find((n) => !FINISHED.has(status.get(n.id) ?? "not_started"));
  return {
    done,
    total: steps.length,
    progress: steps.length ? done / steps.length : null,
    agents,
    nextMilestone: next ? next.title : null,
    workFinished: steps.length > 0 && steps.every((n) => FINISHED.has(status.get(n.id) ?? "not_started")),
    status,
    run,
  };
}

/** Moves a running goal to review once its work finished. Atlas never confirms an outcome itself. */
export function syncGoal(g: ExecutiveGoal, s: GoalStatus, at: string): ExecutiveGoal | null {
  if (g.state === "running" && s.workFinished) return { ...g, state: "review", updatedAt: at };
  if (g.state === "review" && s.run && !s.workFinished) return { ...g, state: "running", updatedAt: at };
  return null;
}

/** Khaneil's verdict on the outcome, with a note. Only after the work finished. */
export function reviewOutcome(g: ExecutiveGoal, achieved: boolean, note: string, actor: Actor, at: string): Ok<{ goal: ExecutiveGoal }> {
  const refused = personOnly(actor, "judge an outcome");
  if (refused) return { ok: false, error: refused };
  if (g.state !== "review") return { ok: false, error: "The goal's work hasn't finished yet." };
  if (!note.trim()) return { ok: false, error: "Add a short note on what was achieved (or not)." };
  return { ok: true, goal: { ...g, state: achieved ? "completed" : "not_achieved", outcomeNote: note.trim().slice(0, 1000), updatedAt: at } };
}

export function cancelGoal(g: ExecutiveGoal, actor: Actor, at: string): Ok<{ goal: ExecutiveGoal }> {
  const refused = personOnly(actor, "cancel a goal");
  if (refused) return { ok: false, error: refused };
  if (g.state === "completed" || g.state === "not_achieved" || g.state === "cancelled") return { ok: false, error: "This goal is already closed." };
  return { ok: true, goal: { ...g, state: "cancelled", updatedAt: at } };
}

/** Workflow Intelligence goals and definitions for every executive goal with a plan. */
export function executiveWorkflows(goals: readonly ExecutiveGoal[]): { goals: Goal[]; definitions: Record<string, ExecutivePlan["definition"]> } {
  const withPlan = goals.filter((g): g is ExecutiveGoal & { plan: ExecutivePlan } => !!g.plan && g.state !== "cancelled");
  return { goals: withPlan.map(workflowGoal), definitions: Object.fromEntries(withPlan.map((g) => [g.plan.definition.id, g.plan.definition])) };
}
