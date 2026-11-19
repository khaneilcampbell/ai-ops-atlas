import { rand, type Anchor, type LeisureOption, type RideTimes, type RoutineEnv, type SpotId, type TravelMode, type TripChoice, type TripPlan } from "../../routine/routine";
import { LANE_OFF, ROAD_W, type Pt3 } from "./roads";
import { PERIMETER_RAIL } from "./perimeterRailPlan";
import { STREET_Y, trainClockAt, wallOfTrain, type CityRoutes, type CitySpot } from "./routinePlaces";
import { drive, TRAVEL_CLOCK } from "./travelLoops";
import { CAR_POSES, DETOURS, legsAt, vehicleAt, type Detour, type Leg, type VehiclePlan } from "./vehicles";

/**
 * Agents travelling by car or train (Khaneil, 2026-11-19: "I want to have agents get pick up by cars or take the train
 * when they travel as a option"; picked option A: automatic, with an override on Free time).
 *
 * - Car: the agent walks to the kerb near where it is and waits. One of the Atlas cars (four of the city's 24, on
 *   timetabled loops, vehicles.ts ATLAS_CARS) turns off its loop where it is, drives the real roads to that kerb, stops,
 *   takes the agent to the kerb nearest where it's going, drops it off, and drives back onto its loop exactly where it
 *   would have been. Kerbs are the middle of a street (never a junction or a bridge), one car at a kerb at a time.
 * - Train: the agent walks to the nearest of the perimeter train's stations, waits on the platform for the timetabled
 *   train, rides to the station nearest where it's going, and walks the rest.
 * - Auto: a short trip stays on foot; otherwise the quicker of car and train, if it beats walking.
 *
 * City picture only: nothing is booked, bought or sent anywhere, no new vehicle or model is drawn (riders are hidden,
 * their badge rides along), and a trip never stands for a run. Pure planning plus the shared DETOURS the renderer reads.
 */
export const RIDE = {
  /** Atlas car speed on its pickup drive, world units a second (the shuttles' brisk city speed is 1). */
  speed: 0.9,
  /** Seconds the agent takes to get in after both are at the kerb, and to get out. */
  board: 2,
  alight: 1.5,
  /** Seconds the car waits at the drop-off kerb before driving on. */
  kerbHold: 3,
  /** Auto: a trip that is at most this many seconds on foot stays a walk. */
  walkFirst: 75,
  /** Auto takes the train when the walks to and from the stations are at most this share of walking all the way. */
  stationShare: 0.6,
  /** Auto never takes a car or train that gets there later than this many times the walk. */
  slowest: 2,
  /** Shortest street a car stops on (its middle is the kerb). */
  kerbMin: 1.2,
  /** Kerbs looked at near each end of a trip. */
  kerbChoices: 4,
} as const;

const S = 1000;
const flat = (a: Pt3, b: Pt3) => Math.hypot(b[0] - a[0], b[2] - a[2]);

/** The driving network and the Atlas cars, from the layout (routinePlaces.ts planCityPlaces). */
export interface RoadMap {
  nodes: Pt3[];
  next: number[][];
  cars: VehiclePlan[];
}

interface Kerb {
  a: number;
  b: number;
  /** Where the car stops (its lane, the street's middle) and where the agent stands (the kerb beside it). */
  lane: Pt3;
  spot: CitySpot;
  /** Undirected street key: one car on a street's kerb at a time, whichever way it faces. */
  street: string;
}

export interface CarBooking {
  key: string;
  personaId: string;
  car: VehiclePlan;
  detour: Detour;
  /** Where the agent gets in and out (kerb spot ids). */
  kerbs: [SpotId, SpotId];
  /** The kerbs, busy from the car's arrival to its departure. */
  holds: { street: string; from: number; to: number }[];
  times: RideTimes;
}

/** Car bookings by agent: the renderer finds a rider's car here (carRiderPoint). */
export const CAR_BOOKINGS = new Map<string, CarBooking>();

