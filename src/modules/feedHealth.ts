import type { Watch } from "../alerts/alerts";
import type { Health } from "../lib/derive";
import type { DataState } from "./operations";

/** A building's health from the live reports of the agents that operate it. */
export interface FeedHealth {
  health: Health;
  state: DataState;
  summary: string;
  /** The building's watched agents, in the alerts order (problems first). */
  watches: Watch[];
}

/**
 * Health of a building from its operating agents' reports to the live feed (their `alerts`
 * watches, the same states Mission Control shows). Green only while every one of them reported a
 * success within its `report_within` window; red when any latest report failed. Anything else
 * (silent, nothing reported yet, feed not read on this device, off on purpose) is not verified
 * and says why. CI never makes a building green here. Null when none of the agents is watched,
 * so the building keeps its other health line.
 */
export function feedHealth(agentIds: readonly string[], watches: readonly Watch[]): FeedHealth | null {
  const mine = watches.filter((w) => agentIds.includes(w.agent.id));
  if (!mine.length) return null;
  const names = (ws: Watch[]) => ws.map((w) => w.agent.name).join(", ");
  const failing = mine.filter((w) => w.state === "failing");
  if (failing.length) return { health: "bad", state: "ok", summary: `Failing · ${names(failing)}: ${failing[0].detail}`, watches: mine };
  if (mine.every((w) => w.state === "ok")) return { health: "good", state: "ok", summary: `Live · ${names(mine)} reporting on time`, watches: mine };
  const off = mine.find((w) => w.state === "silent") ?? mine.find((w) => w.state !== "ok")!;
  const state: DataState = off.state === "silent" ? "stale" : off.state === "no-source" ? "unavailable" : "none";
  return { health: "unknown", state, summary: `Not verified · ${off.agent.name}: ${off.detail}`, watches: mine };
}
