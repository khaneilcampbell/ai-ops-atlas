import type { Agent, Project } from "../../catalog/types";
import { projectOfficeAgents } from "../../catalog/workplaces";
import { planOffice, type OfficePlan, type Workstation } from "../office/model";
import { FIGURE_SCALE, RIG } from "./agentFigures";
import { entranceDoor, FLOOR_BASE } from "./models";
import { FLOOR_H, TERRACE_H, type Scene3D, type Tower } from "./scene";

/**
 * One building, two views. The map's exterior and the Inside view's cutaway are both drawn from
 * this definition, and the agents' walk in (routinePose.ts) follows it, so the door they use, the
 * floor they ride to and the desk they sit at are the same everywhere:
 *
 * - identity: the tower key, project, name, district and purpose;
 * - exterior: footprint, the real street door (the one the map draws, models.tsx `entranceDoor`),
 *   storey height and roof;
 * - interior: a lobby on the ground floor behind that door, a lift core in the back corner on every
 *   floor, and the office floors each agent's catalog entry names (`office_floor`, else floor 4, as
 *   "Enter building" uses), desks in rows of three in the office plan's order (office/model.ts
 *   `planOffice`, `floorLayout` below);
 * - who sits where: every assigned agent's floor and desk.
 *
 * The interior is drawn at the same scale as the city's people (PERSON_K), so an agent keeps its
 * size from the sidewalk to its chair, and every floor plate fits inside the footprint with a
 * margin for its walls. Pure, so tests can check it without WebGL.
 */

/** Chair seat top in office units (InsideView's chair: 0.46 + half its 0.07 cushion). */
export const SEAT_TOP = 0.495;
/** Office units to world: the chair seat at a city figure's hip height. */
export const PERSON_K = (RIG.leg.h * FIGURE_SCALE) / SEAT_TOP;
/** Office units: desk spacing across and front to back, and seats per row (as office/model.ts). */
export const DESK_DX = 2.35, DESK_DZ = 2.5, PER_ROW = 3;
/** Office units: the chair stands this far in front of its desk's centre; you walk in this far behind it. */
export const CHAIR_Z = 0.66, BEHIND_CHAIR = 0.5;
/** Office units: the lift core's side, and the clear margin from the plate edge to it. */
export const CORE = 1.2, CORE_MARGIN = 0.35;
/** The plate fills this share of the footprint, leaving room for the walls (as inside.ts officeScale). */
const PLATE = 0.86;
/** The lowest office floor: level 0 is the lobby. */
export const FIRST_OFFICE_LEVEL = 1;

export type P3 = [number, number, number];

export interface BuildingDesk {
  agentId: string;
  /** Workstation id from the office plan (stable: project and agent). */
  wsId: string;
  level: number;
  /** 1-based number of the desk on its floor, front row first, left to right. */
  number: number;
  /** The workstation on its floor, in office units around the building's centre (InsideView draws it). */
  ws: Workstation;
  /** Where the agent sits: the chair, on the floor (world). */
  seat: P3;
  /** Facing the monitor. */
  yaw: number;
}

export interface BuildingFloor {
  level: number;
  /** World height of the floor surface. */
  y: number;
  /** Desks on this floor, in office units around the building's centre. */
  workstations: Workstation[];
}

export interface BuildingModel {
  key: string;
  projectId: string;
  name: string;
  district: string | null;
  purpose: string;
  accent: string;
  style: Tower["identity"]["style"];
  /** Footprint centre and side (square, facing the street at +z). */
  x: number;
  z: number;
  size: number;
  /** Storeys and their height on the exterior. */
  floors: number;
  floorH: number;
  /** Office units to world, for everything inside. */
  k: number;
  /** Side of the floor plate, world. */
  plate: number;
  door: {
    /** On the sidewalk, just in front of the door. */
    outside: P3;
    /** In the doorway, on the façade. */
    facade: P3;
    /** Just inside, in the lobby. */
    lobby: P3;
    width: number;
  };
  /** The lift core's centre (world x, z), the same on every floor, and its landing in front of it. */
  core: { x: number; z: number; landing: [number, number] };
  /** The office floors, lowest first. Every building has at least one. */
  officeFloors: BuildingFloor[];
  desks: Map<string, BuildingDesk>;
  plan: OfficePlan;
}

/** World height of a floor's surface (the Inside view's floor slab sits here). */
export const levelY = (level: number) => FLOOR_BASE + 0.03 + level * FLOOR_H;
/** World height of the sidewalk outside a door. */
const SIDEWALK_Y = TERRACE_H + 0.105;