/** Where an agent riding in an Atlas car is at `wall` (the car's roof, for its badge), or null when it isn't in one. */
export function carRiderPoint(personaId: string, wall: number): Pt3 | null {
  const b = CAR_BOOKINGS.get(personaId);
  if (!b || wall < b.detour.wall0 || wall >= b.detour.wall1) return null;
  // Where the car is drawn (after car following), or where its timetable puts it when the map isn't drawing.
  const p = CAR_POSES.get(b.car.id) ?? vehicleAt(b.car, trainClockAt(wall));
  return [p.x, STREET_Y + p.y + 0.2, p.z];
}

/** Right-hand lane of an open drive: each point moved right of the way the car is going (vehicles.ts keepRightLoop, open ends). */
export function laneLine(pts: Pt3[], off: number = LANE_OFF): Pt3[] {
  const right = (p: Pt3, q: Pt3) => {
    const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l] as const;
  };
  return pts.map((p, i) => {
    let a = i - 1, b = i + 1;
    while (a >= 0 && flat(pts[a], p) < 1e-7) a--;
    while (b < pts.length && flat(p, pts[b]) < 1e-7) b++;
    const n1 = a >= 0 ? right(pts[a], p) : null, n2 = b < pts.length ? right(p, pts[b]) : null;
    if (!n1 && !n2) return p;
    if (!n1 || !n2) {
      const n = (n1 ?? n2)!;
      return [p[0] + n[0] * off, p[1], p[2] + n[1] * off];
    }
    const k = off / Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    const mx = (n1[0] + n2[0]) * k, mz = (n1[1] + n2[1]) * k, m = Math.hypot(mx, mz), cap = ROAD_W / 2 / Math.max(m, ROAD_W / 2);
    return [p[0] + mx * cap, p[1], p[2] + mz * cap];
  });
}

/** Train times from stop i to stop j for an agent on the platform at `arrive` (wall ms). Pure: `now` maps wall to train clock. */
export function trainTimes(loop: { period: number; stops: { arrival: number }[] }, i: number, j: number, arrive: number, now: number, seat = "a carriage"): RideTimes {
  const clock = trainClockAt(arrive) + 3;
  const lap = loop.period, open = loop.stops[i].arrival;
  const k = Math.ceil((clock - open - (PERIMETER_RAIL.dwell - 4)) / lap);
  const boardClock = open + Math.max(0, k) * lap + 2;
  let ride = loop.stops[j].arrival - loop.stops[i].arrival;
  if (ride <= 0) ride += lap;
  const board = Math.max(wallOfTrain(boardClock, now), arrive);
  return { board, alight: board + (ride + 2.5) * S, seat };
}

/** A trip worked out but not yet taken: its plan, when it gets there, and (for a car) the booking to keep. */
interface Candidate {
  plan: TripPlan;
  end: number;
  /** Seconds on foot to and from the stations (a train trip). */
  stationWalk: number;
  booking?: CarBooking;
}

/**
 * The city's cars and trains for the agents' trips. One per map layout (one CityRoutes), shared by every agent, so two
 * agents never get the same car or the same kerb at once.
 */
export class CityRides {
  private kerbs: Kerb[] | null = null;
  /** Node paths between nodes, by "a>b|prev|notFrom" (the road network doesn't change within a layout). */
  private paths = new Map<string, number[] | null>();
  private chosen = new Map<string, { key: string; choice: TripChoice }>();
  constructor(
    readonly routes: CityRoutes,
    readonly roads: RoadMap | undefined,
    readonly now: () => number = Date.now,
  ) {
    // A new layout starts with no pickups booked.
    DETOURS.clear();
    CAR_POSES.clear();
    CAR_BOOKINGS.clear();
  }

