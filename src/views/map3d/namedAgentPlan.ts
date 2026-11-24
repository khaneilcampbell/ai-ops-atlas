import type { AgentJob } from "../../catalog/agentJobs";
import type { Agent } from "../../catalog/types";
import { cityFigureFor, type CityFigure } from "../../registry/cityFigures";
import { identityFor, type ResolvedIdentity } from "../../registry/identity";
import { agentAt, landmarkDoor, type AgentCommute, type CommutePlan } from "./agentCommutes";
import { ENTRANCE } from "./roads";
import { TERRACE_H, type Scene3D } from "./scene";

/**
 * Where each named agent stands in the city (NamedAgents.tsx). One character per identity: the
 * persona's own agent, never its automations or skills, which show the same persona in lists.
 *
 * - Its spot is in front of its real workplace (agentJobs: its project's headquarters, or a declared
 *   workplace such as the Marketing Agency), side by side with the others who work there.
 * - An agent with a commute (agentCommutes.ts, from its workday or saved presence schedule) walks it
 *   and stands at its spot while at work; at home it is not drawn.
 * - An agent that works only through its automations keeps to its building: it stands at its spot.
 * Nothing here says a run is happening: activity comes only from tasks and verified telemetry.
 */
export interface NamedAgent {
  personaId: string;
  identity: ResolvedIdentity;
  figure: CityFigure;
  /** The building it works in, as the map names it. */
  workLabel: string;
  spot: { x: number; y: number; z: number; yaw: number };
  commute?: AgentCommute;
}

export interface NamedAgentPlan {
  agents: NamedAgent[];
  /** Identities with no character on this map layout, and why. */
  skipped: { personaId: string; reason: string }[];
}

/** Side-by-side spacing and distance from the door, in map units. */
export const SPOT = { spacing: 0.42, out: 0.5, sidewalk: 0.105, plaza: 0.03 } as const;

type Door = { x: number; z: number; out: [number, number]; y: number };

function doorOf(scene: Scene3D, job: AgentJob): Door | undefined {
  if (job.work.kind === "headquarters") {
    const t = scene.towers.find((x) => x.projectId === job.work.projectId);
    return t && { x: t.x, z: t.z + t.size / 2 + ENTRANCE / 2, out: [0, 1], y: TERRACE_H + SPOT.sidewalk };
  }
  // A Financial District landmark that lists the agent (workspace.yaml): its own front path.
  if (job.work.kind === "landmark") {
    const p = landmarkDoor(scene, job.work.building);
    return p && { x: p[0], z: p[1], out: [0, 1], y: TERRACE_H + SPOT.sidewalk };
  }
  // The Marketing Agency's entrance under the copper sweep, facing away from the building.
  if (scene.agency && job.work.building === "Benjaire Marketing Agency") {
    const a = scene.agency, dx = a.entry[0] - a.cx, dz = a.entry[1] - a.cz, l = Math.hypot(dx, dz) || 1;
    return { x: a.entry[0], z: a.entry[1], out: [dx / l, dz / l], y: TERRACE_H + SPOT.plaza };
  }
  return undefined;
}

/** Plan one character per identity, from the agents' jobs and commutes. Pure and deterministic. */
export function planNamedAgents(scene: Scene3D, agents: readonly Agent[], jobs: readonly AgentJob[], commutes?: CommutePlan): NamedAgentPlan {
  const out: NamedAgent[] = [], skipped: NamedAgentPlan["skipped"] = [];
  const byDoor = new Map<string, { door: Door; items: Omit<NamedAgent, "spot">[] }>();
  for (const a of agents) {
    if (!a.registry?.identity) continue;
    const identity = identityFor(a.id, agents);
    // Retired personas keep their name on past work but no longer walk the city.
    if (identity.kind !== "own" || identity.retired) continue;
    const figure = cityFigureFor(a.id);
    if (!figure) {
      skipped.push({ personaId: a.id, reason: "no city figure yet: its avatar shows in lists" });
      continue;
    }
    const job = jobs.find((j) => j.agentId === a.id);
    if (!job) {
      skipped.push({ personaId: a.id, reason: "no workplace in Atlas" });
      continue;
    }
    const door = doorOf(scene, job);
    if (!door) {
      skipped.push({ personaId: a.id, reason: `${job.work.label} is not on this map layout` });
      continue;
    }
    const key = `${door.x.toFixed(2)},${door.z.toFixed(2)}`;
    const group = byDoor.get(key) ?? { door, items: [] };
    byDoor.set(key, group);
    const commute = commutes?.commutes.find((c) => c.agentId === a.id);
    group.items.push({ personaId: a.id, identity, figure, workLabel: job.work.label.replace(/, floor .*$/, "").replace(/ headquarters$/, ""), ...(commute ? { commute } : {}) });
  }
  for (const { door, items } of byDoor.values()) {
    const [ox, oz] = door.out, side: [number, number] = [oz, -ox], n = items.length;
    items.forEach((item, k) => {
      const lateral = (k - (n - 1) / 2) * SPOT.spacing;
      // A shallow arc: the ends of the row stand a little closer to the door, turned toward the middle.
      const ahead = SPOT.out - Math.abs(lateral) * 0.18;
      const x = door.x + ox * ahead + side[0] * lateral, z = door.z + oz * ahead + side[1] * lateral;
      const yaw = Math.atan2(ox, oz) - Math.sign(lateral) * Math.min(0.5, Math.abs(lateral) * 0.6);
      out.push({ ...item, spot: { x, y: door.y, z, yaw } });
    });
  }
  return { agents: out, skipped };
}

export type NamedState = { where: "work" | "walking"; x: number; y: number; z: number; yaw: number } | { where: "home" };

/** Where a named agent is now: walking its commute, standing at its workplace, or at home (not drawn). */
export function namedAgentAt(a: NamedAgent, mapSeconds: number, now = new Date()): NamedState {
  if (!a.commute) return { where: "work", ...a.spot };
  const s = agentAt(a.commute, mapSeconds, now);
  if (s.visible) return { where: "walking", x: s.x, y: TERRACE_H + 0.105 + s.y, z: s.z, yaw: s.yaw };
  return s.where === "work" ? { where: "work", ...a.spot } : { where: "home" };
}
