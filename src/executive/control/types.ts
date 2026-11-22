// Atlas Executive (server-side control plane): the shared data model. These types are used by the
// site's orchestration code (server/executive/), the tests and the Mission Control panel, so the
// browser and the server agree on one shape. Nothing here holds a secret.
//
// The Executive is a registered catalog agent (atlas-executive in catalog/ai-ops-atlas.yaml). It
// plans with fixed templates (no model), picks a registered agent with plain rules, hands work to n8n
// through one signed webhook, and only counts a task done after Atlas's own checks pass on the
// returned output. Every state change is a row in PostgreSQL (db/migrations/0002_executive.sql).

export const EXECUTIVE_AGENT_ID = "atlas-executive";

/** The goal lifecycle the directive asks for, plus the side states. */
export const GOAL_STATES = [
  "GOAL_RECEIVED",
  "GOAL_VALIDATED",
  "PLAN_GENERATED",
  "PLAN_CHECKED",
  "TASKS_CREATED",
  "AGENTS_ASSIGNED",
  "EXECUTION_AUTHORIZED",
  "EXECUTION_STARTED",
  "EXECUTION_MONITORED",
  "RESULTS_VERIFIED",
  "GOAL_COMPLETED",
  "AWAITING_APPROVAL",
  "PAUSED",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
] as const;
export type GoalState = (typeof GOAL_STATES)[number];

