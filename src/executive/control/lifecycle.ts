import { TERMINAL_GOAL_STATES, TERMINAL_TASK_STATES, type GoalState, type TaskState } from "./types";

// Allowed state changes. The engine asks here before every write and refuses anything else, so a
// bug or a stray callback can't skip a step (for example, jump from PLAN_GENERATED to completed).

const SIDE: GoalState[] = ["PAUSED", "BLOCKED", "FAILED", "CANCELLED"];

const GOAL_NEXT: Record<GoalState, GoalState[]> = {
  GOAL_RECEIVED: ["GOAL_VALIDATED", ...SIDE],
  GOAL_VALIDATED: ["PLAN_GENERATED", ...SIDE],
  PLAN_GENERATED: ["PLAN_CHECKED", ...SIDE],
  PLAN_CHECKED: ["TASKS_CREATED", ...SIDE],
  TASKS_CREATED: ["AGENTS_ASSIGNED", ...SIDE],
  AGENTS_ASSIGNED: ["EXECUTION_AUTHORIZED", "AWAITING_APPROVAL", ...SIDE],
  AWAITING_APPROVAL: ["EXECUTION_AUTHORIZED", "EXECUTION_MONITORED", ...SIDE],
  EXECUTION_AUTHORIZED: ["EXECUTION_STARTED", ...SIDE],
  EXECUTION_STARTED: ["EXECUTION_MONITORED", ...SIDE],
  EXECUTION_MONITORED: ["RESULTS_VERIFIED", "AWAITING_APPROVAL", ...SIDE],
  RESULTS_VERIFIED: ["GOAL_COMPLETED", ...SIDE],
  // PAUSED and BLOCKED return to where the goal was; the engine passes that state explicitly.
  PAUSED: ["GOAL_RECEIVED", "GOAL_VALIDATED", "PLAN_GENERATED", "PLAN_CHECKED", "TASKS_CREATED", "AGENTS_ASSIGNED", "AWAITING_APPROVAL", "EXECUTION_AUTHORIZED", "EXECUTION_STARTED", "EXECUTION_MONITORED", "RESULTS_VERIFIED", "CANCELLED", "FAILED"],
  BLOCKED: ["TASKS_CREATED", "AGENTS_ASSIGNED", "EXECUTION_MONITORED", "PAUSED", "CANCELLED", "FAILED"],
  GOAL_COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canMoveGoal(from: GoalState, to: GoalState): boolean {
  return GOAL_NEXT[from]?.includes(to) ?? false;
}

export const isTerminalGoal = (s: GoalState) => TERMINAL_GOAL_STATES.has(s);

const TASK_NEXT: Record<TaskState, TaskState[]> = {
  pending: ["ready", "blocked", "awaiting_approval", "cancelled", "failed"],
  ready: ["dispatching", "blocked", "awaiting_approval", "cancelled", "failed"],
  blocked: ["pending", "ready", "cancelled", "failed"],
  awaiting_approval: ["pending", "ready", "failed", "cancelled"],
  // dispatching -> ready is a retry after a refused or unclear send.
  dispatching: ["running", "ready", "failed", "cancelled"],
  running: ["verifying", "ready", "failed", "cancelled"],
  // verifying -> ready is a retry after a failed check.
  verifying: ["completed", "ready", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canMoveTask(from: TaskState, to: TaskState): boolean {
  return TASK_NEXT[from]?.includes(to) ?? false;
}

export const isTerminalTask = (s: TaskState) => TERMINAL_TASK_STATES.has(s);

/** The Task Center status (atlas.tasks.status) that mirrors an executive task state. */
export function taskCenterStatus(s: TaskState): "queued" | "running" | "blocked" | "awaiting_approval" | "completed" | "failed" | "cancelled" {
  switch (s) {
    case "pending":
    case "ready":
      return "queued";
    case "dispatching":
    case "running":
    case "verifying":
      return "running";
    default:
      return s;
  }
}