  /** The trip for an agent setting off at `depart` (wall ms) from `from` to `to`; the same question gets the same answer. */
  trip(personaId: string, from: Anchor, to: SpotId, depart: number, mode: TravelMode): TripChoice {
    const key = `${JSON.stringify(from)}>${to}@${Math.round(depart / S)}:${mode}`;
    const kept = this.chosen.get(personaId);
    if (kept?.key === key) return kept.choice;
    // A new trip for this agent replaces its old one; a car already on its way still finishes that drive.
    const old = CAR_BOOKINGS.get(personaId);
    if (old && old.detour.wall0 > this.now()) this.cancel(old);
    const choice = this.decide(personaId, from, to, depart, mode);
    this.chosen.set(personaId, { key, choice });
    return choice;
  }

  private decide(personaId: string, from: Anchor, to: SpotId, depart: number, mode: TravelMode): TripChoice {
    if (mode === "walk") return { plan: null };
    const walk = this.routes.travel(from, to);
    if (mode === "auto" && Number.isFinite(walk) && walk <= RIDE.walkFirst) return { plan: null };
    const train = mode === "car" && this.carsRunning() ? null : this.train(personaId, from, to, depart);
    const car = mode === "train" ? null : this.car(personaId, from, to, depart);
    const keep = (c: Candidate, note?: string): TripChoice => {
      if (c.booking) this.commit(c.booking);
      return { plan: note ? { ...c.plan, waitNote: `${note}: ${c.plan.waitNote.toLowerCase()}` } : c.plan };
    };
    if (mode === "car") {
      if (car) return keep(car);
      const t = this.train(personaId, from, to, depart);
      const why = this.carsRunning() ? "No Atlas car free" : "Atlas cars aren't running right now";
      return t ? keep(t, `${why}, so taking the train`) : { plan: null, note: `${why.toLowerCase()}, so walking` };
    }
    if (mode === "train") return train ? keep(train) : { plan: null, note: "no station nearer than walking, so walking" };
    // Auto (as proposed to Khaneil): a short trip stays on foot; the train when both ends are near a station; otherwise
    // a car. Neither when it would take more than twice as long as walking (a long wait for a car or the next train).
    const sane = (c: Candidate | null) => (c && (!Number.isFinite(walk) || c.end <= depart + walk * S * RIDE.slowest) ? c : null);
    const pick = sane(train && train.stationWalk <= walk * RIDE.stationShare ? train : null) ?? sane(car);
    return pick ? keep(pick) : { plan: null };
  }

  /** Whether the cars are moving on the map now (the train clock is live): only then can one come to the kerb. */
  carsRunning(): boolean {
    return !!this.roads?.cars.length && TRAVEL_CLOCK.live && !!TRAVEL_CLOCK.wall;
  }

  // ---------------------------------------------------------------------------------- train

  private train(personaId: string, from: Anchor, to: SpotId, depart: number): Candidate | null {
    const loop = this.routes.places.train?.loop;
    if (!loop) return null;
    const ids = loop.stops.map((_, i) => `station:${i}`);
    if (!ids.every((id) => this.routes.spot(id))) return null;
    const there = ids.map((id) => this.routes.travel(from, id));
    const off = ids.map((id) => this.routes.travel({ spot: id }, to));
    const i = there.indexOf(Math.min(...there)), j = off.indexOf(Math.min(...off));
    if (i === j || !Number.isFinite(there[i]) || !Number.isFinite(off[j])) return null;
    const arrive = depart + there[i] * S;
    const times = trainTimes(loop, i, j, arrive, this.now(), `carriage ${1 + Math.floor(rand(`${personaId}:carriage`) * 3)}`);
    const name = loop.stops[j].name;
    const option: LeisureOption = { id: `trip:train:${personaId}`, kind: "train", label: `Riding the train to ${name}`, spot: ids[i], exit: ids[j], stay: [0, 0] };
    return { plan: { option, times, walkNote: `Walking to ${loop.stops[i].name} for the train`, waitNote: `On the platform at ${loop.stops[i].name}, waiting for the train` }, end: times.alight + off[j] * S, stationWalk: there[i] + off[j] };
  }

  // ---------------------------------------------------------------------------------- car

