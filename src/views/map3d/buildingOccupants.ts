import type { AgentJob } from "../../catalog/agentJobs";
import type { Agent } from "../../catalog/types";
import { WORKSPACE } from "../../modules/workspace";
import { identityFor, type ResolvedIdentity } from "../../registry/identity";
import { financialKey } from "./financialPlan";

/**
 * Which agents belong at each building on the map, for the faces shown over a building's nameplate
 * when it is hovered or tapped (Map3D.tsx). Placement only, read from the same data the rest of the
 * map uses: an agent's workplace and apartment (agentJobs.ts) and the agents a landmark names in
 * workspace.yaml. It never says an agent is inside right now or that a run is happening.
 *
 * - Works here: AI agents whose job card puts them at this building (its project's headquarters or
 *   a declared workplace), and the agents a landmark lists as operating it.
 * - Lives here: AI agents whose apartment is in this building (Team Residence Towers, then Client
 *   Success Center once it is full). Off-duty agents hold no apartment, so they are not listed.
 * One face per persona: an agent shown under its owner or lead (automations, n8n skills) adds to
 * `others` instead of repeating that persona's face.
 */
export interface Occupant {
  personaId: string;
  identity: ResolvedIdentity;
}
export interface OccupantGroup {
  people: Occupant[];
  /** Agents counted here but shown under a persona already in `people`, or under another persona's face. */
  others: number;
}
export interface BuildingOccupants {
  works: OccupantGroup;
  lives: OccupantGroup;
}

/** The nameplate key (the map's selection key) for a building named by a job card. */
function workKey(job: AgentJob): string | null {
  if (job.work.kind === "headquarters") return `project:${job.work.projectId}`;
  const landmark = WORKSPACE.landmarks.find((l) => l.name === job.work.building);
  return landmark ? `service:${landmark.id}` : null;
}

const homeKey = (job: AgentJob): string | null => (job.home.unit ? financialKey(job.home.building) : null);

export function buildingOccupants(agents: readonly Agent[], jobs: readonly AgentJob[]): Map<string, BuildingOccupants> {
  const out = new Map<string, BuildingOccupants>();
  const seen = new Map<string, Set<string>>();
  const add = (key: string | null, role: keyof BuildingOccupants, agentId: string, ownOnly: boolean) => {
    if (!key) return;
    const identity = identityFor(agentId, agents);
    if (identity.retired) return;
    const entry = out.get(key) ?? { works: { people: [], others: 0 }, lives: { people: [], others: 0 } };
    out.set(key, entry);
    const group = entry[role];
    const tag = `${key}|${role}`;
    const ids = seen.get(tag) ?? new Set<string>();
    seen.set(tag, ids);
    // A helper living under its lead's face would show that lead in an apartment that is not theirs.
    if ((ownOnly && identity.kind !== "own" && identity.kind !== "none") || ids.has(identity.personaId)) {
      group.others++;
      return;
    }
    ids.add(identity.personaId);
    group.people.push({ personaId: identity.personaId, identity });
  };
  for (const job of jobs) {
    if (job.offDuty) continue;
    add(workKey(job), "works", job.agentId, false);
    add(homeKey(job), "lives", job.agentId, true);
  }
  for (const l of WORKSPACE.landmarks) for (const id of l.agents ?? []) if (agents.some((a) => a.id === id)) add(`service:${l.id}`, "works", id, false);
  // Faces first, then names: the people with portraits lead, in a stable order.
  const order = (a: Occupant, b: Occupant) => Number(!a.identity.portrait) - Number(!b.identity.portrait) || a.identity.name.localeCompare(b.identity.name);
  for (const e of out.values()) {
    e.works.people.sort(order);
    e.lives.people.sort(order);
  }
  return out;
}

/** Total agents at a building, faces and counted alike. */
export const occupantCount = (o: BuildingOccupants | undefined) => (o ? o.works.people.length + o.works.others + o.lives.people.length + o.lives.others : 0);
