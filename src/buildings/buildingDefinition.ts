import type { Agent, Project } from "../catalog/types";
import { isAiAgent } from "../catalog/roles";
import { projectOfficeAgents } from "../catalog/workplaces";
import { planOffice } from "../views/office/model";
import { FIGURE_SCALE, RIG } from "../views/map3d/agentFigures";
import { passWidth } from "../views/map3d/agentBody";
import type { BuildingIdentity } from "../views/map3d/identity";
import { FLOOR_BASE, towerTop } from "../views/map3d/models";
import { ENTRANCE, type Pt3 } from "../views/map3d/roads";
import { TERRACE_H, type Tower } from "../views/map3d/scene";
import { SHELL, type Plate } from "./shellPlates";

/**
 * One definition per headquarters, shared by every view of it: the map's exterior, the Inside
 * cutaway, the agents walking in and sitting down, and the panels that list who works there.
 * Exterior and interior are two views of the same place, so both read their sizes from here:
 *
 * - the exterior: footprint, storeys and their heights, the lobby's front face and its door;
 * - the interior: each storey's clear floor plate (measured from the shell, shellPlates.ts), so an
 *   office floor is drawn inside the glass at the height of a real storey;
 * - desks: one per AI agent (the persona its city character stands for), laid out on its floor at the
 *   same scale as the character, so the person who walked in is the person sitting down;
 * - workflows: every automation in the building, listed at its owning agent's desk. An automation is
 *   work an agent does, not another person, so it never gets a seat or a character of its own.
 *
 * Pure: built from the map layout and the catalog, so it is tested without WebGL.
 */

/** World units per office unit inside a building: the seated person (head top 1.39 office units,
 *  InsideView deskParts) is drawn the same height as the agent's city character (RIG.top). The rig
 *  sits with its hips on the seat and its legs level, so seated its head is at RIG.top too: one scale
 *  fits the agent both standing and seated (agentBody.ts). */
export const OFFICE_SEATED_TOP = 1.39;
export const INTERIOR_K = (FIGURE_SCALE * RIG.top) / OFFICE_SEATED_TOP;
/** Office floor surface above the storey's base. */
export const FLOOR_SLAB = 0.03;
/**
 * The desk and chair (InsideView deskParts), office units from the desk's centre: the desk top is
 * 0.76 deep, the chair's seat (its top is where a seated agent's hips rest) and its back toward +z.
 */
export const OFFICE_FURNITURE = { deskHalfD: 0.38, seatZ: 0.66, seatTop: 0.495, backZ: 0.935 } as const;
/** The aisle behind a row of chairs: one agent's pass width (agentBody.ts), in office units. */
const AISLE = passWidth / INTERIOR_K;
/** A desk with its chair and the aisle behind it, in office units (desk 1.5 x 0.76, chair to 0.93). */
export const DESK_CELL = { w: 1.9, d: OFFICE_FURNITURE.backZ + AISLE + OFFICE_FURNITURE.deskHalfD } as const;
/** Clear space kept between desks and the shell's glass, world units. */
export const PLATE_MARGIN = 0.06;
/** Floors that hold desks: the same floors the building interior shows (1 to 4; 0 is the lobby). */
export const DESK_FLOORS = [4, 3, 2, 1] as const;
export const LOBBY_FLOOR = 0;
/** Where a desk's chair is, from the desk's centre (office units, toward the room's front). */
const SEAT_Z = OFFICE_FURNITURE.seatZ;
/** Sidewalk height (routinePlaces STREET_Y). */
const STREET_Y = TERRACE_H + 0.105;

export interface FloorPlate {
  /** World rectangle. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface BuildingFloor {
  index: number;
  label: string;
  /** Storey base, world height. */
  y: number;
  /** The office floor's surface (where people stand and chairs sit). */
  surface: number;
  plate: FloorPlate;
  /** Desk capacity at the characters' scale. */
  capacity: number;
  /** Agents with a desk on this floor. */
  agents: string[];
}

