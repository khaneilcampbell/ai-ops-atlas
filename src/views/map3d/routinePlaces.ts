import type { AgentJob } from "../../catalog/agentJobs";
import type { Agent, Project } from "../../catalog/types";
import type { Anchor, LeisureOption, RideTimes, RoutineEnv, SpotId } from "../../routine/routine";
import { rand } from "../../routine/routine";
import { buildingsOf, defaultFloor, floorOf, journeyTo } from "../../buildings/buildingDefinition";
import { airportPoint, type AirportPlan } from "./airport";
import { GOLD_JET_NAME, airportClockAt, goldJetLive, goldJetTrip, wallOfAirport } from "./goldJetPlan";
import { FLOOR_BASE } from "./models";
import type { NamedAgent } from "./namedAgentPlan";
import { PERIMETER_RAIL, loopPoint, type PerimeterRailPlan } from "./perimeterRailPlan";
import { along, commuterRoute, type CommuterRoute } from "./railCommuters";
import { ENTRANCE, type Pt3 } from "./roads";
import { TERRACE_H, type Scene3D } from "./scene";
import { stadiumGate } from "./stadiumGeometry";
import { WHEEL, WHEEL_CABIN } from "./stationPlazaPlan";
import { buildStreetGraph, streetLines, streetRoute, type StreetGraph } from "./streetGraph";
import { TRAVEL, TRAVEL_CLOCK, travelPlan } from "./travelLoops";
import { marinaSite } from "./marinaPlan";
import { COMMONS_BENCH } from "./commonsPlan";
import { boardingRoute } from "./yachtPlan";
import { buildingDisplayName } from "../../modules/names";
import { SELF_REPORTS, type SelfReportPlan } from "../../selfReports/selfReports";

/**
 * The city's side of the agents' routine (routine/routine.ts): every place an agent can go, as a
 * walk-up path and a standing point, walking times and routes between them on the city's streets,
 * the desks inside the offices, and the timetables of the rides they can take (the Ferris wheel, the
 * perimeter train, the yacht, a flight from the airport). Built once per map layout.
 *
 * Everything here is presentation. Rides are city simulation only: no booking, ticket or purchase
 * exists anywhere, and nothing here can reach a workflow.
 */

/** Walking pace, world units a second (the agents' commute pace, agentCommutes.ts). */
export const PACE = 0.45;
/** World height of the sidewalk the agents walk on. */
export const STREET_Y = TERRACE_H + 0.105;
/** Height of the open office floor in the Inside view (InsideView CUT_Y). */
export const OFFICE_FLOOR_Y = FLOOR_BASE + 0.03;

export interface CitySpot {
  id: SpotId;
  label: string;
  /** From the street (first point) to where it stands (last point), absolute heights. */
  path: Pt3[];
  /** Facing while it stands there. */
  yaw: number;
  /** Standing here means being inside (a home, the arena, the terminal): the figure isn't drawn. */
  inside: boolean;
  /** Several agents can stand here: each gets its own place in a row this far apart (never closer than one agent's width, agentBody.ts). */
  spread?: number;
  /** A bench at the spot's point: its seat surface (world height) and length; the front row sits on it. */
  bench?: { y: number; length: number };
}

export interface DeskSeat {
  /** Chair, on the open office floor. */
  x: number;
  y: number;
  z: number;
  /** Facing the monitor. */
  yaw: number;
  /** Office units to world (the office's own scale), for sizing the seated figure. */
  k: number;
  towerKey: string;
  /** The lobby point just inside the door, on the ground floor. */
  lobby: [number, number, number];
  /** Its floor in the building (buildings/buildingDefinition.ts). */
  floor: number;
  /** Street to lobby: sidewalk, door, lobby. */
  entry: Pt3[];
  /** Lobby to chair: lift on the ground floor, lift on its floor, the aisle, the chair. */
  route: Pt3[];
  /** On the facade at its floor: where its badge shows while its floor is closed. */
  marker: Pt3;
  /** The floor the Inside view opens in its building unless one is picked, and each floor's surface height. */
  defaultFloor: number;
  surfaces: Record<number, number>;
}

export interface AgentPlaces {
  personaId: string;
  home: CitySpot;
  office: CitySpot;
  desk: DeskSeat | null;
  /** Where its badge waits above the door while it's inside with the office closed. */
  doorBadge: [number, number, number];
  homeLabel: string;
  officeLabel: string;
}

