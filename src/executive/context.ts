import type { AgentAccess } from "../intelligence/memory";
import { retrieve, type RetrievalResult } from "../intelligence/retrieval";
import type { MemoryRecord } from "../intelligence/types";
import type { ExecutiveGoal } from "./types";

// Executive context from Phase 3 memory. Agent Operations Lead reads as itself, but only inside the
// goal's own project and plan workflow, plus global records, within a small token budget. Records
// scoped to other projects or other agents are dropped by the same rules every agent read uses.
// Retrieved text is data with its source; it never changes approvals or policy.

export const EXECUTIVE_BUDGET_TOKENS = 800;

export function executiveAccess(goal: Pick<ExecutiveGoal, "projectId" | "plan">): AgentAccess {
  return { agentId: "agent-operations-lead", known: true, project: goal.projectId || null, workflows: goal.plan ? [goal.plan.definition.id] : [], clearance: "internal" };
}

export function executiveContext(goal: ExecutiveGoal, records: readonly MemoryRecord[], now: number): RetrievalResult {
  return retrieve(records, executiveAccess(goal), { text: `${goal.objective} ${goal.constraints.join(" ")}`, budgetTokens: EXECUTIVE_BUDGET_TOKENS, limit: 5, categories: ["human_approved", "project_knowledge", "operational"] }, now);
}
