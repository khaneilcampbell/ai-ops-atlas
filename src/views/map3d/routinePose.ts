import { runWorking, walkShare, type Segment } from "../../routine/routine";
import { RIG } from "./agentFigures";
import { along } from "./railCommuters";
import { openFloor } from "../../buildings/insideFloors";
import type { Pt3 } from "./roads";
import { riderPoint, type CityPlaces, type CityRoutes } from "./routinePlaces";

/**
 * Where and how one agent is drawn at a moment, from its routine segment (routine/routine.ts).
 * Pure, so the tests can check every kind of segment without a renderer.
 *
 * - walking: along its street route, striding;
 * - standing at a spot: at its own place in the row there (no two agents on one point);
 * - inside a building with no cutaway (home, the arena, the terminal, its office with Inside off):
 *   no figure, and the badge waits above the door, so you can still find and pick it;
 * - at its desk with the office open in the Inside view: walks in from the door, sits at its own
 *   desk, types while the run is working;
 * - on a ride: seated in its wheel cabin, aboard the yacht's deck, in a train carriage (badge only).
 */
export interface DrawnPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Draw the body (false inside a building, a train carriage or the terminal). */
  figure: boolean;
  /** Where the portrait badge floats; null hides the agent entirely (at home). */
  badge: [number, number, number] | null;
  sit: number;
  typing: boolean;
  walking: boolean;
  /** World units per figure unit inside an office (its own scale); null for the city scale. */
  officeScale: number | null;
  /** Where it is, in words ("Atlas Command Center", "The Ferris wheel"). */
  place: string;
}

export interface PoseContext {
  routes: CityRoutes;
  places: CityPlaces;
  personaId: string;
  /** Its own number in the team (0..): a unique place in the rows at shared spots, and its walking lane. */
  slot: number;
  /** Headquarters open in the Inside view (tower keys). */
  open: ReadonlySet<string>;
  wall: number;
  yacht?: { x: number; z: number; yaw: number };
  /** City figure scale for this agent (FIGURE_SCALE times its height). */
  scale: number;
}

const BADGE_LIFT = 0.075;
/** Office units: the seated person's thigh height in the Inside view (InsideView deskParts). */
const OFFICE_SEAT = 0.58;