export interface CityPlaces {
  spots: Map<SpotId, CitySpot>;
  agents: Map<string, AgentPlaces>;
  leisure: LeisureOption[];
  graph: StreetGraph;
  /** Ride geometry the renderer needs to put riders aboard. */
  wheel?: { x: number; z: number; hubY: number; radius: number };
  train?: { loop: PerimeterRailPlan; from: number; to: number };
  /** Yacht sailings on the train clock (travelLoops.ts), and her saloon door (where riders step aboard). */
  yacht?: { depart: number; period: number; aboard: Pt3 };
  /** The airport the Atlas Gold Jet flies from, for putting its passengers aboard. */
  jet?: Pick<AirportPlan, "x" | "z" | "west">;
  /** Where agents go for their daily self-report (selfReports.ts): the report building's own door. Never a free-time pick. */
  report?: LeisureOption;
}

const street = (p: [number, number] | Pt3): Pt3 => (p.length === 2 ? [p[0], STREET_Y, p[1]] : [p[0], STREET_Y, p[2]]);

/**
 * The persona's desk in its headquarters, from the building's shared definition
 * (buildings/buildingDefinition.ts): the same floor, plate and chair the Inside view draws, and the
 * walk in from the sidewalk through the door, the lobby and the lift.
 */
export function deskSeat(scene: Scene3D, projects: readonly Project[], agents: readonly Agent[], job: AgentJob, personaId: string): DeskSeat | null {
  if (job.work.kind !== "headquarters") return null;
  const t = scene.towers.find((x) => x.projectId === job.work.projectId);
  if (!t) return null;
  const def = buildingsOf(scene.towers, projects, agents).get(t.key);
  const desk = def?.desks.find((d) => d.agentId === personaId);
  if (!def || !desk) return null;
  const j = journeyTo(def, personaId);
  const floor = floorOf(def, desk.floor)!;
  return {
    ...desk.seat,
    k: def.k,
    towerKey: t.key,
    lobby: def.lobby,
    floor: desk.floor,
    entry: j.slice(0, 3).map((p) => p.p),
    route: j.slice(2).map((p) => p.p),
    // Just in front of the footprint's street face, which no storey above the lobby reaches past.
    marker: [desk.seat.x, floor.y + def.exterior.storeyH * 0.55, def.exterior.z + def.exterior.size / 2 + 0.08],
    defaultFloor: defaultFloor(def),
    surfaces: Object.fromEntries(def.floors.map((f) => [f.index, f.surface])),
  };
}

