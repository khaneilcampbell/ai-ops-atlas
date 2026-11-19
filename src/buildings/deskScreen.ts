import type { AgentOps, OperationalState } from "../routine/operations";

/**
 * What a desk's monitor shows: the agent's operational state, from the same source as its card
 * (routine/operations.ts), never from where its character happens to be. Running, waiting for
 * approval, failed, cancelled and completed each keep their own colour; anything Atlas can't confirm
 * (no live source, nothing scheduled, a schedule not yet due) is a neutral screen, never progress.
 */
export type DeskScreen = "running" | "waiting_approval" | "failed" | "cancelled" | "succeeded" | "queued" | "neutral";

export const SCREEN_COLOR: Record<DeskScreen, string> = {
  running: "#6fcf7c",
  waiting_approval: "#e7b04a",
  failed: "#d0614f",
  cancelled: "#9a8fb0",
  succeeded: "#a9d8b4",
  queued: "#9fc3d6",
  neutral: "#3a4048",
};

export const SCREEN_LABEL: Record<DeskScreen, string> = {
  running: "Running",
  waiting_approval: "Waiting for approval",
  failed: "Failed",
  cancelled: "Cancelled",
  succeeded: "Completed",
  queued: "Queued",
  neutral: "No run in progress",
};

const FROM_STATE: Record<OperationalState, DeskScreen> = {
  running: "running",
  waiting_approval: "waiting_approval",
  failed: "failed",
  cancelled: "cancelled",
  succeeded: "succeeded",
  queued: "queued",
  scheduled: "neutral",
  idle: "neutral",
};

export function deskScreen(ops: AgentOps | undefined): DeskScreen {
  return ops ? FROM_STATE[ops.state] : "neutral";
}

/** A person is needed: a marker floats over the desk. */
export const needsPerson = (s: DeskScreen) => s === "waiting_approval" || s === "failed";
