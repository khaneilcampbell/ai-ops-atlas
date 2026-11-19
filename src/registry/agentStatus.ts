import type { Agent } from "../catalog/types";
import { runtimeFor, type RuntimeState } from "../views/office/model";
import type { TaskStatus } from "../tasks/types";
import type { Telemetry } from "./types";

// The five states shown next to an agent's identity, always from execution data: the runtime
// state (office/model.ts runtimeFor, built only from observed runs) or a task's lifecycle status.
// Stale, Off and Not connected stay visible: an agent Atlas can't hear from is never "Ready".

export type IdentityStatus = "ready" | "working" | "waiting" | "completed" | "failed" | "queued" | "cancelled" | "stale" | "off" | "unknown";

export const IDENTITY_STATUS_LABEL: Record<IdentityStatus, string> = {
  ready: "Ready",
  working: "Working",
  waiting: "Waiting for input",
  completed: "Completed",
  failed: "Failed",
  queued: "Queued",
  cancelled: "Cancelled",
  stale: "Stale",
  off: "Off",
  unknown: "Not connected",
};

/** An agent's status from its runtime state. Idle after observed runs is Ready. */
export function statusFromRuntime(state: RuntimeState): IdentityStatus {
  switch (state) {
    case "working":
      return "working";
    case "awaiting":
      return "waiting";
    case "failed":
      return "failed";
    case "idle":
      return "ready";
    case "stale":
      return "stale";
    case "offline":
      return "off";
    default:
      return "unknown";
  }
}

/** A task's status, for the agent it is assigned to. */
export function statusFromTask(status: TaskStatus): IdentityStatus {
  switch (status) {
    case "running":
      return "working";
    case "blocked":
    case "awaiting_approval":
      return "waiting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "queued";
  }
}

const ORDER: RuntimeState[] = ["working", "awaiting", "failed", "stale", "idle", "offline", "unknown"];

/**
 * An owning agent has no runs of its own: it acts through its automations. Its state is the most
 * urgent of theirs (working, then waiting, failed, stale, ready). It is Not connected only when
 * none of them reports, and Off only when all of them are off.
 */
export function rollupRuntime(states: RuntimeState[]): RuntimeState {
  if (!states.length) return "unknown";
  const live: RuntimeState[] = states.filter((s) => s !== "unknown" && s !== "offline");
  if (!live.length) return states.every((s) => s === "offline") ? "offline" : "unknown";
  return ORDER.find((s) => live.includes(s)) ?? "unknown";
}

/**
 * Status for every agent id from its telemetry. An agent with no live source of its own that owns
 * automations (catalog `owned_by`) takes the rollup of theirs, and says which one it came from.
 */
export function agentStatuses(agents: readonly Agent[], telemetry: ReadonlyMap<string, Telemetry>, now = Date.now()): Map<string, { status: IdentityStatus; from: string | null }> {
  const runtime = new Map<string, RuntimeState>();
  for (const a of agents) {
    const t = telemetry.get(a.id);
    runtime.set(a.id, t ? runtimeFor(a, t, undefined, 0, now).state : "unknown");
  }
  const owned = new Map<string, Agent[]>();
  for (const a of agents) if (a.ownedBy) owned.set(a.ownedBy, [...(owned.get(a.ownedBy) ?? []), a]);
  const out = new Map<string, { status: IdentityStatus; from: string | null }>();
  for (const a of agents) {
    const mine = runtime.get(a.id) ?? "unknown";
    const autos = owned.get(a.id) ?? [];
    if (mine === "unknown" && autos.length && a.status !== "retired" && a.status !== "paused") {
      const states = autos.map((x) => runtime.get(x.id) ?? "unknown");
      const rolled = rollupRuntime(states);
      const from = rolled === "unknown" || rolled === "offline" ? null : (autos[states.indexOf(rolled)]?.name ?? null);
      out.set(a.id, { status: statusFromRuntime(rolled), from });
    } else out.set(a.id, { status: statusFromRuntime(mine), from: null });
  }
  return out;
}