/** Build every place for a layout: homes, offices and desks for the named agents, and the shared outings. */
export function planCityPlaces(scene: Scene3D, named: readonly NamedAgent[], jobs: readonly AgentJob[], projects: readonly Project[], agents: readonly Agent[], graph: StreetGraph = buildStreetGraph(streetLines(scene))): CityPlaces {
  const spots = new Map<SpotId, CitySpot>();
  const add = (s: CitySpot) => {
    spots.set(s.id, s);
    return s;
  };
  const out: CityPlaces = { spots, agents: new Map(), leisure: [], graph };

  // Homes and offices.
  for (const a of named) {
    const job = jobs.find((j) => j.agentId === a.personaId);
    if (!job) continue;
    const b = scene.financial?.buildings.find((x) => x.id === job.home.building && x.approach.length > 0);
    const homePath = b ? [...b.approach].reverse().map((p) => street(p)) : [street([a.spot.x, a.spot.z])];
    const home = add({ id: `home:${a.personaId}`, label: job.home.label, path: homePath, yaw: 0, inside: !!b });
    // The office: its front steps, then its own place in the row before the door.
    const door: Pt3 = job.work.kind === "headquarters" ? (() => {
      const t = scene.towers.find((x) => x.projectId === job.work.projectId);
      const def = t && buildingsOf(scene.towers, projects, agents).get(t.key);
      return def ? def.entrance.outside : t ? [t.x, STREET_Y, t.z + t.size / 2 + ENTRANCE / 2] : [a.spot.x, STREET_Y, a.spot.z];
    })() : [a.spot.x, a.spot.y, a.spot.z];
    const office = add({ id: `office:${a.personaId}`, label: a.workLabel, path: [door, [a.spot.x, a.spot.y, a.spot.z]], yaw: a.spot.yaw, inside: false });
    const desk = deskSeat(scene, projects, agents, job, a.personaId);
    // Inside with its floor closed, its badge shows on the facade at its own floor, so the building
    // says where the work is happening; with no desk, above its place by the door.
    out.agents.set(a.personaId, { personaId: a.personaId, home, office, desk, doorBadge: desk?.marker ?? [a.spot.x, a.spot.y + 0.55, a.spot.z], homeLabel: job.home.label, officeLabel: a.workLabel });
  }

  const opt = (o: LeisureOption, s: CitySpot, exit?: CitySpot) => {
    if (!spots.has(s.id)) add(s);
    if (exit && !spots.has(exit.id)) add(exit);
    out.leisure.push(o);
  };

  // Parks: the Commons benches, and the Station Plaza gardens.
  const c = scene.commons;
  if (c && c.benches.length) {
    c.benches.slice(0, 6).forEach((bench, i) => {
      const entry = c.access.service;
      opt({ id: `park:commons:${i}`, kind: "park", label: "Relaxing in the Commons", spot: `park:commons:${i}`, exit: `park:commons:${i}`, stay: [240, 720] }, { id: `park:commons:${i}`, label: "The Commons", path: [street(entry), [bench[0], STREET_Y - 0.075, bench[1]]], yaw: (c.benchRotations[i] ?? 0) + Math.PI, inside: false, spread: 0.18, bench: { y: TERRACE_H + COMMONS_BENCH.seat, length: COMMONS_BENCH.length } });
    });
  }
  for (const p of scene.parks.filter((x) => /park|garden|green/i.test(x.label)).slice(0, 3)) {
    const id = `park:${p.id}`;
    opt({ id, kind: "park", label: `Relaxing in ${p.label}`, spot: id, exit: id, stay: [240, 600] }, { id, label: p.label, path: [street([p.x + p.w / 2, p.z + p.d / 2])], yaw: 0, inside: false, spread: 0.3 });
  }

  // Other districts: a short visit in front of a few headquarters.
  for (const t of scene.towers.filter((x) => !x.identity.landmark).slice(0, 8)) {
    const id = `district:${t.projectId}`;
    const door: Pt3 = [t.x, STREET_Y, t.z + t.size / 2 + ENTRANCE / 2 + 0.7];
    opt({ id, kind: "district", label: `Visiting ${t.name}`, spot: id, exit: id, stay: [180, 480] }, { id, label: t.name, path: [door], yaw: Math.PI, inside: false, spread: 0.32 });
  }

  // The Ferris wheel by the station: queue in front, board a cabin at the bottom, off after one turn.
  const plaza = scene.stationPlaza;
  if (plaza) {
    const w = plaza.wheel;
    out.wheel = { x: w.x, z: w.z, hubY: TERRACE_H + 0.04 + WHEEL.hub, radius: WHEEL.radius };
    const queue: Pt3 = [w.x, STREET_Y - 0.065, w.z + 1.05];
    const walk = plaza.walk.map((p) => street(p)).reverse();
    opt({ id: "wheel", kind: "wheel", label: "Riding the Ferris wheel", spot: "wheel", exit: "wheel", stay: [0, 0] }, { id: "wheel", label: "The Ferris wheel", path: [...walk, queue], yaw: Math.PI, inside: false, spread: 0.16 });
  }

  // The perimeter train: from Financial District Station to the next stop and off again.
  const loop = scene.communityRail?.loop;
  if (loop && loop.stops.length >= 2) {
    const from = Math.max(0, loop.stops.findIndex((s) => s.id === "service:financial-station"));
    const to = (from + 1) % loop.stops.length;
    const platform = (i: number): Pt3[] => loop.stops[i].walk.map((p) => [p[0], TERRACE_H + (p[1] > 0 ? p[1] : 0.105), p[2]] as Pt3);
    out.train = { loop, from, to };
    const a = { id: "train:board", label: loop.stops[from].name, path: platform(from), yaw: loop.stops[from].yaw, inside: false, spread: 0.2 };
    const b = { id: "train:exit", label: loop.stops[to].name, path: platform(to), yaw: loop.stops[to].yaw, inside: false, spread: 0.2 };
    opt({ id: "train", kind: "train", label: `Riding the train to ${loop.stops[to].name}`, spot: a.id, exit: b.id, stay: [0, 0] }, a, b);
  }

  // The yacht: down the marina stair, along the pontoon to her gangway; aboard before she casts off, off once she's back.
  const tp = travelPlan(scene);
  if (tp?.yacht) {
    const route = boardingRoute(marinaSite(scene, TERRACE_H), tp.yacht.berth) as Pt3[];
    const path = route.slice(0, -2);
    out.yacht = { depart: tp.yacht.depart, period: tp.yacht.period, aboard: route[route.length - 1] };
    opt({ id: "yacht", kind: "yacht", label: "On a yacht ride", spot: "yacht", exit: "yacht", stay: [0, 0] }, { id: "yacht", label: "The Atlas yacht", path: [street(path[0]), ...path], yaw: Math.PI / 2, inside: false, spread: 0.12 });
  }

  // The airport terminal, for a ride on the Atlas Gold Jet (Khaneil, 2026-11-18), and the arena gate.
  const air = scene.airport;
  if (air) {
    const front = airportPoint(air, -0.7, 6);
    out.jet = { x: air.x, z: air.z, west: air.west };
    opt({ id: "flight", kind: "flight", label: `Flying on the ${GOLD_JET_NAME}`, spot: "flight", exit: "flight", stay: [0, 0] }, { id: "flight", label: "Atlas airport terminal", path: [street(front)], yaw: 0, inside: true });
  }
  const st = scene.stadium;
  if (st) {
    const [gx, gz] = stadiumGate(st);
    opt({ id: "arena", kind: "arena", label: "At the arena", spot: "arena", exit: "arena", stay: [420, 900] }, { id: "arena", label: "Team Events Arena", path: [street([gx, gz])], yaw: 0, inside: true });
  }
  out.report = reportPlace(scene, add) ?? undefined;
  return out;
}

