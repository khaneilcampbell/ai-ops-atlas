import type { Actor, SensitiveCategory, TaskPriority } from "../tasks/types";
import type { WorkflowDefinition } from "../workflows/types";

// Executive goal coordination (Phase 8): the data model. A goal is Khaneil's objective in his own
// words plus the facts he supplies (nothing is invented: no deadline or budget unless he gives one).
// Its plan is an ordinary Workflow Intelligence definition, so an accepted plan runs through the
// existing Task Center, execution engine and Output Studio. This layer keeps no task state.

export const AUTONOMY_LEVELS = [0, 1, 2, 3] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_INFO: Record<AutonomyLevel, { name: string; description: string }> = {
  0: { name: "Level 0 · Observe", description: "Atlas reads records and writes summaries. No plans, no tasks, no outside changes." },
  1: { name: "Level 1 · Recommend", description: "Atlas drafts plans and recommendations. Nothing runs until Khaneil starts it." },
  2: { name: "Level 2 · Supervised execute", description: "Low-risk steps of a plan Khaneil approved may start. Sensitive steps still need their own approval." },
  3: { name: "Level 3 · Policy-bounded", description: "Allowlisted read-only routines (health checks, freshness checks, approved reports) may run within daily limits." },
};

/** Default unless Khaneil changes it. Never raised by an agent or a stored note. */
export const DEFAULT_AUTONOMY: AutonomyLevel = 1;

export type GoalState = "draft" | "planned" | "approved" | "running" | "review" | "completed" | "not_achieved" | "cancelled";

export const GOAL_STATE_LABEL: Record<GoalState, string> = {
  draft: "Draft",
  planned: "Plan ready for review",
  approved: "Plan approved",
  running: "In progress",
  review: "Work done, awaiting your review",
  completed: "Outcome confirmed",
  not_achieved: "Outcome not achieved",
  cancelled: "Cancelled",
};

/** What happens when a step fails. Retries are bounded by the Task Center's max attempts. */
export type FailurePolicy = "stop_and_ask" | "retry_then_ask" | "continue_other_branches";

export interface PlanStep {
  nodeId: string;
  /** What "done" means for this step, checked by a person in the Task Center. */
  completion: string;
  failure: FailurePolicy;
  /** Model tier and cap from the execution policy (stepPolicy). 0 = no model. */
  tier: 0 | 1 | 2;
  capUsd: number;
  /** Plain words when Atlas can say; "Not documented" otherwise (never guessed). */
  estimate: string;
}

export interface ExecutivePlan {
  /** Which deterministic template produced it, or "manual" when Khaneil built it from one by hand. */
  templateId: string;
  /** The workflow definition: nodes are registry agents, edges are dependencies. */
  definition: WorkflowDefinition;
  steps: PlanStep[];
  /** Sum of step caps: the most this plan may spend on models. */
  maxSpendUsd: number;
  createdAt: string;
  /** Why the template matched, in plain words. */
  reason: string;
}

export interface GoalEdit {
  at: string;
  actor: Actor;
  fields: string[];
}

export interface ExecutiveGoal {
  id: string;
  objective: string;
  /** Catalog project id (building) the goal belongs to, or "" for none. */
  projectId: string;
  /** Business name shown with it (from the catalog's organization), or "". */
  business: string;
  priority: TaskPriority;
  /** Only when Khaneil gave one (YYYY-MM-DD). */
  deadline?: string;
  successCriteria: string[];
  constraints: string[];
  /** Only when Khaneil gave one, in USD. */
  budgetUsd?: number;
  /** Sensitive categories Khaneil says this goal will need approval for (plans add their own gates too). */
  requiredApprovals: SensitiveCategory[];
  createdAt: string;
  createdBy: Actor;
  updatedAt: string;
  state: GoalState;
  /** The autonomy level this goal runs under (defaults to the owner setting when created). */
  autonomy: AutonomyLevel;
  plan?: ExecutivePlan;
  planApprovedAt?: string;
  planApprovedBy?: Actor;
  /** Workflow runs started for this goal (Workflow Intelligence run ids). */
  runIds: string[];
  /** Khaneil's closing note when he reviews the outcome. */
  outcomeNote?: string;
  edits: GoalEdit[];
  rev: number;
}

export interface ExecutiveFile {
  version: 1;
  rev: number;
  /** Owner setting. Only a person changes it. */
  autonomy: AutonomyLevel;
  goals: ExecutiveGoal[];
  /** Level 3 routine runs per day, for the daily limit: "YYYY-MM-DD:routineId" -> count. */
  routineRuns: Record<string, number>;
  /** Append-only, ids and short text only (never payloads or secrets). Bounded. */
  audit: { at: string; actor: string; action: string; goalId?: string; detail?: string }[];
}
