import { runWorking, walkShare, type Segment } from "../../routine/routine";
import { RIG } from "./agentFigures";
import { along } from "./railCommuters";
import { openFloor } from "../../buildings/insideFloors";
import { OFFICE_FURNITURE } from "../../buildings/buildingDefinition";
import type { Pt3 } from "./roads";
import { goldJetRide } from "./goldJetIds";
import { GOLD_JET_NAME, airportClockAt, goldJetLive, goldJetMapPose, goldJetState } from "./goldJetPlan";
import { riderPoint, type CityPlaces, type CityRoutes } from "./routinePlaces";
import { TERRACE_H } from "./scene";
import { AGENT_BODY, passWidth, seatedOrigin } from "./agentBody";
import { YACHT_SCALE } from "./yachtPlan";
import { cafeMoment, type CafeVisit } from "./cafeVisits";
import { CAFE_NAME } from "./cafePlan";

/**
 * Where and how one agent is drawn at a moment, from its routine segment (routine/routine.ts).
 * Pure, so the tests can check every kind of segment without a renderer.
 *
 * - walking: along its street route, striding;
 * - standing at a spot: at its own place in the row there (no two agents on one point);
 * - inside a building with no cutaway (home, the arena, the terminal, its office with Inside off):
 *   no figure, and the badge waits above the door, so you can still find and pick it (in its own
 *   office with Inside off, the roof's "agents inside" marker stands for it instead: no second badge);
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
  /** Its badge is left out because the building's "agents inside" marker shows it (it is still there, for Locate and Follow). */
  marked?: boolean;
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
  /** The airport clock now (seconds) and the jet's circuit; defaults to the map's live clock. */
  jet?: { clock: number; circuit?: typeof goldJetLive.circuit };
  /** City figure scale for this agent (FIGURE_SCALE times its height). */
  scale: number;
  /** Café visits for every agent, with their seats (cafeVisits.ts). */
  cafe?: ReadonlyMap<string, CafeVisit[]>;
  /**
   * The map shows an "agents inside" marker over the building it is in (occupancy.ts): its office
   * (with the office closed), the arena, the airport terminal. Then it gets no badge at the door or
   * on the facade as well: one sign per agent, not two. (At home it is already badge-free.)
   */
  roofMarker?: boolean;
}

const BADGE_LIFT = 0.075;

/**
 * Places aboard the yacht, in her own units (yachtGeometry.ts): three on the aft deck sofa (seat top
 * 0.075 above the deck, facing the table and the bow), then three standing behind it at the stern
 * rail. All are aft of the bridge deck's overhang, which leaves too little headroom to stand under
 * (agentBody.ts standingClearHeight), and clear of the stairs up each side.
 */