/** The office floor an agent's desk is on when its catalog entry doesn't say (as "Enter building"). */
export const DEFAULT_OFFICE_FLOOR = 4;
/** Desks per office floor: two rows of three, which every headquarters' footprint holds at people's scale. */
export const FLOOR_DESKS = 6;

/**
 * Which floor each desk is on and where it stands there, in office units around the building's
 * centre: the floor from the agent's catalog entry (`office_floor`, else floor 4) while it has a
 * free desk (six a floor), else the nearest floor below with one; rows of three in the office
 * plan's order. Shared by the map's cutaway (buildingModel) and the "Enter building"
 * office (office/OfficeLayer.tsx), so both show the same desks in the same places.
 */
export function floorLayout(plan: Pick<OfficePlan, "workstations">, floorOf: (agentId: string) => number | undefined, maxLevel = DEFAULT_OFFICE_FLOOR): Map<number, Workstation[]> {
  const byLevel = new Map<number, Workstation[]>();
  for (const w of [...plan.workstations].sort((a, b) => a.slot - b.slot)) {
    const want = Math.max(FIRST_OFFICE_LEVEL, Math.min(maxLevel, floorOf(w.agentId) ?? DEFAULT_OFFICE_FLOOR));
    // Its own floor if there's a desk free, else the nearest floor below with one, then above.
    const order = [want, ...Array.from({ length: want - FIRST_OFFICE_LEVEL }, (_, i) => want - 1 - i), ...Array.from({ length: maxLevel - want }, (_, i) => want + 1 + i)];
    const level = order.find((l) => (byLevel.get(l)?.length ?? 0) < FLOOR_DESKS) ?? want;
    byLevel.set(level, [...(byLevel.get(level) ?? []), w]);
  }
  const out = new Map<number, Workstation[]>();
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const group = byLevel.get(level)!;
    const rows = Math.max(1, Math.ceil(group.length / PER_ROW));
    out.set(
      level,
      group.map((w, j) => {
        const row = Math.floor(j / PER_ROW), inRow = Math.min(PER_ROW, group.length - row * PER_ROW), col = j % PER_ROW;
        // Rows centred, nudged toward the street so the lift core in the back corner stays clear.
        return { ...w, x: (col - (inRow - 1) / 2) * DESK_DX, z: (row - (rows - 1) / 2) * DESK_DZ + 0.3, ry: 0 };
      }),
    );
  }
  return out;
}

/**
 * Lays out a project's building. `plan` is the office plan (its workstations decide the order and
 * the desk count); `floorOf` gives each agent's floor from the catalog. The result places those
 * desks on floors of this tower, at people's scale where the busiest floor fits.
 */
export function buildingModel(t: Tower, plan: OfficePlan, project?: Pick<Project, "summary" | "district">, floorOf: (agentId: string) => number | undefined = () => undefined): BuildingModel {
  const L = t.size * PLATE;
  const layout = floorLayout(plan, floorOf, Math.max(FIRST_OFFICE_LEVEL, Math.min(DEFAULT_OFFICE_FLOOR, t.floors - 1)));
  const busiest = Math.max(1, ...[...layout.values()].map((g) => g.length));
  const cols = Math.min(PER_ROW, busiest), rows = Math.ceil(busiest / PER_ROW);
  // People's scale, unless the busiest floor's rows wouldn't fit this footprint (with room for the lift and the aisle).
  const k = Math.min(PERSON_K, L / (cols * DESK_DX + 1.6), L / (rows * DESK_DZ + 3.4));
  const Lu = L / k;
  const floors: BuildingFloor[] = [];
  const desks = new Map<string, BuildingDesk>();
  const corePos = { x: Lu / 2 - CORE_MARGIN - CORE / 2, z: -(Lu / 2 - CORE_MARGIN - CORE / 2) };
  const world = (lx: number, lz: number): [number, number] => [t.x + lx * k, t.z + lz * k];
  for (const [level, ws] of layout) {
    const y = levelY(level);
    floors.push({ level, y, workstations: ws });
    ws.forEach((w, j) => {
      const [sx, sz] = world(w.x, w.z + CHAIR_Z);
      desks.set(w.agentId, { agentId: w.agentId, wsId: w.id, level, number: j + 1, ws: w, seat: [sx, y, sz], yaw: w.ry + Math.PI });
    });
  }
  if (!floors.length) floors.push({ level: DEFAULT_OFFICE_FLOOR, y: levelY(DEFAULT_OFFICE_FLOOR), workstations: [] });
  const d = entranceDoor(t);
  const [cx, cz] = world(corePos.x, corePos.z);
  const [lx, lz] = world(corePos.x - CORE / 2 - 0.45, corePos.z + CORE / 2 + 0.45);
  const g = levelY(0);
  return {
    key: t.key,
    projectId: t.projectId,
    name: t.name,
    district: project?.district ?? null,
    purpose: project?.summary ?? "",
    accent: t.identity.accent,
    style: t.identity.style,
    x: t.x,
    z: t.z,
    size: t.size,
    floors: t.floors,
    floorH: FLOOR_H,
    k,
    plate: L,
    door: {
      outside: [d.p[0], SIDEWALK_Y, d.p[2] + 0.3],
      facade: [d.p[0], g, d.p[2]],
      lobby: [d.p[0], g, Math.min(d.p[2] - 0.28, t.z + L / 2 - 0.1)],
      width: d.s[0],
    },
    core: { x: cx, z: cz, landing: [lx, lz] },
    officeFloors: floors,
    desks,
    plan,
  };
}

