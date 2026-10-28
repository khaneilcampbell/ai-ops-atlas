import { hash } from "../mapLayout";
import { CLEAR, crossing, dist, pathClear, ringParam, ringPath, stairsOf, towerRing, type Pt, type Pt3, type Ring } from "./roads";
import type { Scene3D } from "./scene";

// Routes for the decorative vehicles: each one tours a district's stone paths, out from the plaza
// around its headquarters to each agent's house and back, stopping at the door, and over the road
// bridges to its neighbors' plazas and back. Pure data, so the routes can be checked against the map
// without rendering anything.

export type VehicleKind = "sedan" | "van" | "service";

export type { Pt };

/** One step of a vehicle's loop: drive from a to b, or wait at a (b is where it heads next). */
export interface Leg {
  a: Pt;
  b: Pt;
  /** Height above the terrace paving at a and at b: above zero only on a bridge. */
  ya: number;
  yb: number;
  /** Seconds this leg takes. */
  dur: number;
  hold: boolean;
}

export interface VehiclePlan {
  id: string;
  kind: VehicleKind;
  color: string;
  legs: Leg[];
  /** Seconds for one full loop. */
  period: number;
  /** Where in its loop the vehicle starts, in seconds, so they don't move in step. */
  offset: number;
}

/** At most this many vehicles, one per district, in the busiest districts. */
export const MAX_VEHICLES = 5;
const SPEED = 0.3; // world units per second, before each vehicle's own variation
const DOOR_GAP = 0.22;
const DELIVERY_S = 2.4;
const JUNCTION_S = 0.9;
/** A pause at the neighbor's plaza before heading home. */
const VISIT_S = 1.6;
/** Vehicles ease off a little on a bridge's ramps. */
const RAMP_PACE = 0.7;

const FLEET: { kind: VehicleKind; color: string }[] = [
  { kind: "sedan", color: "#2f4a3a" },
  { kind: "van", color: "#ece3cc" },
  { kind: "service", color: "#8fa58a" },
  { kind: "sedan", color: "#a88a4c" },
  { kind: "van", color: "#8fa58a" },
];

/** A spoke: from where the path leaves the plaza ring out to just short of the house's door. */
function spokeOf(c: Pt, g: Ring, house: { x: number; z: number; w: number; d: number }): Pt[] | null {
  const corners: Pt[] = [c, [house.x, c[1]], [house.x, house.z]];
  const raw = corners.filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > 1e-6);
  const within = (p: Pt) => p[0] > g.x0 && p[0] < g.x1 && p[1] > g.z0 && p[1] < g.z1;
  // Find where the path crosses the ring; everything before that is plaza.
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1];
    const b = raw[i];
    if (within(b)) continue;
    // Each leg runs along one axis, so the crossing is where that axis reaches the ring.
    const alongX = Math.abs(b[0] - a[0]) > 1e-6;
    const exit: Pt = alongX ? [b[0] > a[0] ? g.x1 : g.x0, a[1]] : [a[0], b[1] > a[1] ? g.z1 : g.z0];
    if (!within(a)) return null;
    const pts: Pt[] = [exit, ...raw.slice(i)];
    // Stop short of the house, facing its door.
    const end = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const len = dist(prev, end);
    const half = Math.abs(end[0] - prev[0]) > 1e-6 ? house.w / 2 : house.d / 2;
    const keep = len - half - DOOR_GAP;
    if (keep < 0.05) {
      if (pts.length < 3) return null;
      pts.pop();
      return pts;
    }
    pts[pts.length - 1] = [prev[0] + ((end[0] - prev[0]) * keep) / len, prev[1] + ((end[1] - prev[1]) * keep) / len];
    return pts;
  }
  return null;
}