const YACHT_SOFA = { x: -2.75, seat: 0.075 } as const;
const YACHT_PLACES: { x: number; z: number; sit: boolean }[] = [
  ...[-0.16, 0, 0.16].map((z) => ({ x: YACHT_SOFA.x, z, sit: true })),
  ...[-0.19, 0, 0.19].map((z) => ({ x: -2.92, z, sit: false })),
];

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
    // Agents leaving together (one run finishing for a whole team) spread out along and across the
    // street mid-walk instead of walking as one stacked figure; the offsets fade to nothing at both
    // ends, so each still starts and stops exactly at its own spot.
    const mid = Math.sin(Math.PI * f), lag = ((c.slot * 3 + Math.floor(c.slot / 5)) % 5) * 0.14 * mid;
    const q = along(r, Math.max(0, r.length * f - lag), place5(c.slot).col * (0.035 + 0.035 * mid));
    return at(q.x, q.y, q.z, q.yaw, { walking: c.wall < seg.t1, place: `On the way to ${target?.label ?? "the next place"}` });
  }

  if (seg.kind === "inside") {
    const desk = mine.desk;
    const door = mine.office.path[0];
    const hidden = (): DrawnPose => ({ x: door[0], y: door[1], z: door[2], yaw: mine.office.yaw, figure: false, badge: mine.doorBadge, sit: 0, typing: false, walking: false, officeScale: null, place: mine.officeLabel });
    // Inside with its office closed: the roof marker shows it, or else its badge on the facade at its floor.
    if (!desk || !c.open.has(desk.towerKey)) return c.roofMarker ? { ...hidden(), badge: null, marked: true } : hidden();
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
        // Seated: hips on the chair's seat (not floating above it), facing the monitor.
        const y = seatedOrigin(desk.y + OFFICE_FURNITURE.seatTop * desk.k, k);
        return at(desk.x, y, desk.z, desk.yaw, { sit: 1, typing: runWorking(seg), officeScale: k, place: `At its desk in ${mine.officeLabel}` });
      }
    }
  }

  const spot = c.places.spots.get(seg.at);
  if (!spot) return null;
  const stand = spot.path[spot.path.length - 1];

  if (seg.kind === "ride") {
    const kind = seg.option.kind;
    if (kind === "flight") {
      // Aboard the Atlas Gold Jet between stepping on and walking off: its badge rides the jet wherever it is.
      const aboard = seg.times.seat === GOLD_JET_NAME && c.places.jet && c.wall >= seg.times.board && c.wall < seg.times.alight - 4000;
      if (aboard && c.places.jet) {
        const clock = c.jet?.clock ?? airportClockAt(c.wall), circuit = c.jet ? c.jet.circuit : goldJetLive.circuit;
        const p = goldJetMapPose(c.places.jet, clock, circuit), y = TERRACE_H + p.y + 1.05;
        // While you ride in the cabin yourself the badge would sit on the camera, so it is left out then.
        return { x: p.x, y, z: p.z, yaw: p.yaw, figure: false, badge: goldJetRide.active ? null : [p.x, y, p.z], sit: 1, typing: false, walking: false, officeScale: null, place: `Aboard the ${GOLD_JET_NAME} · ${goldJetState(clock, circuit).label}` };
      }
      const where = seg.times.seat === GOLD_JET_NAME ? (c.wall < seg.times.board ? `Atlas airport terminal, waiting to board the ${GOLD_JET_NAME}` : `Atlas airport terminal, off the ${GOLD_JET_NAME}`) : spot.label;
      // In the terminal: the airport's "agents inside" marker shows it when the map has one.
    return { x: stand[0], y: stand[1], z: stand[2], yaw: spot.yaw, figure: false, badge: c.roofMarker ? null : [stand[0], stand[1] + 0.55, stand[2]], ...(c.roofMarker ? { marked: true } : {}), sit: 0, typing: false, walking: false, officeScale: null, place: where };
    }
    const p = riderPoint(c.places, kind, c.personaId, c.wall, c.yacht);
    if (!p) return at(stand[0], stand[1], stand[2], spot.yaw, { place: spot.label });
    // Seated in its cabin: hips on the bench (p is the seat surface), facing out of the wheel.
    if (kind === "wheel") return at(p[0], seatedOrigin(p[1], c.scale), p[2], 0, { sit: 1, place: `${spot.label}, ${seg.times.seat ?? "a cabin"}` });
    if (kind === "train") return { x: p[0], y: p[1], z: p[2], yaw: 0, figure: false, badge: [p[0], p[1] + 0.35, p[2]], sit: 1, typing: false, walking: false, officeScale: null, place: `On the train, ${seg.times.seat ?? "a carriage"}` };
    // The yacht: on her aft deck wherever she is (never on the water), on the sofa or at the stern rail.
    const yaw = c.yacht?.yaw ?? spot.yaw, cos = Math.cos(yaw), sin = Math.sin(yaw);
    const seat = YACHT_PLACES[c.slot % YACHT_PLACES.length], lx = seat.x * YACHT_SCALE, lz = seat.z * YACHT_SCALE;
    const deck = p[1] - 0.01;
    const y = seat.sit ? seatedOrigin(deck + YACHT_SOFA.seat * YACHT_SCALE, c.scale) : deck;
    // Her local +x (the bow) is world (cos, -sin): facing it is yaw + pi/2 for a figure facing +z.
    return at(p[0] + lx * cos + lz * sin, y, p[2] - lx * sin + lz * cos, yaw + Math.PI / 2, { sit: seat.sit ? 1 : 0, place: "Aboard the Atlas yacht" });
  }

  // At the café: in to the counter, its own seat, back out (seats are shared out across agents in cafeVisits.ts).
  if (seg.option?.kind === "cafe" && c.places.cafe) {
    const visit = c.cafe?.get(c.personaId)?.find((v) => v.t0 === seg.t0);
    if (visit) {
      const q = cafeMoment(c.places.cafe, visit, c.wall);
      const y = q.seatY !== null ? seatedOrigin(q.seatY, c.scale) : q.y;
      return at(q.x, y, q.z, q.yaw, { sit: q.seatY !== null ? 1 : 0, walking: q.walking, place: `${CAFE_NAME} · ${q.where}` });
    }
  }
  // Standing or sitting at a spot.
  if (spot.inside) {
    if (seg.at === mine.home.id) return { x: stand[0], y: stand[1], z: stand[2], yaw: spot.yaw, figure: false, badge: null, sit: 0, typing: false, walking: false, officeScale: null, place: mine.homeLabel };
    // Indoors on an outing (the arena): the building's "agents inside" marker shows it when the map has one.
    return { x: stand[0], y: stand[1], z: stand[2], yaw: spot.yaw, figure: false, badge: c.roofMarker ? null : [stand[0], stand[1] + 0.55, stand[2]], ...(c.roofMarker ? { marked: true } : {}), sit: 0, typing: false, walking: false, officeScale: null, place: spot.label };
  }
  // Its own place in the row outside its office is already its own: no shuffle, or neighbours land on each other.
  if (seg.at === mine.office.id) return at(stand[0], stand[1], stand[2], spot.yaw, { place: spot.label });
  // Never closer than one agent's width plus clearance (agentBody.ts), so neighbours' arms don't overlap.
  const { col, row } = place5(c.slot), gap = Math.max(spot.spread ?? 0, passWidth - AGENT_BODY.clearance);
  // On a bench, the front row's middle three sit along it, hips on its seat; everyone else stands
  // beside or behind it. In a park with no bench, the front row sits on the grass.
  const onBench = !!spot.bench && row === 0 && Math.abs(col) <= 1;
  const across = onBench ? (col * spot.bench!.length) / 3 : col * gap;
  const back = spot.bench && !onBench && row === 0 ? 0 : row * gap + (spot.bench && row > 0 ? 0.2 : 0);
  // Side by side across the way it faces, further rows behind.
  const x = stand[0] + Math.cos(spot.yaw) * across - Math.sin(spot.yaw) * back, z = stand[2] - Math.sin(spot.yaw) * across - Math.cos(spot.yaw) * back;
  if (onBench) return at(x, seatedOrigin(spot.bench!.y, c.scale), z, spot.yaw, { sit: 1, place: spot.label });
  const sit = seg.option?.kind === "park" && !spot.bench && row === 0 ? 1 : 0;
  return at(x, stand[1] - sit * RIG.leg.h * c.scale * 0.55, z, spot.yaw, { sit, place: spot.label });
}