  /** Every street a car can stop on: both ends on the ground, long enough, its middle the kerb. */
  private allKerbs(): Kerb[] {
    if (this.kerbs) return this.kerbs;
    const out: Kerb[] = [];
    const r = this.roads;
    if (r) {
      r.next.forEach((ns, a) =>
        ns.forEach((b) => {
          const A = r.nodes[a], B = r.nodes[b], len = flat(A, B);
          if (len < RIDE.kerbMin || Math.abs(A[1]) > 1e-6 || Math.abs(B[1]) > 1e-6) return;
          const dx = (B[0] - A[0]) / len, dz = (B[2] - A[2]) / len, nx = -dz, nz = dx, mx = (A[0] + B[0]) / 2, mz = (A[2] + B[2]) / 2;
          const side = ROAD_W / 2 + 0.12;
          const spot: CitySpot = { id: `kerb:${a}>${b}`, label: "The kerb, for an Atlas car", path: [[mx, STREET_Y, mz], [mx + nx * side, STREET_Y, mz + nz * side]], yaw: Math.atan2(-nx, -nz), inside: false, spread: 0.2 };
          out.push({ a, b, lane: [mx + nx * LANE_OFF, 0, mz + nz * LANE_OFF], spot, street: a < b ? `${a}-${b}` : `${b}-${a}` });
        }),
      );
    }
    return (this.kerbs = out);
  }

  /** Kerbs nearest a point, registered as places the agent can walk to. */
  private kerbsNear(p: Pt3): Kerb[] {
    const near = [...this.allKerbs()].sort((x, y) => flat(x.spot.path[1], p) - flat(y.spot.path[1], p)).slice(0, RIDE.kerbChoices);
    for (const k of near) if (!this.routes.places.spots.has(k.spot.id)) this.routes.places.spots.set(k.spot.id, k.spot);
    return near;
  }

  private kerbSpot(b: CarBooking, i: 0 | 1): SpotId {
    return b.kerbs[i];
  }

  private kerbBusy(street: string, from: number, to: number, except?: string): boolean {
    for (const b of CAR_BOOKINGS.values()) if (b.key !== except) for (const h of b.holds) if (h.street === street && h.from < to && from < h.to) return true;
    return false;
  }

  private carBusy(car: VehiclePlan, from: number, to: number): boolean {
    return (DETOURS.get(car.id) ?? []).some((d) => d.wall0 < to && from < d.wall1);
  }

  private car(personaId: string, from: Anchor, to: SpotId, depart: number): Candidate | null {
    const r = this.roads;
    if (!r || !this.carsRunning()) return null;
    const start = this.routes.point(from), dest = this.routes.spot(to);
    if (!start || !dest) return null;
    // Nearest kerbs by walk, each end.
    const ups = this.kerbsNear(start).map((k) => ({ k, walk: this.routes.travel(from, k.spot.id) })).filter((x) => Number.isFinite(x.walk)).sort((a, b) => a.walk - b.walk);
    const downs = this.kerbsNear(dest.path[0]).map((k) => ({ k, walk: this.routes.travel({ spot: k.spot.id }, to) })).filter((x) => Number.isFinite(x.walk)).sort((a, b) => a.walk - b.walk);
    let best: Candidate | null = null;
    // Each car's first workable pair of kerbs (nearest first); the car that gets the agent there soonest.
    for (const car of r.cars) {
      let b: CarBooking | null = null, down: (typeof downs)[number] | null = null;
      for (const u of ups) {
        for (const d of downs) {
          if (u.k.street === d.k.street) continue;
          b = this.book(personaId, car, u.k, d.k, depart, depart + u.walk * S);
          if (b) {
            down = d;
            break;
          }
        }
        if (b) break;
      }
      if (!b || !down) continue;
      const end = b.times.alight + down.walk * S;
      if (best && end >= best.end) continue;
      const option: LeisureOption = { id: `trip:car:${personaId}`, kind: "car", label: `Riding in an Atlas car to ${dest.label}`, spot: this.kerbSpot(b, 0), exit: this.kerbSpot(b, 1), stay: [0, 0] };
      best = { plan: { option, times: b.times, walkNote: "Walking to the kerb for an Atlas car", waitNote: "Waiting at the kerb for an Atlas car" }, end, stationWalk: 0, booking: b };
    }
    return best;
  }

