import { runWorking, walkShare, type Segment } from "../../routine/routine";
import { RIG } from "./agentFigures";
import { along } from "./railCommuters";
import { alongJourney, levelY, SEAT_TOP, type P3 } from "./buildingModel";
import { riderPoint, type AgentPlaces, type CityPlaces, type CitySpot, type CityRoutes } from "./routinePlaces";
import { FLOOR_H } from "./scene";

/**
 * Where and how one agent is drawn at a moment, from its routine segment (routine/routine.ts).
 * Pure, so the tests can check every kind of segment without a renderer.
 *
 * - walking: along its street route, striding;
 * - standing at a spot: at its own place in the row there (no two agents on one point);
 * - inside a building with no cutaway (home, the arena, the terminal): no figure, and the badge
 *   waits above the door, so you can still find and pick it;
 * - going to work: one continuous walk at the same scale from its place outside, through the
 *   building's real door, across the lobby, up the lift to its floor and along the aisle to its own
 *   chair (buildingModel.ts), and back out the same way. The figure is always placed: with the
 *   building closed the walls hide it and its badge shows on the façade at its floor; with its
 *   floor open in the Inside view it is seen at the desk, typing while a run is working;
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
  /** Inside its office building: which one, on which floor (null in the lift), and whether it's seated. */
  inside?: { key: string; level: number | null; seated: boolean };
}

export interface PoseContext {
  routes: CityRoutes;
  places: CityPlaces;
  personaId: string;
  /** Its own number in the team (0..): a unique place in the rows at shared spots, and its walking lane. */
  slot: number;
  /** Headquarters open in the Inside view: tower key to the floor shown (its level). */
  open: ReadonlyMap<string, number>;
  wall: number;
  yacht?: { x: number; z: number; yaw: number };
  /** City figure scale for this agent (FIGURE_SCALE times its height). */
  scale: number;
}

const BADGE_LIFT = 0.075;

/** Column (-2..2) and row (0..) of a team member's place at a shared spot: no two share one. */
const place5 = (slot: number) => ({ col: (slot % 5) - 2, row: Math.floor(slot / 5) });
/** World units over which a walk eases out of, and into, a row place. */
const BLEND = 0.8;
/** A team member's own standing place at a spot: side by side across the way it faces, further rows behind. */
function rowPlace(spot: CitySpot, slot: number): P3 {
  const stand = spot.path[spot.path.length - 1];
  if (spot.inside) return stand;
  const { col, row } = place5(slot), gap = spot.spread ?? 0.14;
  return [stand[0] + Math.cos(spot.yaw) * gap * col - Math.sin(spot.yaw) * gap * row, stand[1], stand[2] - Math.sin(spot.yaw) * gap * col - Math.cos(spot.yaw) * gap * row];
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
    const lane = place5(c.slot).col * 0.035, d = r.length * f;
    const q = along(r, d, lane);
    // Step out of its own place in the row it was standing in, and into its place in the next one, without a hop.
    let [x, y, z] = [q.x, q.y, q.z];
    const from = "spot" in seg.from ? c.places.spots.get(seg.from.spot) : undefined;
    const ease = (u: number) => Math.max(0, 1 - u / BLEND);
    if (from && d < BLEND) {
      const a = along(r, 0, lane), p = rowPlace(from, c.slot), w = ease(d);
      [x, y, z] = [x + (p[0] - a.x) * w, y + (p[1] - a.y) * w, z + (p[2] - a.z) * w];
    }
    if (target && r.length - d < BLEND && (seg.f1 ?? 1) >= 1) {
      const b = along(r, r.length, lane), p = rowPlace(target, c.slot), w = ease(r.length - d);
      [x, y, z] = [x + (p[0] - b.x) * w, y + (p[1] - b.y) * w, z + (p[2] - b.z) * w];
    }
    return at(x, y, z, q.yaw, { walking: c.wall < seg.t1, place: `On the way to ${target?.label ?? "the next place"}` });
  }

  if (seg.kind === "inside") return insidePose(seg, c, mine, at);

  const spot = c.places.spots.get(seg.at);
  if (!spot) return null;
  const stand = spot.path[spot.path.length - 1];

  if (seg.kind === "ride") {
    const kind = seg.option.kind;
    if (kind === "flight") return { x: stand[0], y: stand[1], z: stand[2], yaw: spot.yaw, figure: false, badge: [stand[0], stand[1] + 0.55, stand[2]], sit: 0, typing: false, walking: false, officeScale: null, place: "On a simulated flight" };
    const p = riderPoint(c.places, kind, c.personaId, c.wall, c.yacht);
    if (!p) return at(stand[0], stand[1], stand[2], spot.yaw, { place: spot.label });
    if (kind === "wheel") return at(p[0], p[1], p[2], 0, { sit: 1, place: `${spot.label}, ${seg.times.seat ?? "a cabin"}` });
    // The gold jet: aboard in the cabin, the badge riding on the jet round its loop.
    if (kind === "jet") return { x: p[0], y: p[1], z: p[2], yaw: 0, figure: false, badge: [p[0] + place5(c.slot).col * 0.12, p[1] + 0.8, p[2]], sit: 1, typing: false, walking: false, officeScale: null, place: "Aboard the Atlas Gold Jet" };
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
  const { row } = place5(c.slot);
  const [x, , z] = rowPlace(spot, c.slot);
  // On the bench in a park (the front row); anyone further back stands behind it.
  const sit = seg.option?.kind === "park" && row === 0 ? 1 : 0;
  return at(x, stand[1] - sit * RIG.leg.h * c.scale * 0.55, z, spot.yaw, { sit, place: spot.label });
}