/**
 * The self-report building's door (catalog/workspace/self-reports.yaml): up its own approach from the
 * sidewalk and inside for a few minutes. Only Financial District buildings have a walk-up approach;
 * any other building leaves the report walk off the map.
 */
export function reportPlace(scene: Scene3D, add: (s: CitySpot) => CitySpot, plan: SelfReportPlan = SELF_REPORTS): LeisureOption | null {
  const m = /^service:financial:([a-z0-9-]+)$/.exec(plan.building);
  const b = m && scene.financial?.buildings.find((x) => x.id === m[1] && x.approach.length > 0);
  if (!b) return null;
  const name = buildingDisplayName(plan.building, b.name);
  const id = `report:${b.id}`;
  add({ id, label: name, path: [...b.approach].reverse().map((p) => street(p)), yaw: 0, inside: true, spread: 0.2 });
  const stay = plan.stayMinutes * 60;
  return { id, kind: "district", label: `Reporting at the ${name}`, spot: id, exit: id, stay: [stay, stay] };
}

// ------------------------------------------------------------------------------------- walking

export class CityRoutes {
  private routes = new Map<string, CommuterRoute | null>();
  constructor(readonly places: CityPlaces) {}

  spot(id: SpotId): CitySpot | undefined {
    return this.places.spots.get(id);
  }

  /** Where an anchor is in the world. */
  point(a: Anchor): Pt3 | null {
    if ("spot" in a) {
      const s = this.spot(a.spot);
      return s ? s.path[s.path.length - 1] : null;
    }
    const r = this.route(a.from, a.to);
    if (!r) return this.point({ spot: a.to });
    const q = along(r, r.length * a.f, 0);
    return [q.x, q.y, q.z];
  }

  private key(a: Anchor): string {
    return "spot" in a ? a.spot : `${this.key(a.from)}>${a.to}@${a.f.toFixed(4)}`;
  }