/** Column (-2..2) and row (0..) of a team member's place at a shared spot: no two share one. */
const place5 = (slot: number) => ({ col: (slot % 5) - 2, row: Math.floor(slot / 5) });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A point a share of the way along a path of straight legs, facing along its leg (a lift ride keeps the last heading). */
export function alongPath(path: readonly Pt3[], share: number): { x: number; y: number; z: number; yaw: number } {
  const legs = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1], p[2] - path[i][2]));
  const total = legs.reduce((a, b) => a + b, 0);
  let left = clamp01(share) * total, yaw = 0;
  for (let i = 0; i < legs.length; i++) {
    const a = path[i], b = path[i + 1];
    if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 1e-6) yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
    if (left <= legs[i] || i === legs.length - 1) {
      const t = legs[i] > 0 ? Math.min(1, left / legs[i]) : 1;
      return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), z: lerp(a[2], b[2], t), yaw };
    }
    left -= legs[i];
  }
  const p = path[path.length - 1] ?? [0, 0, 0];
  return { x: p[0], y: p[1], z: p[2], yaw };
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function routinePose(seg: Segment, c: PoseContext): DrawnPose | null {
  const mine = c.places.agents.get(c.personaId);
  if (!mine) return null;
  const at = (x: number, y: number, z: number, yaw: number, rest: Partial<DrawnPose> & { place: string }): DrawnPose => {
    const s = rest.officeScale ?? c.scale;
    const badge: [number, number, number] | null = rest.badge === undefined ? [x, y + RIG.top * s + BADGE_LIFT, z] : rest.badge;
    return { x, y, z, yaw, figure: true, sit: 0, typing: false, walking: false, officeScale: null, ...rest, badge };
  };

  if (seg.kind === "walk") {
    const r = c.routes.route(seg.from, seg.to);
    const target = c.places.spots.get(seg.to);
    const f = walkShare(seg, c.wall);
    if (!r) {
      const p = target?.path[target.path.length - 1];
      if (!p) return null;
      return at(p[0], p[1], p[2], target!.yaw, { place: target!.label });
    }
    const q = along(r, r.length * f, place5(c.slot).col * 0.035);
    return at(q.x, q.y, q.z, q.yaw, { walking: c.wall < seg.t1, place: `On the way to ${target?.label ?? "the next place"}` });
  }

  if (seg.kind === "inside") {
    const desk = mine.desk;
    const door = mine.office.path[0];
    const hidden = (): DrawnPose => ({ x: door[0], y: door[1], z: door[2], yaw: mine.office.yaw, figure: false, badge: mine.doorBadge, sit: 0, typing: false, walking: false, officeScale: null, place: mine.officeLabel });
    // Inside with its office closed: its badge shows on the facade at its floor.
    if (!desk || !c.open.has(desk.towerKey)) return hidden();
    // One building, one open floor (buildings/insideFloors.ts). Anyone above it would stand in the
    // part of the shell that is cut away, so they wait as a badge; anyone below is behind its walls.
    const open = openFloor(desk.towerKey, desk.defaultFloor);
    const openY = desk.surfaces[open] ?? desk.y;
    // Inside, the character keeps its own size and look (buildingDefinition INTERIOR_K matches it).
    const k = c.scale;
    const f = clamp01((c.wall - seg.t0) / Math.max(1, seg.t1 - seg.t0));
    const walk = (path: readonly Pt3[], share: number): DrawnPose => {
      const q = alongPath(path, share);
      if (q.y > openY + 0.02) return hidden();
      return at(q.x, q.y, q.z, q.yaw, { walking: true, officeScale: k, place: mine.officeLabel });
    };
    const inAndUp = [...desk.entry, ...desk.route.slice(1)];
    switch (seg.phase) {
      case "entering":
        return walk(desk.entry, f);
      case "to_desk":
        return walk(desk.route, f);
      case "leaving":
        // Back from its chair to the lift, down, through the lobby and out of the door, in one walk.
        return walk([...inAndUp].reverse(), f);
      default: {
        if (desk.floor !== open) return hidden();
        // Seated: hips on the chair, facing the monitor.
        const y = desk.y + OFFICE_SEAT * desk.k - RIG.leg.h * k;
        return at(desk.x, y, desk.z, desk.yaw, { sit: 1, typing: runWorking(seg), officeScale: k, place: `At its desk in ${mine.officeLabel}` });
      }
    }
  }

  const spot = c.places.spots.get(seg.at);
  if (!spot) return null;
  const stand = spot.path[spot.path.length - 1];

  if (seg.kind === "ride") {
    const kind = seg.option.kind;
    if (kind === "flight") return { x: stand[0], y: stand[1], z: stand[2], yaw: spot.yaw, figure: false, badge: [stand[0], stand[1] + 0.55, stand[2]], sit: 0, typing: false, walking: false, officeScale: null, place: "On a simulated flight" };
    const p = riderPoint(c.places, kind, c.personaId, c.wall, c.yacht);
    if (!p) return at(stand[0], stand[1], stand[2], spot.yaw, { place: spot.label });
    if (kind === "wheel") return at(p[0], p[1], p[2], 0, { sit: 1, place: `${spot.label}, ${seg.times.seat ?? "a cabin"}` });
    if (kind === "train") return { x: p[0], y: p[1], z: p[2], yaw: 0, figure: false, badge: [p[0], p[1] + 0.35, p[2]], sit: 1, typing: false, walking: false, officeScale: null, place: `On the train, ${seg.times.seat ?? "a carriage"}` };
    // The yacht: on her aft deck wherever she is (never on the water).
    const yaw = c.yacht?.yaw ?? spot.yaw;
    const back = place5(c.slot).col * 0.08;
    return at(p[0] - Math.cos(yaw) * (0.35 + back), p[1], p[2] + Math.sin(yaw) * (0.35 + back), yaw, { place: "Aboard the Atlas yacht" });
  }

  // Standing or sitting at a spot.
  if (spot.inside) {
    if (seg.at === mine.home.id) return { x: stand[0], y: stand[1], z: stand[2], yaw: spot.yaw, figure: false, badge: null, sit: 0, typing: false, walking: false, officeScale: null, place: mine.homeLabel };
    return { x: stand[0], y: stand[1], z: stand[2], yaw: spot.yaw, figure: false, badge: [stand[0], stand[1] + 0.55, stand[2]], sit: 0, typing: false, walking: false, officeScale: null, place: spot.label };
  }
  const { col, row } = place5(c.slot), gap = spot.spread ?? 0.14;
  // Side by side across the way it faces, further rows behind.
  const x = stand[0] + Math.cos(spot.yaw) * gap * col - Math.sin(spot.yaw) * gap * row, z = stand[2] - Math.sin(spot.yaw) * gap * col - Math.cos(spot.yaw) * gap * row;
  const sit = seg.option?.kind === "park" ? 1 : 0;
  return at(x, stand[1] - sit * RIG.leg.h * c.scale * 0.55, z, spot.yaw, { sit, place: spot.label });
}
