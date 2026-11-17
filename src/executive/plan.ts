import type { Catalog } from "../catalog/types";
import { stepPolicy } from "../execution/policy";
import { AGENT_GRANTS } from "../intelligence/capabilities";
import { routeModel, tierFromPolicy, type ModelRoute } from "../intelligence/routing";
import { stepProblem } from "../product/templates";
import type { Workspace } from "../product/workspace";
import { agentWorkflows } from "../tasks/registry";
import { definitionProblems, topoOrder, upstream } from "../workflows/graph";
import type { WorkflowDefinition, WorkflowNode } from "../workflows/types";
import { matchTemplate, templateById } from "./templates";
import type { ExecutiveGoal, ExecutivePlan, FailurePolicy, PlanStep } from "./types";

// Planning: deterministic templates first. An objective no template matches gets no plan; Atlas
// shows what the model router would cost so Khaneil can decide to ask for one, but never calls a
// model by itself. Every plan is validated against the Agent Registry before it can be accepted.

export type PlanResult =
  | { ok: true; plan: ExecutivePlan }
  | { ok: false; error: string; /** What a model-drafted plan would cost, for Khaneil to decide. */ route?: ModelRoute };

function failureFor(n: WorkflowNode): FailurePolicy {
  if (n.approval || n.kind === "decision") return "stop_and_ask";
  return n.kind === "agent" && n.execution.kind !== "manual" ? "retry_then_ask" : "stop_and_ask";
}

function completionFor(n: WorkflowNode): string {
  if (n.kind === "approval") return "Khaneil's approval is recorded on the task.";
  if (n.kind === "decision") return "Khaneil records the answer on the task.";
  return n.outputs.length ? `Delivered and linked on the task: ${n.outputs.join("; ")}.` : "Recorded as done on the task.";
}

export function planSteps(d: WorkflowDefinition): PlanStep[] {
  return d.nodes
    .filter((n) => n.kind !== "outcome")
    .map((n) => {
      const p = stepPolicy(n);
      const automated = n.kind === "agent" && n.execution.kind !== "manual" && n.execution.kind !== "none";
      return {
        nodeId: n.id,
        completion: completionFor(n),
        failure: failureFor(n),
        tier: tierFromPolicy(p.tier),
        capUsd: p.capUsd,
        estimate: automated ? `Atlas checks on it after ${Math.round(p.timeoutMs / 3_600_000)} h without a report` : "Not documented",
      };
    });
}

/** Builds a plan from a template (the matched one, or one Khaneil picked). Pure: nothing is saved. */
export function buildPlan(goal: Pick<ExecutiveGoal, "id" | "objective">, at: string, templateId?: string): PlanResult {
  const picked = templateId ? templateById(templateId) : undefined;
  if (templateId && !picked) return { ok: false, error: `No planning template called "${templateId}".` };
  const m = picked ? { template: picked, reason: `Picked by Khaneil: ${picked.name}.` } : matchTemplate(goal.objective);
  if (!m) {
    const route = routeModel({ taskType: "planning", complexity: "medium", estInputTokens: 2_000, estOutputTokens: 1_200 });
    return { ok: false, error: "No planning template matches this goal. Pick a template, or ask the model router for a draft plan yourself.", route };
  }
  const definition = m.template.build(goal.id);
  const steps = planSteps(definition);
  return { ok: true, plan: { templateId: m.template.id, definition, steps, maxSpendUsd: steps.reduce((n, s) => n + s.capUsd, 0), createdAt: at, reason: m.reason } };
}

export interface StepCheck {
  nodeId: string;
  title: string;
  agentId?: string;
  agentName?: string;
  /** Plain words for each check that failed. Empty = ready to delegate. */
  problems: string[];
  /** What the step can't do yet (manual, unconfigured, no grants), said plainly. */
  notes: string[];
  /** Steps at the same dependency depth: they can run in parallel. */
  parallelWith: string[];
}

export interface PlanValidation {
  ok: boolean;
  /** Structural and policy problems that block acceptance. */
  problems: string[];
  steps: StepCheck[];
  /** The plan's caps exceed Khaneil's budget. */
  budget: string | null;
  approvalGates: string[];
}