export function planVehicles(scene: Scene3D): VehiclePlan[] {
  const districts = scene.towers
    .map((t) => {
      const houses = scene.houses.filter((h) => h.projectId === t.projectId);
      // The plaza is the smallest square of paving centered on the tower.
      const plaza = scene.paving
        .filter((p) => p.w > t.size && Math.abs(p.x + p.w / 2 - t.x) < 1e-6 && Math.abs(p.z + p.d / 2 - t.z) < 1e-6 && Math.abs(p.w - p.d) < 1e-6)
        .sort((a, b) => a.w - b.w)[0];
      return { t, houses, plaza };
    })
    .filter((d) => d.plaza && d.houses.length >= 2)
    .sort((a, b) => b.houses.length - a.houses.length || a.t.key.localeCompare(b.t.key))
    .slice(0, MAX_VEHICLES);

  return districts.flatMap(({ t, houses, plaza }, i) => {
    const c: Pt = [t.x, t.z];
    // A lane around the tower, inside the plaza. Vehicles never use its front side, where the
    // entrance stairs are; they go round the back instead.
    const g: Ring | null = towerRing(t, plaza.w);
    if (!g) return [];
    const stairs = stairsOf(t);
    const stalls = scene.kiosks.filter((k) => k.projectId === t.projectId).map((k) => ({ x: k.x, z: k.z, w: k.size, d: k.size }));
    // A path that runs past another house's or a kiosk's walls (some do, to reach the house behind) is skipped.
    const clear = (pts: Pt[]) => pathClear(pts, [...houses, ...stalls, stairs], CLEAR);
    const spokes = houses.map((h) => spokeOf(c, g, h)).filter((s): s is Pt[] => !!s && clear(s));
    if (!spokes.length) return [];
    // Trips over each of the district's bridges, to the neighbor's plaza and back.
    const trips = scene.carBridges.flatMap((br) => {
      const end = br.ends.indexOf(t.projectId);
      return end < 0 ? [] : [{ out: crossing(br, end as 0 | 1), back: crossing(br, (1 - end) as 0 | 1) }];
    });
    const stops = [...spokes.map((sp) => ({ exit: sp[0], sp, trip: null })), ...trips.map((trip) => ({ exit: [trip.out[0][0], trip.out[0][2]] as Pt, sp: null, trip }))].sort(
      (a, b) => ringParam(g, a.exit) - ringParam(g, b.exit),
    );
    const { kind, color } = FLEET[i % FLEET.length];
    const speed = SPEED * (0.85 + 0.3 * hash(`${t.key}:speed`));
    const legs: Leg[] = [];
    const flat = (pts: Pt[]): Pt3[] => pts.map((p) => [p[0], 0, p[1]]);
    const drive = (pts: Pt3[]) => {
      for (let k = 1; k < pts.length; k++) {
        const [a, b] = [pts[k - 1], pts[k]];
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const pace = a[1] !== b[1] ? RAMP_PACE : 1;
        if (len > 1e-6) legs.push({ a: [a[0], a[2]], b: [b[0], b[2]], ya: a[1], yb: b[1], dur: len / (speed * pace), hold: false });
      }
    };
    const wait = (at: Pt3, next: Pt3, s: number) => legs.push({ a: [at[0], at[2]], b: [next[0], next[2]], ya: at[1], yb: at[1], dur: s, hold: true });
    stops.forEach((st, k) => {
      const next = stops[(k + 1) % stops.length];
      if (st.sp) {
        const sp = flat(st.sp);
        // Sometimes wait at the junction before turning off the plaza.
        if (hash(`${t.key}:${k}:junction`) > 0.5) wait(sp[0], sp[1], JUNCTION_S);
        drive(sp);
        const back = [...sp].reverse();
        wait(back[0], back[1], DELIVERY_S);
        drive(back);
      } else if (st.trip) {
        const { out, back } = st.trip;
        drive(out);
        wait(back[0], back[1], VISIT_S);
        drive(back);
      }
      drive(flat([st.exit, ...ringPath(g, st.exit, next.exit)]));
    });
    const period = legs.reduce((s, l) => s + l.dur, 0);
    return [{ id: t.key, kind, color, legs, period, offset: hash(`${t.key}:offset`) * period }];
  });
}

/**
 * Where a vehicle is at time t, its height above the terrace paving, which way it should face (for
 * a wait, the way it leaves) and how steeply it climbs (rise over run).
 */
export function vehicleAt(v: VehiclePlan, t: number): { x: number; y: number; z: number; dx: number; dz: number; slope: number } {
  let u = (((t + v.offset) % v.period) + v.period) % v.period;
  const at = (l: Leg, f: number) => {
    const run = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    return {
      x: l.a[0] + (l.b[0] - l.a[0]) * f,
      y: l.ya + (l.yb - l.ya) * f,
      z: l.a[1] + (l.b[1] - l.a[1]) * f,
      dx: l.b[0] - l.a[0],
      dz: l.b[1] - l.a[1],
      slope: l.hold || run < 1e-6 ? 0 : (l.yb - l.ya) / run,
    };
  };
  for (const l of v.legs) {
    if (u <= l.dur) return at(l, l.hold ? 0 : u / l.dur);
    u -= l.dur;
  }
  return at(v.legs[v.legs.length - 1], 1);
}
