import type { AgentJob } from "../../catalog/agentJobs";
import { AGENT_RESIDENCE } from "../../catalog/agentJobs";
import type { CircaTower } from "./circaFloors";
import { unitStops } from "./circaNav";
import type { Stop } from "./walkNav";

/**
 * Who lives in Team Residence Towers (Ellipse Residences inside). Each resident is an AI agent whose home card
 * (agentJobs.ts) names this building, in the apartment the card names. Inside, each one is shown standing in its own
 * living room (Khaneil, 2026-11-19: "no loop just have them show"); its day already runs on the city map.
 * Placement is a visualization, not live activity.
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

/** Its living room, where it is shown inside. */
export const livingOf = (home: CircaHome): Stop => unitStops(home.layout).find((s) => s.id === "living")!;