export interface DeskDefinition {
  /** Stable: building and agent ids. */
  id: string;
  agentId: string;
  floor: number;
  /** Desk centre, world. The monitor faces the back of the room (-z), the chair the street. */
  x: number;
  z: number;
  /** The chair, world, on the floor's surface. */
  seat: { x: number; y: number; z: number; yaw: number };
  /** Automations this agent runs, wherever their own project is. */
  workflows: string[];
}

export interface WorkflowDefinition {
  agentId: string;
  /** Its owning agent (manifest owned_by), or null when no agent owns it yet. */
  ownerId: string | null;
  /** Where the owner's desk is: this building, another one, or none. */
  ownerBuilding: string | null;
}

export interface BuildingDefinition {
  /** The map selection key, never changes: "project:<id>". */
  id: string;
  projectId: string;
  name: string;
  district: string | null;
  purpose: string;
  identity: BuildingIdentity;
  exterior: {
    x: number;
    z: number;
    size: number;
    /** Faces +z (toward its street): the map draws every headquarters this way round. */
    yaw: 0;
    base: number;
    top: number;
    storeys: number;
    storeyH: number;
  };
  /** Its door, on the lobby's front face, and the sidewalk in front of it. */
  entrance: { door: Pt3; outside: Pt3; facing: [number, number] };
  /** The lobby just inside the door, and the lift core every desk floor is reached from. */
  lobby: Pt3;
  core: { x: number; z: number };
  /** Lobby and desk floors, lobby first. */
  floors: BuildingFloor[];
  desks: DeskDefinition[];
  /** Automations of this project, with who runs them. */
  workflows: WorkflowDefinition[];
  /** Interior scale, world units per office unit. */
  k: number;
}

const FLOOR_LABEL = (n: number) => (n === LOBBY_FLOOR ? "Lobby" : `Floor ${n}`);

/** The characters: AI agents still working. Retired ones keep their name on past work only. */
export const hasDesk = (a: Agent) => isAiAgent(a) && a.status !== "retired" && a.registry?.classification?.type !== "F";

function plateOf(t: Tower, p: Plate | undefined): FloorPlate {
  // Standard towers (not custom-built) are square boxes: their plate is the footprint inside the walls.
  const [cx, cz, hw, hd] = p ?? [0, 0, 0.43, 0.43];
  const m = PLATE_MARGIN;
  return { x0: t.x + (cx - hw) * t.size + m, x1: t.x + (cx + hw) * t.size - m, z0: t.z + (cz - hd) * t.size + m, z1: t.z + (cz + hd) * t.size - m };
}

/** Desk grid that fits a plate: columns across, rows deep, at the interior scale. */
export function deskGrid(plate: FloorPlate, k = INTERIOR_K) {
  const cw = DESK_CELL.w * k, cd = DESK_CELL.d * k;
  const cols = Math.max(0, Math.floor((plate.x1 - plate.x0) / cw));
  const rows = Math.max(0, Math.floor((plate.z1 - plate.z0) / cd));
  return { cols, rows, cw, cd };
}

/** Desk centre of cell `i` on a plate, filling the front row (street side) first, centred. */
function cellCentre(plate: FloorPlate, i: number, used: number, k = INTERIOR_K) {
  const { cols, rows, cw, cd } = deskGrid(plate, k);
  const rowsUsed = Math.min(rows, Math.ceil(used / cols));
  const row = Math.floor(i / cols), inRow = Math.min(cols, used - row * cols), col = i % cols;
  const mx = (plate.x0 + plate.x1) / 2, mz = (plate.z0 + plate.z1) / 2;
  // The chair sits SEAT_Z behind the desk centre; centre the whole desk-and-chair cell.
  return { x: mx + (col - (inRow - 1) / 2) * cw, z: mz + (row - (rowsUsed - 1) / 2) * cd - SEAT_Z * k * 0.5 };
}

/**
 * Where the lift core goes: its usual place (centred, toward the front), or the nearest spot along the
 * floor, then at the back, where neither the lift doors nor the space an agent steps out into (one
 * pass width, agentBody.ts) overlap a desk or its chair on any floor.
 */