export const GOAL_STATE_LABEL: Record<GoalState, string> = {
  GOAL_RECEIVED: "Received",
  GOAL_VALIDATED: "Goal checked",
  PLAN_GENERATED: "Plan drafted",
  PLAN_CHECKED: "Plan checked",
  TASKS_CREATED: "Tasks created",
  AGENTS_ASSIGNED: "Agents assigned",
  EXECUTION_AUTHORIZED: "Authorized",
  EXECUTION_STARTED: "Started",
  EXECUTION_MONITORED: "Running",
  RESULTS_VERIFIED: "Results verified",
  GOAL_COMPLETED: "Completed",
  AWAITING_APPROVAL: "Waiting for your approval",
  PAUSED: "Paused",
  BLOCKED: "Blocked",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const TERMINAL_GOAL_STATES: ReadonlySet<GoalState> = new Set(["GOAL_COMPLETED", "FAILED", "CANCELLED"]);

export const TASK_STATES = ["pending", "ready", "blocked", "awaiting_approval", "dispatching", "running", "verifying", "completed", "failed", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set(["completed", "failed", "cancelled"]);

/**
 * Autonomy levels, enforced in code before anything runs (server/executive/engine.ts), never by a
 * prompt. A goal runs at one level; each action has a level; the action runs on its own only when
 * the goal's level is at least the action's and the action is not level 4.
 */
export const AUTONOMY = [1, 2, 3, 4] as const;
export type Autonomy = (typeof AUTONOMY)[number];
export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  1: "Level 1 · Observe",
  2: "Level 2 · Safe execution",
  3: "Level 3 · Conditional execution",
  4: "Level 4 · Owner approval required",
};
export const AUTONOMY_NOTE: Record<Autonomy, string> = {
  1: "Read, analyse and report only.",
  2: "Plans, research, drafts and tests may run on their own within the goal's budget.",
  3: "Allowlisted actions inside fixed limits may also run.",
  4: "Spending, publishing, deploying, deleting, merging, credential or sensitive changes and outside messages: always waits for Khaneil.",
};
/** The Executive's default (Khaneil's directive, 2026-11-22). */
export const DEFAULT_AUTONOMY: Autonomy = 2;

/** One step of a plan. Plans are data, validated by plan.ts before any task exists. */
export interface PlanTask {
  /** Stable key inside the plan (lowercase, dashes). */
  key: string;
  title: string;
  /** A capability id from src/intelligence/capabilities.ts. */
  capability: string;
  /** Keys of tasks that must complete first. */
  dependsOn: string[];
  /** What "done" means, checked by Atlas's code, never by a model's word. */
  acceptance: string[];
  /** Highest cost this task may run up, in USD. */
  maxCostUsd: number;
  /** The task's inputs (data only). */
  inputs: Record<string, string>;
}

export interface ExecutivePlan {
  schema: "atlas-executive-plan/1";
  /** Which template produced it. */
  template: string;
  deliverables: string[];
  acceptance: string[];
  tasks: PlanTask[];
  /** Sum of task caps. */
  estimatedCostUsd: number;
  risk: "low" | "medium" | "high";
}

/** Hard limits for every plan, whoever drafts it. */
export const PLAN_LIMITS = {
  maxTasks: 8,
  maxDepth: 4,
  maxDependencies: 4,
  maxTaskCostUsd: 2,
  maxPlanCostUsd: 5,
  maxObjectiveChars: 500,
  maxAttempts: 3,
  /** Never more than this many goals in flight at once. */
  maxActiveGoals: 5,
} as const;

/** Run limits the engine enforces on every dispatch. */
export const RUN_LIMITS = {
  /** Tasks one agent may have dispatched or running at once. */
  perAgentConcurrency: 1,
  /** Dispatches across all goals in 24 hours. */
  dailyDispatchCap: 10,
  /** Dispatches one scheduled tick may start. */
  perTickDispatch: 3,
  /** A goal's default and highest budget at level 2, USD. Above it a spend approval is needed. */
  defaultBudgetUsd: 1,
  autoSpendCeilingUsd: 1,
  maxBudgetUsd: 5,
} as const;

/** The report the research workflow must return (schema opportunity-report/1). */
export const REPORT_SECTIONS = ["targetCustomerProblem", "proposedSolution", "competitorOverview", "marketEvidence", "technicalFeasibility", "businessRisks", "recommendedNextStep"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const REPORT_SECTION_LABEL: Record<ReportSection, string> = {
  targetCustomerProblem: "Target customer problem",
  proposedSolution: "Proposed solution",
  competitorOverview: "Competitor overview",
  marketEvidence: "Market evidence",
  technicalFeasibility: "Technical feasibility",
  businessRisks: "Business risks",
  recommendedNextStep: "Recommended next step",
};

export interface ReportSource {
  /** Short id the sections cite, like "S1". */
  id: string;
  title: string;
  url: string;
}

export interface OpportunityReport {
  schema: "opportunity-report/1";
  productName: string;
  sections: Record<ReportSection, { text: string; sources: string[] }>;
  sources: ReportSource[];
}

export interface Verification {
  passed: boolean;
  checkedAt: string;
  checks: { name: string; passed: boolean; detail?: string }[];
}

/** What the Mission Control panel reads (GET /api/executive/overview). */
export interface ExecutiveOverview {
  configured: { database: boolean; n8n: boolean; schedule: boolean };
  emergencyStop: string | null;
  goals: GoalView[];
  approvals: ApprovalView[];
  events: EventView[];
  spend: { todayUsd: number; dispatchesToday: number; dailyCap: number };
}

export interface GoalView {
  id: string;
  goalRecordId: string | null;
  objective: string;
  state: GoalState;
  stateReason: string | null;
  autonomy: Autonomy;
  budgetUsd: number;
  spentUsd: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  summary: string | null;
  plan: ExecutivePlan | null;
  planProblems: string[];
  tasks: TaskView[];
}

export interface TaskView {
  id: string;
  key: string;
  title: string;
  taskRecordId: string | null;
  capability: string;
  agentId: string | null;
  agentName: string | null;
  workflow: string | null;
  state: TaskState;
  actionLevel: Autonomy;
  dependsOn: string[];
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
  externalExecutionId: string | null;
  blockedReason: string | null;
  error: string | null;
  costUsd: number;
  dispatchedAt: string | null;
  finishedAt: string | null;
  artifact: { report: OpportunityReport | null; verification: Verification | null } | null;
}

export interface ApprovalView {
  id: string;
  goalId: string | null;
  taskId: string | null;
  action: string;
  target: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface EventView {
  id: number;
  goalId: string;
  taskId: string | null;
  kind: string;
  fromState: string | null;
  toState: string | null;
  actor: string;
  detail: string | null;
  correlationId: string | null;
  at: string;
}
