import { isAiAgent } from "./roles";
import type { Agent, Catalog } from "./types";
import type { Operational } from "../registry/types";

// An agent owns a goal; the automations it owns are the fixed steps it runs to reach it. The link
// is the automation's manifest `owned_by` field and is never inferred: an automation without one is
// an orphan, listed so Khaneil can give it an owner or retire it.

export interface Ownership {
  /** Owned automations per AI agent id, in catalog order. Agents that own nothing are absent. */
  owned: Map<string, Agent[]>;
  /** Automations in use (not retired) with no owning agent, in catalog order. */
  orphans: Agent[];
}

export function ownership(catalog: Pick<Catalog, "agents">): Ownership {
  const agentIds = new Set(catalog.agents.filter(isAiAgent).map((a) => a.id));
  const owned = new Map<string, Agent[]>();
  const orphans: Agent[] = [];
  for (const a of catalog.agents) {
    if (isAiAgent(a) || a.status === "retired") continue;
    if (a.ownedBy && agentIds.has(a.ownedBy)) owned.set(a.ownedBy, [...(owned.get(a.ownedBy) ?? []), a]);
    else orphans.push(a);
  }
  return { owned, orphans };
}

/** Worst first. Anything short of verified keeps the group short of verified: one unverified step
 *  means nobody has seen the whole group work. */
const SEVERITY: Operational[] = ["failing", "unknown", "configured", "planned", "verified"];

/** One health state for an agent and its automations: the worst of the group. */
export function rollupHealth(states: Operational[]): Operational {
  if (!states.length) return "unknown";
  return SEVERITY.find((s) => states.includes(s)) ?? "unknown";
}