function liftSpot(shaft: FloorPlate, desks: readonly DeskDefinition[], k: number): { x: number; z: number } {
  const half = Math.max(0.9 * k, passWidth) / 2 + 0.03;
  const clashes = (x: number, z: number) =>
    desks.some((d) => Math.abs(d.x - x) < (DESK_CELL.w / 2) * k * 0.85 + half && z + passWidth > d.z - OFFICE_FURNITURE.deskHalfD * k && z - 0.03 < d.z + OFFICE_FURNITURE.backZ * k);
  const mx = (shaft.x0 + shaft.x1) / 2;
  const usual = Math.min(shaft.z1 - 0.05, (shaft.z0 + shaft.z1) / 2 + (shaft.z1 - shaft.z0) * 0.25);
  // Its usual depth first, then the back, then every depth from the back forward.
  const zs = [usual, shaft.z0 + 0.06, ...Array.from({ length: 9 }, (_, i) => shaft.z0 + 0.06 + ((shaft.z1 - passWidth - shaft.z0 - 0.06) * (i + 1)) / 10)];
  const reach = Math.max(0, (shaft.x1 - shaft.x0) / 2 - half);
  for (const z of zs)
    for (let step = 0; step <= 40; step++) {
      const dx = (Math.ceil(step / 2) * (step % 2 ? 1 : -1) * reach) / 20;
      if (!clashes(mx + dx, z)) return { x: mx + dx, z };
    }
  return { x: mx, z: zs[0] };
}

/**
 * Which floor each agent's desk is on: its declared `office_floor` when that floor has room, then the
 * agents' floor (4) and down, never the lobby. Within a building, in the office's own order (tier,
 * then dependencies), so an agent keeps its desk between reloads.
 */
function assignFloors(ids: string[], declared: Map<string, number | undefined>, capacity: Map<number, number>) {
  const left = new Map(capacity), out = new Map<string, number>();
  const take = (id: string, f: number) => {
    if ((left.get(f) ?? 0) <= 0) return false;
    left.set(f, left.get(f)! - 1);
    out.set(id, f);
    return true;
  };
  for (const id of ids) {
    const f = declared.get(id);
    if (f !== undefined) take(id, f);
  }
  for (const id of ids) if (!out.has(id)) DESK_FLOORS.some((f) => take(id, f));
  return out;
}

