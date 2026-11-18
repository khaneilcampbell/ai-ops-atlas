import { runWorking, walkShare, type Segment } from "../../routine/routine";
import { RIG } from "./agentFigures";
import { along } from "./railCommuters";
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
/** Office units: the seated person's thigh height and head top in the Inside view (InsideView deskParts). */
const OFFICE_SEAT = 0.58, OFFICE_TOP = 1.39;

/** Column (-2..2) and row (0..) of a team member's place at a shared spot: no two share one. */
const place5 = (slot: number) => ({ col: (slot % 5) - 2, row: Math.floor(slot / 5) });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
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
    if (!desk || !c.open.has(desk.towerKey)) {
      // Inside with the office closed: the badge waits above the door.
      return { x: door[0], y: door[1], z: door[2], yaw: mine.office.yaw, figure: false, badge: mine.doorBadge, sit: 0, typing: false, walking: false, officeScale: null, place: mine.officeLabel };
    }
    const k = (OFFICE_TOP * desk.k) / RIG.top;
    const f = clamp01((c.wall - seg.t0) / Math.max(1, seg.t1 - seg.t0));
    const [lx, ly, lz] = desk.lobby;
    const walk = (ax: number, ay: number, az: number, bx: number, bz: number, by: number) => {
      const yaw = Math.atan2(bx - ax, bz - az);
      return at(lerp(ax, bx, f), lerp(ay, by, f), lerp(az, bz, f), yaw, { walking: true, officeScale: k, place: mine.officeLabel });
    };
    switch (seg.phase) {
      case "entering":
        return walk(door[0], door[1], door[2], lx, lz, ly);
      case "to_desk":
        return walk(lx, ly, lz, desk.x, desk.z, desk.y);
      case "leaving":
        // Back to the lobby and out of the door in one walk.
        return f < 0.6
          ? at(lerp(desk.x, lx, f / 0.6), desk.y, lerp(desk.z, lz, f / 0.6), Math.atan2(lx - desk.x, lz - desk.z), { walking: true, officeScale: k, place: mine.officeLabel })
          : at(lerp(lx, door[0], (f - 0.6) / 0.4), lerp(ly, door[1], (f - 0.6) / 0.4), lerp(lz, door[2], (f - 0.6) / 0.4), Math.atan2(door[0] - lx, door[2] - lz), { walking: true, officeScale: k, place: mine.officeLabel });
      default: {
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
  // On the bench in a park (the front row); anyone further back stands behind it.
  const sit = seg.option?.kind === "park" && row === 0 ? 1 : 0;
  return at(x, stand[1] - sit * RIG.leg.h * c.scale * 0.55, z, spot.yaw, { sit, place: spot.label });
}