  /** The walk from an anchor to a spot: out of the first place's path, along the streets, up the second's. */
  route(from: Anchor, to: SpotId): CommuterRoute | null {
    const k = `${this.key(from)}=>${to}`;
    if (this.routes.has(k)) return this.routes.get(k)!;
    const target = this.spot(to);
    let r: CommuterRoute | null = null;
    if (target) {
      const head: Pt3[] = "spot" in from ? [...(this.spot(from.spot)?.path ?? [])].reverse() : (() => {
        const p = this.point(from);
        return p ? [p] : [];
      })();
      if (head.length) {
        const a = head[head.length - 1], b = target.path[0];
        const via = Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.05 ? [] : streetRoute(this.places.graph, [a[0], 0, a[2]], [b[0], 0, b[2]]);
        if (via) {
          const pts = [...head, ...via.map((p) => [p[0], STREET_Y, p[2]] as Pt3), ...target.path];
          // Drop repeated points: they make zero-length legs.
          const clean = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) > 1e-4);
          if (clean.length >= 2) r = commuterRoute(clean);
          else if (clean.length === 1) r = commuterRoute([clean[0], [clean[0][0] + 1e-3, clean[0][1], clean[0][2]]]);
        }
      }
    }
    if (this.routes.size > 4000) this.routes.clear();
    this.routes.set(k, r);
    return r;
  }

  travel(from: Anchor, to: SpotId): number {
    if ("spot" in from && from.spot === to) return 0;
    const r = this.route(from, to);
    return r ? r.length / PACE : Infinity;
  }
}

// ------------------------------------------------------------------------------------- rides

/** Ferris wheel speed, radians a second, and cabins (StationFerrisWheel.tsx turns by the wall clock). */
export const WHEEL_SPEED = 0.045;
export const WHEEL_CABINS = 12;
/** Whether the wheel is turning (StationFerrisWheel sets it; reduced motion holds it still). */
export const WHEEL_LIVE = { turning: true };
const TAU = Math.PI * 2;
/** The wheel's angle at a wall clock time. The wheel itself reads this, so riders and cabins agree. */
export const wheelAngle = (wallMs: number) => ((wallMs / 1000) * WHEEL_SPEED) % TAU;
/** Cabin i's angle round the hub at a wall time (cabin 0 starts at 3 o'clock). */
export const cabinAngle = (i: number, wallMs: number) => (i * TAU) / WHEEL_CABINS + wheelAngle(wallMs);
/** Next wall time at or after `t` that cabin i is at the bottom (6 o'clock, angle -π/2). */
export function cabinAtBottom(i: number, t: number): number {
  const bottom = (3 * Math.PI) / 2;
  const now = ((cabinAngle(i, t) % TAU) + TAU) % TAU;
  const need = ((bottom - now) % TAU + TAU) % TAU;
  return t + (need / WHEEL_SPEED) * 1000;
}
export const WHEEL_TURN_MS = (TAU / WHEEL_SPEED) * 1000;

/** Train clock seconds at a wall time, from the live clock (the train sets it each frame). */
export function trainClockAt(wall: number): number {
  return TRAVEL_CLOCK.live && TRAVEL_CLOCK.wall ? TRAVEL_CLOCK.t + (wall - TRAVEL_CLOCK.wall) / 1000 : wall / 1000;
}
/** Wall time of a train clock time, by the same mapping. */
export function wallOfTrain(clock: number, now: number): number {
  return now + (clock - trainClockAt(now)) * 1000;
}