export function defineBuilding(t: Tower, project: Project, agents: readonly Agent[]): BuildingDefinition {
  const shell = SHELL[project.id];
  const top = towerTop(t);
  const storeyH = (top - FLOOR_BASE) / t.floors;
  const k = INTERIOR_K;
  const floorY = (n: number) => FLOOR_BASE + n * storeyH;
  const plates = new Map<number, FloorPlate>([LOBBY_FLOOR, ...DESK_FLOORS].map((n) => [n, plateOf(t, shell?.plates[n])]));
  const capacity = new Map<number, number>(DESK_FLOORS.map((n) => {
    const g = deskGrid(plates.get(n)!, k);
    // One cell of every floor is the lift and the space in front of it (liftSpot).
    return [n, Math.max(0, g.cols * g.rows - 1)];
  }));

  // Desks: the building's AI agents, in the office's own order.
  const office = projectOfficeAgents(agents as Agent[], project.id);
  const people = office.filter(hasDesk);
  const order = planOffice(project, people).workstations.map((w) => w.agentId);
  const floorOf = assignFloors(order, new Map(people.map((a) => [a.id, a.officeFloor])), capacity);
  const runs = (id: string) => agents.filter((a) => a.ownedBy === id && a.status !== "retired").map((a) => a.id);
  const desks: DeskDefinition[] = [];
  for (const n of DESK_FLOORS) {
    const here = order.filter((id) => floorOf.get(id) === n);
    here.forEach((agentId, i) => {
      const c = cellCentre(plates.get(n)!, i, here.length, k);
      const seat = { x: c.x, y: floorY(n) + FLOOR_SLAB, z: c.z + SEAT_Z * k, yaw: Math.PI };
      desks.push({ id: `${t.key}/${agentId}`, agentId, floor: n, x: c.x, z: c.z, seat, workflows: runs(agentId) });
    });
  }

  // The lift core: inside every plate from the lobby up to the highest desk floor.
  const used = [LOBBY_FLOOR, ...new Set(desks.map((d) => d.floor))];
  const shaft = used.map((n) => plates.get(n)!).reduce((a, b) => ({ x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) }));
  const core = liftSpot(shaft, desks, k);

  const front = t.z + (shell?.front ?? 0.5) * t.size;
  const lobbyPlate = plates.get(LOBBY_FLOOR)!;
  const doorX = Math.min(lobbyPlate.x1 - 0.05, Math.max(lobbyPlate.x0 + 0.05, t.x));
  const door: Pt3 = [doorX, FLOOR_BASE + FLOOR_SLAB, Math.min(front, lobbyPlate.z1 + PLATE_MARGIN)];
  const outside: Pt3 = [doorX, STREET_Y, Math.max(front, t.z + t.size / 2) + ENTRANCE / 2 + 0.05];
  const lobby: Pt3 = [doorX, FLOOR_BASE + FLOOR_SLAB, Math.max(lobbyPlate.z0, Math.min(lobbyPlate.z1, door[2] - 0.25))];

  const floors: BuildingFloor[] = [LOBBY_FLOOR, ...[...DESK_FLOORS].reverse()].map((n) => ({
    index: n,
    label: FLOOR_LABEL(n),
    y: floorY(n),
    surface: floorY(n) + FLOOR_SLAB,
    plate: plates.get(n)!,
    capacity: n === LOBBY_FLOOR ? 0 : capacity.get(n)!,
    agents: desks.filter((d) => d.floor === n).map((d) => d.agentId),
  }));

  const workflows: WorkflowDefinition[] = office
    .filter((a) => !isAiAgent(a) && a.status !== "retired")
    .map((a) => {
      const owner = a.ownedBy ? agents.find((x) => x.id === a.ownedBy) : undefined;
      return { agentId: a.id, ownerId: owner?.id ?? null, ownerBuilding: owner ? `project:${owner.projectId}` : null };
    });

  return {
    id: t.key,
    projectId: project.id,
    name: t.name,
    district: project.district ?? null,
    purpose: project.summary ?? "",
    identity: t.identity,
    exterior: { x: t.x, z: t.z, size: t.size, yaw: 0, base: FLOOR_BASE, top, storeys: t.floors, storeyH },
    entrance: { door, outside, facing: [0, 1] },
    lobby,
    core,
    floors,
    desks,
    workflows,
    k,
  };
}

/** Every headquarters on this map layout that has an office (any agent or automation). */
export function defineBuildings(towers: readonly Tower[], projects: readonly Project[], agents: readonly Agent[]): Map<string, BuildingDefinition> {
  const out = new Map<string, BuildingDefinition>();
  for (const t of towers) {
    const project = projects.find((p) => p.id === t.projectId);
    if (!project || !projectOfficeAgents(agents as Agent[], project.id).length) continue;
    out.set(t.key, defineBuilding(t, project, agents));
  }
  return out;
}

export function floorOf(def: BuildingDefinition, n: number): BuildingFloor | undefined {
  return def.floors.find((f) => f.index === n);
}

/** The floor the Inside view opens when nobody picked one: the highest floor with a desk. */
export function defaultFloor(def: BuildingDefinition): number {
  return def.desks.length ? Math.max(...def.desks.map((d) => d.floor)) : DESK_FLOORS[0];
}

/** Floors with at least one desk, top first (the floor picker). */
export function occupiedFloors(def: BuildingDefinition): number[] {
  return [...new Set(def.desks.map((d) => d.floor))].sort((a, b) => b - a);
}

/**
 * Which agents are at their desks now: a drawn position (agentFollow.agentPositions) within reach of
 * its own chair. Presentation only: it reads where the characters are, never a run.
 */
export function seatedNow(def: BuildingDefinition, positions: ReadonlyMap<string, readonly [number, number, number] | null>): DeskDefinition[] {
  return def.desks.filter((d) => {
    const p = positions.get(d.agentId);
    return !!p && Math.hypot(p[0] - d.seat.x, p[2] - d.seat.z) < DESK_CELL.d * def.k && Math.abs(p[1] - d.seat.y) < 0.6;
  });
}

/**
 * The building and floor the Inside button opens when nothing is selected: where the most agents are
 * at their desks now (ties go to the floor with more of them, then the busiest building's top floor);
 * with nobody seated, the building with the most desks.
 */
