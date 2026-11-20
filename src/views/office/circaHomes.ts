import type { AgentJob } from "../../catalog/agentJobs";
import { AGENT_RESIDENCE } from "../../catalog/agentJobs";
import { activityText, isNight, segmentAt, type Routine } from "../../routine/routine";
import type { CircaTower } from "./circaFloors";
import { unitStops } from "./circaNav";
import type { Stop } from "./walkNav";

/**
 * Who lives in Team Residence Towers (Ellipse Residences inside). Each resident is an AI agent whose home card
 * (agentJobs.ts) names this building, in the apartment the card names. Each agent is in one place at a time: inside
 * its apartment only while its own day (the routine the city map walks, routine.ts) has it at home, and out on the
 * map otherwise, when its apartment label says where it is (Khaneil, 2026-11-20: "Fix the duplicate. There are agents
 * on the inside of the building and outside of the building as well"). Inside it simply stands, no loop (Khaneil,
 * 2026-11-19: "no loop just have them show"). Placement is a visualization, not live activity.
 */

export interface CircaHome {
  level: number;
  tower: CircaTower;
  unit: string;
  layout: "01" | "02" | "03";
}

export interface CircaResident {
  id: string;
  name: string;
  home: CircaHome;
}

/** The apartment a unit number names ("304" is Floor 3, East tower, the 2 bed); null for a unit not drawn inside. */
export function circaHome(unit: string): CircaHome | null {
  const m = /^(\d)0([1-6])$/.exec(unit);
  if (!m) return null;
  const floor = Number(m[1]), k = Number(m[2]);
  if (!(AGENT_RESIDENCE.floors as readonly number[]).includes(floor)) return null;
  const tower: CircaTower = k <= AGENT_RESIDENCE.unitsPerTower ? "west" : "east";
  const layout = `0${((k - 1) % AGENT_RESIDENCE.unitsPerTower) + 1}` as CircaHome["layout"];
  return { level: floor - 1, tower, unit, layout };
}

/** The agents who live here, each in the apartment its home card names. Agents housed elsewhere aren't residents. */
export function circaResidents(jobs: readonly AgentJob[], named: (id: string) => boolean = () => true): CircaResident[] {
  const out: CircaResident[] = [];
  for (const j of jobs) {
    if (j.home.building !== AGENT_RESIDENCE.id || !named(j.agentId)) continue;
    const home = circaHome(j.home.unit);
    if (home) out.push({ id: j.agentId, name: j.title, home });
  }
  return out;
}

/** Home or out, by the agent's own day. */
export type HomeState = { home: true; night: boolean; note: string } | { home: false; note: string };

/**
 * Whether the agent is home at `now`, by the same day the city map draws: home exactly when its day has it at its own
 * home spot, which is when the map hides it (routinePose.ts), so it is never drawn both inside and outside. With no
 * day worked out yet (the map hasn't planned one), the routine's own rule: home at night, out by day.
 */
export function homeStateAt(id: string, routine: Routine | undefined, now: number, tz: string): HomeState {
  const night = isNight(now, tz);
  if (routine) {
    const seg = segmentAt(routine, now);
    if (seg && seg.kind !== "walk" && seg.at === `home:${id}`) return { home: true, night: night && seg.activity === "at_home", note: seg.note };
    if (seg) return { home: false, note: seg.kind === "ride" ? seg.note : activityText(seg) };
  }
  return night ? { home: true, night: true, note: "At home for the night" } : { home: false, note: "Out for the day" };
}

/** Its bedroom (the main bedroom in a 2 bed), where it is at night. */
export const bedroomOf = (home: CircaHome): Stop => unitStops(home.layout).find((s) => s.id === (home.layout === "01" ? "master" : "bedroom"))!;
/** Its living room, where it is the rest of the time it is home. */
export const livingOf = (home: CircaHome): Stop => unitStops(home.layout).find((s) => s.id === "living")!;