/**
 * Validates a plan before it may be accepted: graph structure, every agent is a registered and
 * available identity whose building is in Atlas, the workspace allows it, its execution adapter
 * exists in the registry, and every step has completion criteria. An unavailable agent blocks the
 * plan: it can't silently receive work.
 */
export function validatePlan(plan: ExecutivePlan, goal: Pick<ExecutiveGoal, "budgetUsd">, catalog: Catalog, workspace: Workspace | null = null): PlanValidation {
  const d = plan.definition;
  const problems = [...definitionProblems(d)];
  if (!d.nodes.some((n) => n.kind !== "outcome")) problems.push("The plan has no steps.");
  const stepIds = new Set(plan.steps.map((s) => s.nodeId));
  for (const n of d.nodes) if (n.kind !== "outcome" && !stepIds.has(n.id)) problems.push(`Step ${n.id} has no completion criteria.`);
  for (const s of plan.steps) if (!d.nodes.some((n) => n.id === s.nodeId)) problems.push(`Plan step ${s.nodeId} isn't in the workflow.`);
  const order = topoOrder(d) ?? [];
  const depth = new Map<string, number>();
  for (const id of order) depth.set(id, Math.max(0, ...upstream(d, id).map((u) => (depth.get(u) ?? 0) + 1)));

  const steps: StepCheck[] = d.nodes
    .filter((n) => n.kind !== "outcome")
    .map((n) => {
      const out: StepCheck = {
        nodeId: n.id,
        title: n.title,
        problems: [],
        notes: [],
        parallelWith: d.nodes.filter((o) => o.id !== n.id && o.kind !== "outcome" && depth.get(o.id) === depth.get(n.id)).map((o) => o.id),
      };
      if (n.agentId) {
        const a = catalog.agents.find((x) => x.id === n.agentId);
        out.agentId = n.agentId;
        out.agentName = a?.registry?.title ?? a?.name ?? n.agentId;
        if (!a) out.problems.push(`${n.agentId} isn't a registered agent.`);
        else {
          if (a.status === "retired") out.problems.push(`${out.agentName} is retired.`);
          if (a.status === "paused") out.problems.push(`${out.agentName} is paused, so it can't take work.`);
          if (!catalog.projects.some((p) => p.id === a.projectId)) out.problems.push(`${out.agentName}'s building isn't in Atlas.`);
          const blocked = stepProblem(n, workspace, catalog);
          if (blocked) out.problems.push(blocked);
          if (n.execution.kind === "n8n" || n.execution.kind === "github") {
            // Not a blocker: the step's task is still made, and the execution engine's adapter
            // decides at run time (unconfigured steps are done by hand, never faked).
            if (!agentWorkflows(a).some((w) => w.kind === n.execution.kind)) out.notes.push(`No ${n.execution.kind} workflow is linked to ${out.agentName} itself: ${n.execution.note}`);
          }
          if (!AGENT_GRANTS[n.agentId]) out.notes.push("No Atlas tool grants: it works through its own automations or a person.");
        }
      } else if (!n.buildingId || !catalog.projects.some((p) => p.id === n.buildingId)) out.problems.push(`Step ${n.id} names no Atlas building.`);
      if (n.execution.kind === "manual") out.notes.push("Done by a person and recorded in the Task Center.");
      if (n.unconfigured) out.notes.push(n.unconfigured);
      if (n.caveat) out.notes.push(n.caveat);
      return out;
    });
  for (const s of steps) for (const p of s.problems) problems.push(`${s.title}: ${p}`);
  const budget =
    goal.budgetUsd !== undefined && plan.maxSpendUsd > goal.budgetUsd
      ? `The plan's step caps add up to $${plan.maxSpendUsd.toFixed(2)}, over your $${goal.budgetUsd.toFixed(2)} budget. Atlas refuses to start steps once the budget is used.`
      : null;
  const approvalGates = d.nodes.filter((n) => n.approval).map((n) => `${n.title}: ${n.approval!.categories.join(", ")}`);
  return { ok: problems.length === 0, problems, steps, budget, approvalGates };
}