export function busiestOffice(defs: ReadonlyMap<string, BuildingDefinition>, positions: ReadonlyMap<string, readonly [number, number, number] | null>): { building: BuildingDefinition; floor: number; seated: number } | undefined {
  let best: { building: BuildingDefinition; floor: number; seated: number; desks: number } | undefined;
  for (const building of defs.values()) {
    if (!building.desks.length) continue;
    const seated = seatedNow(building, positions);
    const byFloor = new Map<number, number>();
    for (const d of seated) byFloor.set(d.floor, (byFloor.get(d.floor) ?? 0) + 1);
    const floor = [...byFloor.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? defaultFloor(building);
    const c = { building, floor, seated: seated.length, desks: building.desks.length };
    if (!best || c.seated > best.seated || (c.seated === best.seated && c.desks > best.desks)) best = c;
  }
  return best && { building: best.building, floor: best.floor, seated: best.seated };
}

export interface AgentLocation {
  building: BuildingDefinition;
  desk: DeskDefinition;
}

/** Where an agent works: its own desk, or the desk of the agent that runs it (an automation). */
export function locateAgent(defs: ReadonlyMap<string, BuildingDefinition>, agentId: string): AgentLocation | undefined {
  for (const building of defs.values()) {
    const desk = building.desks.find((d) => d.agentId === agentId || d.workflows.includes(agentId));
    if (desk) return { building, desk };
  }
  return undefined;
}

export type JourneyStop = "sidewalk" | "door" | "lobby" | "lift" | "floor" | "desk";
export interface JourneyPoint {
  stop: JourneyStop;
  p: Pt3;
  floor: number;
}

/**
 * The walk in, one point per step: sidewalk, door, lobby, lift on the ground floor, lift on the
 * agent's floor, the aisle behind its chair, then its chair. Walking out is the same in reverse.
 * Every point is inside the building's shell once past the door (buildingDefinition.test.ts).
 */
export function journeyTo(def: BuildingDefinition, agentId: string): JourneyPoint[] {
  const desk = def.desks.find((d) => d.agentId === agentId);
  if (!desk) return [];
  const f = floorOf(def, desk.floor)!;
  const ground = def.lobby[1];
  // Down the middle of the aisle behind the chairs: clear of the chair backs and the next row's desks.
  const aisle = Math.min(f.plate.z1 - 0.02, desk.seat.z + (OFFICE_FURNITURE.backZ - SEAT_Z + AISLE / 2) * def.k);
  return [
    { stop: "sidewalk", p: def.entrance.outside, floor: LOBBY_FLOOR },
    { stop: "door", p: def.entrance.door, floor: LOBBY_FLOOR },
    { stop: "lobby", p: def.lobby, floor: LOBBY_FLOOR },
    { stop: "lift", p: [def.core.x, ground, def.core.z], floor: LOBBY_FLOOR },
    { stop: "floor", p: [def.core.x, f.surface, def.core.z], floor: desk.floor },
    { stop: "floor", p: [desk.seat.x, f.surface, Math.max(def.core.z, aisle)], floor: desk.floor },
    { stop: "desk", p: [desk.seat.x, desk.seat.y, desk.seat.z], floor: desk.floor },
  ];
}

/** Floor of a point on an agent's journey, for hiding it while its floor is closed. */
export function journeyFloorAt(points: readonly JourneyPoint[], share: number): number {
  if (!points.length) return LOBBY_FLOOR;
  const i = Math.min(points.length - 1, Math.max(0, Math.floor(share * (points.length - 1))));
  return points[i].floor;
}

/** One set of definitions per map layout, shared by every view (the map, its panels, the characters). */
const cache = new WeakMap<readonly Tower[], { agents: readonly Agent[]; defs: Map<string, BuildingDefinition> }>();
export function buildingsOf(towers: readonly Tower[], projects: readonly Project[], agents: readonly Agent[]): Map<string, BuildingDefinition> {
  const hit = cache.get(towers);
  if (hit && hit.agents === agents) return hit.defs;
  const defs = defineBuildings(towers, projects, agents);
  cache.set(towers, { agents, defs });
  return defs;
}