/** The env the routine planner needs for one agent. `now` is the wall clock (ms). */
export function routineEnv(routes: CityRoutes, personaId: string, now: () => number = Date.now): RoutineEnv | null {
  const mine = routes.places.agents.get(personaId);
  if (!mine) return null;
  const places = routes.places;
  const cabin = Math.floor(rand(`${personaId}:cabin`) * WHEEL_CABINS);
  return {
    travel: (from, to) => routes.travel(from, to),
    ride: (o: LeisureOption, arrive: number): RideTimes | null => {
      switch (o.kind) {
        case "wheel": {
          if (!places.wheel) return null;
          const board = cabinAtBottom(cabin, arrive + 6000);
          return { board, alight: board + WHEEL_TURN_MS, seat: `cabin ${cabin + 1}` };
        }
        case "train": {
          const t = places.train;
          if (!t) return null;
          const { loop, from, to } = t;
          const clock = trainClockAt(arrive) + 3;
          const lap = loop.period, open = loop.stops[from].arrival;
          const k = Math.ceil((clock - open - (PERIMETER_RAIL.dwell - 4)) / lap);
          const boardClock = open + Math.max(0, k) * lap + 2;
          let ride = loop.stops[to].arrival - loop.stops[from].arrival;
          if (ride <= 0) ride += lap;
          const n = now();
          const board = wallOfTrain(boardClock, n);
          return { board: Math.max(board, arrive), alight: Math.max(board, arrive) + (ride + 2.5) * 1000, seat: `carriage ${1 + (cabin % 3)}` };
        }
        case "yacht": {
          const y = places.yacht;
          if (!y) return null;
          // Her next sailing after the agent reaches the gangway (with a few seconds to step aboard).
          const clock = trainClockAt(arrive) + 6;
          const since = (((clock - y.depart) % y.period) + y.period) % y.period;
          const depart = wallOfTrain(clock + (y.period - since), now());
          return { board: arrive + 4000, alight: depart + (TRAVEL.sail + 8) * 1000, seat: "aft deck" };
        }
        case "flight": {
          // Through the terminal and onto the Atlas Gold Jet's next boarding, round its loop over the city, and off
          // again at the gate (goldJetPlan.ts). City simulation only: no booking, ticket or purchase exists.
          const L = goldJetLive;
          const trip = L.live && L.wall ? goldJetTrip(airportClockAt(arrive + 20_000), L.circuit) : null;
          if (trip) {
            const n = now(), at = (c: number) => wallOfAirport(c, n);
            // Its turn in the boarding line, seeded per agent, so a group doesn't all step on at once.
            const turn = trip.boardFrom + (trip.boardTo - trip.boardFrom) * (0.2 + 0.6 * rand(`${personaId}:jet-seat`));
            return { board: at(turn), alight: at(trip.off) + 4000, seat: GOLD_JET_NAME };
          }
          // The airport isn't running (paused, reduced motion, or not drawn yet): time in the terminal instead.
          const board = arrive + 15_000;
          return { board, alight: board + (240 + rand(`${personaId}:${Math.floor(arrive / 60000)}:flight`) * 180) * 1000, seat: "the terminal" };
        }
        default:
          return null;
      }
    },
    rideExit: (o, times, at) => {
      // Nobody steps off mid-air or at sea: the wheel finishes its turn, the yacht comes back, the train reaches its stop.
      // A jet passenger stays aboard until it lands and walks off; before boarding it just leaves the terminal.
      if (o.kind === "flight") return times.seat === GOLD_JET_NAME ? (at < times.board ? at : times.alight) : Math.min(times.alight, Math.max(at, times.board) + 20_000);
      return times.alight;
    },
    home: mine.home.id,
    office: mine.office.id,
    // Its own building first: most free time is spent outside it (ROUTINE.nearOffice), ready to go in.
    leisure: [{ id: `near:${personaId}`, kind: "office", label: `Outside ${mine.officeLabel}`, spot: mine.office.id, exit: mine.office.id, stay: [600, 1500] }, ...places.leisure],
  };
}

/** Where a rider is aboard at `wall`: its wheel cabin's seat surface, a train carriage, or the yacht's main deck at her centre. */
export function riderPoint(places: CityPlaces, kind: LeisureOption["kind"], personaId: string, wall: number, yachtPose?: { x: number; z: number; yaw: number }): Pt3 | null {
  if (kind === "wheel" && places.wheel) {
    const w = places.wheel, i = Math.floor(rand(`${personaId}:cabin`) * WHEEL_CABINS);
    const a = WHEEL_LIVE.turning ? cabinAngle(i, wall) : (i * TAU) / WHEEL_CABINS;
    // The seat surface in its cabin (stationPlazaPlan WHEEL_CABIN): the pose sits the hips on it.
    return [w.x + Math.cos(a) * w.radius, w.hubY + Math.sin(a) * w.radius + WHEEL_CABIN.seatY, w.z + WHEEL_CABIN.seatZ];
  }
  if (kind === "train" && places.train) {
    const { loop } = places.train;
    const clock = trainClockAt(wall), t = ((clock % loop.period) + loop.period) % loop.period;
    // Distance along the loop at this clock, as the train itself works it out (loopState).
    let d = 0;
    for (let i = 0; i < loop.stops.length; i++) {
      const s = loop.stops[i], end = s.arrival + PERIMETER_RAIL.dwell, next = i + 1 < loop.stops.length ? loop.stops[i + 1].arrival : loop.period;
      if (t >= s.arrival && t < end) d = s.distance;
      else if (t >= end && t < next) d = s.distance + (t - end) * PERIMETER_RAIL.speed;
    }
    const q = loopPoint(loop, d);
    return [q.x, TERRACE_H + 0.95, q.z];
  }
  // The yacht: her centre at main-deck level (the gangway's top is the deck), never above it.
  if (kind === "yacht" && yachtPose && places.yacht) return [yachtPose.x, places.yacht.aboard[1], yachtPose.z];
  return null;
}