  /** The car's own loop position at a wall time, ignoring any pickup: where it turns off and where it must rejoin. */
  private base(car: VehiclePlan, wall: number) {
    const t = trainClockAt(wall);
    return legsAt(car.legs, (((t + car.offset) % car.period) + car.period) % car.period);
  }

  /** The stretch of its loop (node to node) a car is on, from its position and heading. */
  private stretch(car: VehiclePlan, p: { x: number; z: number; dx: number; dz: number }): [number, number] | null {
    const r = this.roads!, route = car.atlasCar!.route;
    const l = Math.hypot(p.dx, p.dz);
    let best: [number, number] | null = null, bd = Infinity;
    for (let i = 0; i < route.length; i++) {
      const a = r.nodes[route[i]], b = r.nodes[route[(i + 1) % route.length]];
      const ex = b[0] - a[0], ez = b[2] - a[2], el = Math.hypot(ex, ez);
      if (el < 1e-6) continue;
      if (l > 1e-6 && (ex * p.dx + ez * p.dz) / (el * l) < 0.5) continue;
      const f = Math.max(0, Math.min(1, ((p.x - a[0]) * ex + (p.z - a[2]) * ez) / (el * el)));
      const d = Math.hypot(a[0] + ex * f - p.x, a[2] + ez * f - p.z);
      if (d < bd) [bd, best] = [d, [route[i], route[(i + 1) % route.length]]];
    }
    return best && bd < ROAD_W ? best : null;
  }

  /** Node path from a to b arriving not from `notFrom`, leaving a not back to `prev`; [a] when a is b and that is no U-turn. */
  private path(a: number, b: number, prev: number, notFrom: number): number[] | null {
    if (a === b) return notFrom === prev ? null : [a];
    const k = `${a}>${b}|${prev}|${notFrom}`;
    if (!this.paths.has(k)) {
      const r = this.roads!;
      this.paths.set(k, drive(r.nodes, r.next, a, b, prev, notFrom) ?? null);
    }
    return this.paths.get(k)!;
  }

