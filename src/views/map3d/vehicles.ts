import { hash } from "../mapLayout";
import type { Scene3D } from "./scene";

// Routes for the decorative vehicles: each one tours a district's stone paths, out from the plaza
// around its headquarters to each agent's house and back, stopping at the door. Pure data, so the
// routes can be checked against the map without rendering anything.

export type VehicleKind = "sedan" | "van" | "service";

export type Pt = [number, number];

/** One step of a vehicle's loop: drive from a to b, or wait at a (b is where it heads next). */
export interface Leg {
  a: Pt;
  b: Pt;
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
/** How far a vehicle's center keeps from any wall: half its width and a little air. */
const CLEAR = 0.08;
/** The tower's entrance stairs and flowerbeds reach this far out from its front. */
const ENTRANCE = 0.26;
/** And from the plaza's edge, so wheels stay on the paving. */
const EDGE = 0.08;
/** How far out from the tower's walls the plaza lane runs. */
const LANE = 0.15;

const FLEET: { kind: VehicleKind; color: string }[] = [
  { kind: "sedan", color: "#2f4a3a" },
  { kind: "van", color: "#ece3cc" },
  { kind: "service", color: "#8fa58a" },
  { kind: "sedan", color: "#a88a4c" },
  { kind: "van", color: "#8fa58a" },
];

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The lane around a tower: a rectangle, wider on the entrance side. */
interface Ring {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Position along the ring by distance s, counterclockwise from its -x,-z corner. */
function ringPoint(g: Ring, s: number): Pt {
  const w = g.x1 - g.x0;
  const d = g.z1 - g.z0;
  const total = 2 * (w + d);
  s = ((s % total) + total) % total;
  if (s <= w) return [g.x0 + s, g.z0];
  if (s <= w + d) return [g.x1, g.z0 + s - w];
  if (s <= 2 * w + d) return [g.x1 - (s - w - d), g.z1];
  return [g.x0, g.z1 - (s - 2 * w - d)];
}
function ringParam(g: Ring, p: Pt): number {
  const w = g.x1 - g.x0;
  const d = g.z1 - g.z0;
  if (Math.abs(p[1] - g.z0) < 1e-6) return p[0] - g.x0;
  if (Math.abs(p[0] - g.x1) < 1e-6) return w + p[1] - g.z0;
  if (Math.abs(p[1] - g.z1) < 1e-6) return w + d + g.x1 - p[0];
  return 2 * w + d + g.z1 - p[1];
}
/**
 * Points along the ring from one exit to another, corners included. Goes counterclockwise unless
 * that would cross in front of the tower, where the entrance stairs are; then it goes round the back.
 */
function ringPath(g: Ring, from: Pt, to: Pt): Pt[] {
  const w = g.x1 - g.x0;
  const d = g.z1 - g.z0;
  const corners = [0, w, w + d, 2 * w + d];
  const total = 2 * (w + d);
  const walk = (a: Pt, b: Pt) => {
    const s0 = ringParam(g, a);
    let s1 = ringParam(g, b);
    if (s1 < s0 - 1e-6) s1 += total;
    const pts: Pt[] = [];
    for (const k of [0, 1])
      for (const cs of corners) {
        const at = cs + k * total;
        if (at > s0 + 1e-6 && at < s1 - 1e-6) pts.push(ringPoint(g, at));
      }
    return pts;
  };
  const ccw = walk(from, to);
  if (!ccw.some((p) => Math.abs(p[1] - g.z1) < 1e-6)) return [...ccw, to];
  return [...walk(to, from).reverse(), to];
}

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
    const lane = Math.min(plaza.w / 2 - EDGE, t.size / 2 + LANE);
    if (lane < t.size / 2 + CLEAR) return [];
    const g: Ring = { x0: t.x - lane, z0: t.z - lane, x1: t.x + lane, z1: t.z + lane };
    const stairs = { x: t.x, z: t.z + t.size / 2 + ENTRANCE / 2, w: t.size, d: ENTRANCE };
    const stalls = scene.kiosks.filter((k) => k.projectId === t.projectId).map((k) => ({ x: k.x, z: k.z, w: k.size, d: k.size }));
    // A path that runs past another house's or a kiosk's walls (some do, to reach the house behind) is skipped.
    const clear = (pts: Pt[]) =>
      pts.every((p, k) => {
        if (!k) return true;
        const a = pts[k - 1];
        const n = Math.ceil(dist(a, p) / 0.05);
        for (let j = 0; j <= n; j++) {
          const x = a[0] + ((p[0] - a[0]) * j) / n;
          const z = a[1] + ((p[1] - a[1]) * j) / n;
          if ([...houses, ...stalls, stairs].some((h) => Math.abs(x - h.x) < h.w / 2 + CLEAR && Math.abs(z - h.z) < h.d / 2 + CLEAR)) return false;
        }
        return true;
      });
    const spokes = houses
      .map((h) => spokeOf(c, g, h))
      .filter((s): s is Pt[] => !!s && clear(s))
      .sort((a, b) => ringParam(g, a[0]) - ringParam(g, b[0]));
    if (!spokes.length) return [];
    const { kind, color } = FLEET[i % FLEET.length];
    const speed = SPEED * (0.85 + 0.3 * hash(`${t.key}:speed`));
    const legs: Leg[] = [];
    const drive = (pts: Pt[]) => {
      for (let k = 1; k < pts.length; k++) {
        const len = dist(pts[k - 1], pts[k]);
        if (len > 1e-6) legs.push({ a: pts[k - 1], b: pts[k], dur: len / speed, hold: false });
      }
    };
    const wait = (at: Pt, next: Pt, s: number) => legs.push({ a: at, b: next, dur: s, hold: true });
    spokes.forEach((sp, k) => {
      const next = spokes[(k + 1) % spokes.length];
      // Sometimes wait at the junction before turning off the plaza.
      if (hash(`${t.key}:${k}:junction`) > 0.5) wait(sp[0], sp[1], JUNCTION_S);
      drive(sp);
      const back = [...sp].reverse();
      wait(back[0], back[1], DELIVERY_S);
      drive(back);
      drive([sp[0], ...ringPath(g, sp[0], next[0])]);
    });
    const period = legs.reduce((s, l) => s + l.dur, 0);
    return [{ id: t.key, kind, color, legs, period, offset: hash(`${t.key}:offset`) * period }];
  });
}

/** Where a vehicle is at time t, and which way it should face (for a wait, the way it leaves). */
export function vehicleAt(v: VehiclePlan, t: number): { x: number; z: number; dx: number; dz: number } {
  let u = (((t + v.offset) % v.period) + v.period) % v.period;
  for (const l of v.legs) {
    if (u <= l.dur) {
      const f = l.hold ? 0 : u / l.dur;
      return { x: l.a[0] + (l.b[0] - l.a[0]) * f, z: l.a[1] + (l.b[1] - l.a[1]) * f, dx: l.b[0] - l.a[0], dz: l.b[1] - l.a[1] };
    }
    u -= l.dur;
  }
  const l = v.legs[v.legs.length - 1];
  return { x: l.b[0], z: l.b[1], dx: l.b[0] - l.a[0], dz: l.b[1] - l.a[1] };
}