/** Every headquarters with an office: its building model, by tower key. */
export function buildingModels(scene: Scene3D, projects: readonly Project[], agents: readonly Agent[]): Map<string, BuildingModel> {
  const out = new Map<string, BuildingModel>();
  for (const t of scene.towers) {
    const project = projects.find((p) => p.id === t.projectId);
    if (!project) continue;
    const officeAgents = projectOfficeAgents(agents as Agent[], project.id);
    if (!officeAgents.length) continue;
    out.set(t.key, buildingModel(t, planOffice(project, officeAgents), project, (id) => officeAgents.find((a) => a.id === id)?.officeFloor));
  }
  return out;
}

/** The floor an agent's desk is on, or null when it has none in this building. */
export function floorOf(m: BuildingModel, agentId: string): number | null {
  return m.desks.get(agentId)?.level ?? null;
}

/** Floor name as people say it: the lobby, then "Floor 1", "Floor 2"... */
export const floorName = (level: number) => (level === 0 ? "Lobby" : `Floor ${level}`);

/**
 * The walk from the street to a desk, as points with their own heights: sidewalk, doorway, lobby,
 * the lift landing on the ground floor, up the lift core to the desk's floor, along the aisle
 * behind the chairs, and into the chair. `lift` is the index of the point where the ride up ends
 * (the ride is the segment before it). Pure geometry: the routine decides the timing.
 */
export function deskJourney(m: BuildingModel, agentId: string): { points: P3[]; lift: number } | null {
  const desk = m.desks.get(agentId);
  if (!desk) return null;
  const g = levelY(0), y = desk.seat[1];
  const [lx, lz] = m.core.landing;
  const k = m.k;
  // The aisle behind this desk's row, then along it to the chair.
  const behind = desk.seat[2] + BEHIND_CHAIR * k;
  const aisleX = m.x + (m.plate / 2 / k - CORE_MARGIN) * k - 0.02;
  const pts: P3[] = [m.door.outside, m.door.facade, m.door.lobby, [lx, g, lz], [m.core.x, g, m.core.z], [m.core.x, y, m.core.z], [lx, y, lz], [aisleX, y, Math.max(lz, behind)], [aisleX, y, behind], [desk.seat[0], y, behind], desk.seat];
  const clean = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) > 1e-4);
  const lift = clean.findIndex((p, i) => i > 0 && Math.abs(p[1] - clean[i - 1][1]) > 0.05 && Math.hypot(p[0] - clean[i - 1][0], p[2] - clean[i - 1][2]) < 1e-3);
  return { points: clean, lift };
}

/** Seconds-equivalent length of a journey leg: a lift ride counts slower than a walk of the same length. */
const legCost = (a: P3, b: P3) => {
  const flat = Math.hypot(b[0] - a[0], b[2] - a[2]);
  return flat < 1e-3 ? Math.abs(b[1] - a[1]) * 1.6 : Math.hypot(flat, b[1] - a[1]);
};

/** Where on a journey (0..1 of its total cost), its heading, and whether that's in the lift. */
export function alongJourney(points: P3[], f: number): { p: P3; yaw: number; riding: boolean } {
  const costs = points.slice(1).map((p, i) => legCost(points[i], p));
  const total = costs.reduce((a, b) => a + b, 0);
  let d = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < costs.length; i++) {
    const a = points[i], b = points[i + 1];
    if (d <= costs[i] || i === costs.length - 1) {
      const u = costs[i] > 0 ? Math.min(1, d / costs[i]) : 1;
      const flat = Math.hypot(b[0] - a[0], b[2] - a[2]);
      // In the lift: face out of its door, toward the landing.
      const yaw = flat < 1e-3 ? Math.atan2(-1, 1) : Math.atan2(b[0] - a[0], b[2] - a[2]);
      return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], yaw, riding: flat < 1e-3 };
    }
    d -= costs[i];
  }
  const last = points[points.length - 1];
  return { p: last, yaw: 0, riding: false };
}