  /**
   * A pickup with this car between these kerbs, the agent reaching the first kerb at `ready`, or null when the car is
   * busy, a kerb is taken, or the roads don't connect without turning round. The car turns off its loop at `depart`.
   */
  book(personaId: string, car: VehiclePlan, up: Kerb, down: Kerb, depart: number, ready: number): CarBooking | null {
    const r = this.roads!;
    const p = this.base(car, depart), on = this.stretch(car, p);
    if (!on) return null;
    const head = this.path(on[1], up.a, on[0], up.b);
    const mid = head && this.path(up.b, down.a, up.a, down.b);
    if (!head || !mid) return null;
    const node = (i: number) => r.nodes[i];
    const pc: Pt3 = [p.x, p.y, p.z];
    const kerbA: Pt3 = [(node(up.a)[0] + node(up.b)[0]) / 2, 0, (node(up.a)[2] + node(up.b)[2]) / 2];
    const kerbB: Pt3 = [(node(down.a)[0] + node(down.b)[0]) / 2, 0, (node(down.a)[2] + node(down.b)[2]) / 2];
    const centre = (ids: number[]) => ids.map(node);
    // Out to the first kerb and on to the second, in the right-hand lane; the first point is the car where it is.
    const toA = [pc, ...laneLine([pc, ...centre(head), kerbA]).slice(1)];
    const toB = laneLine([kerbA, ...centre(mid), kerbB]);
    toA[toA.length - 1] = toB[0];
    const length = (pts: Pt3[]) => pts.slice(1).reduce((n, q, i) => n + flat(pts[i], q), 0);
    const arrive = depart + (length(toA) / RIDE.speed) * S;
    const board = Math.max(arrive, ready) + RIDE.board * S;
    const leave = board + S;
    const drop = leave + (length(toB) / RIDE.speed) * S;
    const alight = drop + RIDE.alight * S;
    const free = drop + RIDE.kerbHold * S;
    // Back onto its loop where it would have been: the first moment the drive from the second kerb meets it there.
    const tails = new Map<string, Pt3[] | null>();
    let rejoin = -1, tail: Pt3[] = [];
    for (let w = free; w < free + (car.period + 120) * S; w += 500) {
      const v = this.base(car, w), at = this.stretch(car, v);
      if (!at) continue;
      const k = `${at[0]}>${at[1]}`;
      if (!tails.has(k)) {
        const ids = this.path(down.b, at[0], down.a, at[1]);
        tails.set(k, ids ? laneLine([kerbB, ...centre(ids), node(at[1])]).slice(0, -1) : null);
      }
      const t = tails.get(k);
      if (!t) continue;
      const pts = [...t, [v.x, v.y, v.z] as Pt3];
      if (free + (length(pts) / RIDE.speed) * S <= w) {
        rejoin = w;
        tail = pts;
        break;
      }
    }
    if (rejoin < 0) return null;
    if (this.carBusy(car, depart, rejoin)) return null;
    const holds = [
      { street: up.street, from: arrive, to: leave },
      { street: down.street, from: drop, to: rejoin - (length(tail) / RIDE.speed) * S },
    ];
    if (holds.some((h) => this.kerbBusy(h.street, h.from, h.to, personaId))) return null;
    // The legs: drive, wait at the first kerb, drive, wait at the second (and for its loop to come round), drive back on.
    const legs: Leg[] = [];
    const run = (pts: Pt3[]) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], d = flat(a, b);
        if (d > 1e-6) legs.push({ a: [a[0], a[2]], b: [b[0], b[2]], ya: a[1], yb: b[1], dur: d / RIDE.speed, hold: false });
      }
    };
    const wait = (at: Pt3, toward: Pt3, secs: number) => {
      if (secs > 0) legs.push({ a: [at[0], at[2]], b: [toward[0], toward[2]], ya: at[1], yb: at[1], dur: secs, hold: true });
    };
    run(toA);
    wait(toB[0], toB[1] ?? toB[0], (leave - arrive) / S);
    run(toB);
    const tailStart = rejoin - (length(tail) / RIDE.speed) * S;
    wait(tail[0], tail[1] ?? tail[0], (tailStart - drop) / S);
    run(tail);
    const detour: Detour = { id: `pickup:${personaId}`, wall0: depart, wall1: rejoin, legs };
    return { key: personaId, personaId, car, detour, kerbs: [up.spot.id, down.spot.id], holds, times: { board, alight, seat: "an Atlas car" } };
  }

  private commit(b: CarBooking) {
    const old = CAR_BOOKINGS.get(b.personaId);
    if (old && old !== b) this.cancel(old);
    CAR_BOOKINGS.set(b.personaId, b);
    // Drives that finished a while ago are forgotten.
    const stale = this.now() - 60 * S;
    const list = (DETOURS.get(b.car.id) ?? []).filter((d) => d.wall1 > stale);
    list.push(b.detour);
    DETOURS.set(b.car.id, list);
  }

  private cancel(b: CarBooking) {
    CAR_BOOKINGS.delete(b.personaId);
    const list = (DETOURS.get(b.car.id) ?? []).filter((d) => d !== b.detour);
    DETOURS.set(b.car.id, list);
  }
}

/** The routine env with trips by car and train added (routine.ts RoutineEnv.trip). */
export function withTrips(env: RoutineEnv, rides: CityRides, personaId: string): RoutineEnv {
  return { ...env, trip: (from, to, depart, mode) => rides.trip(personaId, from, to, depart, mode) };
}