/** Office floor the point is on, or null between floors (in the lift). */
function floorAt(y: number): number | null {
  const l = (y - levelY(0)) / FLOOR_H;
  return Math.abs(l - Math.round(l)) < 0.06 ? Math.round(l) : null;
}

type At = (x: number, y: number, z: number, yaw: number, rest: Partial<DrawnPose> & { place: string }) => DrawnPose;

/** Going in to work, at the desk, and leaving: one journey through the building model. */
function insidePose(seg: Extract<Segment, { kind: "inside" }>, c: PoseContext, mine: AgentPlaces, at: At): DrawnPose {
  const desk = mine.desk;
  const door = mine.office.path[0];
  if (!desk) {
    // No desk in a headquarters (a workplace that isn't an office): the badge waits above the door.
    return { x: door[0], y: door[1], z: door[2], yaw: mine.office.yaw, figure: false, badge: mine.doorBadge, sit: 0, typing: false, walking: false, officeScale: null, place: mine.officeLabel };
  }
  const m = desk.building;
  // From its own place in the row outside the office (where it stood or arrived), in by the door.
  const pts: P3[] = [rowPlace(mine.office, c.slot), ...desk.journey.points];
  // Stand, sidewalk, doorway, lobby: entering ends in the lobby (index 3).
  const LOBBY = 3;
  const f = clamp01((c.wall - seg.t0) / Math.max(1, seg.t1 - seg.t0));
  let q: { p: P3; yaw: number; riding: boolean };
  let seated = false;
  switch (seg.phase) {
    case "entering":
      q = alongJourney(pts.slice(0, LOBBY + 1), f);
      break;
    case "to_desk":
      q = alongJourney(pts.slice(LOBBY), f);
      break;
    case "leaving":
      q = alongJourney([...pts].reverse(), f);
      break;
    default:
      q = { p: [desk.x, desk.y, desk.z], yaw: desk.yaw, riding: false };
      seated = true;
  }
  const [x, y0, z] = q.p;
  const walking = !seated && !q.riding && f < 1;
  // Indoors once past the doorway: a floor, or the lift between floors.
  const indoors = seated || (Math.abs(x - m.x) < m.size / 2 && Math.abs(z - m.z) < m.size / 2 && y0 >= levelY(0) - 0.01);
  const level = indoors ? floorAt(y0) : null;
  // Seated: hips on the chair (the building is drawn at people's scale, so the seat meets the hips).
  const y = seated ? desk.y + SEAT_TOP * desk.k - RIG.leg.h * c.scale : y0;
  const place = seated ? `At its desk in ${mine.officeLabel}, ${level === 0 ? "lobby" : `floor ${desk.level}`}` : q.riding ? `In the lift in ${mine.officeLabel}` : indoors ? `${mine.officeLabel}, ${level === 0 ? "lobby" : `floor ${level ?? desk.level}`}` : mine.officeLabel;
  const inside = indoors ? { key: m.key, level, seated } : undefined;
  const base = { sit: seated ? 1 : 0, typing: seated && runWorking(seg), walking, place, inside };
  if (!indoors) return at(x, y, z, q.yaw, base);
  const open = c.open.get(m.key);
  if (open !== undefined && level === open) return at(x, y, z, q.yaw, base);
  if (open !== undefined && (level === null || level > open)) {
    // Above the open floor: the shell there is cut away, so the figure would float, and a badge over
    // the open floor would read as being on it. The building summary counts it on its own floor.
    return at(x, y, z, q.yaw, { ...base, figure: false, badge: null });
  }
  // Closed (or below the open floor): the walls hide the figure; its badge shows on the street façade at its floor.
  const front = Math.max(m.door.facade[2], m.z + m.size / 2) + 0.06;
  const bx = Math.max(m.x - m.size / 2 + 0.1, Math.min(m.x + m.size / 2 - 0.1, x));
  return at(x, y, z, q.yaw, { ...base, badge: [bx, y0 + 0.32, front] });
}
