import { SIM_DAY_SECONDS, SIM_HOUR_SECONDS, type AgentJob } from "../../catalog/agentJobs";
import { along, commuterRoute, type CommuterRoute } from "./railCommuters";
import { ENTRANCE, type Pt3 } from "./roads";
import type { Scene3D } from "./scene";
import { buildStreetGraph, nearestStreet, streetLines, streetRoute, type StreetGraph } from "./streetGraph";

/**
 * Each AI agent's simulated workday on the map: it leaves its Circa apartment, walks the city's
 * streets to its workplace, arriving as its shift starts, stays inside until the shift ends, then
 * walks home the same way. Uses the rail commuters' route and walking maths, and draws in their
 * crowd mesh, so it adds no draw calls. Pure and deterministic: the same clock gives the same picture.
 */
export const AGENT_COMMUTE = {
  /** Walking pace in world units a second; long commutes walk faster so they fit in COMMUTE_HOURS. */
  pace: 0.45,
  /** Longest commute, in hours of the simulated day. */
  commuteHours: 3,
  /** Distance from the street's centre line: the edge of the right-hand lane, by the curb. */
  lane: 0.3,
  /** A workplace door farther than this from a street gets no route (and says so). */
  maxDoorToStreet: 3,
  /** The map opens at this hour of the simulated day, so the morning commute is under way. */
  openHour: 7.5,
} as const;

export interface AgentCommute {
  agentId: string;
  route: CommuterRoute;
  pace: number;
  lane: number;
  /** Seconds into the simulated day; leaveHome may be negative (the walk starts the evening before). */
  leaveHome: number;
  atWork: number;
  leaveWork: number;
  atHome: number;
}

export interface CommutePlan {
  commutes: AgentCommute[];
  /** Agents with a job but no walk on the map, and why. */
  skipped: { agentId: string; reason: string }[];
}

export type AgentWhere = "home" | "to-work" | "work" | "to-home";
export type AgentState = { where: "home" | "work"; visible: false } | { where: "to-work" | "to-home"; visible: true; x: number; y: number; z: number; yaw: number };

/** Doorways: the residence's own approach to its sidewalk, a headquarters' front steps, a skyline tenant's door. */
function homeDoor(scene: Scene3D, building: string): Pt3[] | undefined {
  const b = scene.financial?.buildings.find((x) => x.id === building && x.approach.length > 0);
  return b?.approach.map((p): Pt3 => [p[0], 0, p[1]]);
}
function workDoor(scene: Scene3D, job: AgentJob): Pt3 | undefined {
  if (job.work.kind === "headquarters") {
    const t = scene.towers.find((x) => x.projectId === job.work.projectId);
    return t && [t.x, 0, t.z + t.size / 2 + ENTRANCE / 2];
  }
  const shop = scene.retail.find((k) => k.name === job.work.building);
  return shop && [shop.x, 0, shop.z + shop.size / 2];
}

export function planAgentCommutes(scene: Scene3D, jobs: AgentJob[], graph: StreetGraph = buildStreetGraph(streetLines(scene))): CommutePlan {
  const commutes: AgentCommute[] = [], skipped: CommutePlan["skipped"] = [];
  jobs.forEach((job, i) => {
    const skip = (reason: string) => skipped.push({ agentId: job.agentId, reason });
    if (job.offDuty) return skip(`${job.offDuty}: stays home`);
    const home = homeDoor(scene, job.home.building), door = workDoor(scene, job);
    if (!home) return skip(`${job.home.building} is not on this map layout`);
    if (!door) return skip(`${job.work.label} is not on this map layout`);
    if (nearestStreet(graph, door).d > AGENT_COMMUTE.maxDoorToStreet) return skip(`no street reaches ${job.work.label} yet`);
    const streets = streetRoute(graph, home[home.length - 1], door);
    if (!streets) return skip(`no street route to ${job.work.label}`);
    const route = commuterRoute([...home, ...streets, door]);
    const pace = Math.max(AGENT_COMMUTE.pace, route.length / (AGENT_COMMUTE.commuteHours * SIM_HOUR_SECONDS));
    // Agents on the same shift and street set off a few minutes apart instead of in a clump.
    const early = (i % 4) * 0.2 * SIM_HOUR_SECONDS;
    const walk = route.length / pace, { start, end } = job.shift.value;
    commutes.push({
      agentId: job.agentId,
      route,
      pace,
      // Spread side by side a little, so agents on the same street don't walk in one file.
      lane: AGENT_COMMUTE.lane + ((i % 3) - 1) * 0.04,
      leaveHome: start * SIM_HOUR_SECONDS - walk - early,
      atWork: start * SIM_HOUR_SECONDS - early,
      leaveWork: end * SIM_HOUR_SECONDS + early,
      atHome: end * SIM_HOUR_SECONDS + early + walk,
    });
  });
  return { commutes, skipped };
}

/** Hour of the simulated day, 0 to 24, at a number of seconds since the map opened. */
export const simHour = (mapSeconds: number) => ((((mapSeconds / SIM_HOUR_SECONDS + AGENT_COMMUTE.openHour) % 24) + 24) % 24);

/** Where an agent is, at a number of seconds since the map opened: home, walking to work, at work, or walking home. */
export function agentAt(c: AgentCommute, mapSeconds: number): AgentState {
  const day = SIM_DAY_SECONDS, u = (((simHour(mapSeconds) * SIM_HOUR_SECONDS - c.leaveHome) % day) + day) % day;
  const walk = c.atWork - c.leaveHome, worked = c.leaveWork - c.leaveHome;
  if (u < walk) return { where: "to-work", visible: true, ...along(c.route, u * c.pace, c.lane) };
  if (u < worked) return { where: "work", visible: false };
  if (u < worked + walk) { const at = along(c.route, c.route.length - (u - worked) * c.pace, -c.lane); return { where: "to-home", visible: true, ...at, yaw: at.yaw + Math.PI }; }
  return { where: "home", visible: false };
}
