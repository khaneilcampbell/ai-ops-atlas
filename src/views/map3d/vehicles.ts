import {TRANSPORT} from "./transportScale";
import {lanePath} from "./highway";
import { hash } from "../mapLayout";
import { LANE_OFF, ROAD_W, type Pt, type Pt3, type Ring } from "./roads";
import { buildStreetGraph, plazaRings, streetLines } from "./streetGraph";
import type { Scene3D } from "./scene";

// Routes for the decorative vehicles: closed loops on the city's streets (see planVehicles), driven
// in the right-hand lane with a stop before every junction. Pure data, so the routes can be checked
// against the map without rendering anything.

export type VehicleKind = "sedan" | "van" | "service" | "sports" | "delivery" | "parcel" | "bus" | "taxi" | "pickup" | "semi" | "gwagon" | "bmw" | "convertible";

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
  serviceWindow?: {start:number;duration:number};
}

/** At most this many vehicles, one per district, in the busiest districts. */
export const MAX_VEHICLES = 24;
const SPEED = 0.36; // world units per second, before each vehicle's own variation
const FLEET: { kind: VehicleKind; color: string }[] = [
  { kind: "taxi", color: "#edbd35" },
  { kind: "pickup", color: "#17232c" },
  { kind: "semi", color: "#293f4d" },
  { kind: "gwagon", color: "#161e24" },
  { kind: "bmw", color: "#3577c4" },
  { kind: "convertible", color: "#b94034" },
  { kind: "delivery", color: "#294657" },
  { kind: "parcel", color: "#1f3b4d" },
  { kind: "bus", color: "#f1eee1" },
  { kind: "van", color: "#ece3cc" },
  { kind: "service", color: "#8fa58a" },
  { kind: "sedan", color: "#a88a4c" },
  { kind: "van", color: "#8fa58a" },
  { kind: "sports", color: "#a63836" },
  { kind: "sedan", color: "#c5ced6" },
  { kind: "delivery", color: "#294657" },
  { kind: "van", color: "#d9b971" },
  { kind: "parcel", color: "#1f3b4d" },
];

/** Seconds a vehicle waits at the stop line before driving into a junction. */
export const JUNCTION_STOP = 0.8;
/** How far before the centre of a junction the stop line sits. */
const STOP_BACK = 0.48;

/**
 * City traffic as a street system (KC, 2026-11-08): every vehicle drives a closed loop on the street
 * network, so none ever turns round in the road. Dead-end spurs are left out of the network first
 * (a car would have to U-turn at the end), so every remaining street leads on to another. Each loop
 * keeps to the lane on the right of the centre line all the way round, stops at the stop line
 * before every junction, and has a twin driving the same streets the other way. Round a
 * headquarters plaza the car on the tower side keeps to the plaza line and the other passes outside
 * it; streets that would bring a car against a tower or its entrance stairs are left to pedestrians.
 */
export function planVehicles(scene: Scene3D): VehiclePlan[] {
  const graph = drivingGraph(scene);
  if (!graph) return [];
  const { nodes, next, lane } = graph;
  const inDistrict = (p: Pt3) => scene.terraces.find(t => p[0] >= t.x && p[0] <= t.x + t.w && p[2] >= t.z && p[2] <= t.z + t.d)?.id;
  const canDrive = (loop: number[]) => loop.every((a, i) => next[a].includes(loop[(i + 1) % loop.length]));
  const keyOf = (loop: number[]) => [...loop].sort((a, b) => a - b).join(",");
  // Each loop together with its reverse.
  const loops: number[][] = [];
  const starts = nodes.map((_, i) => i).filter(i => next[i].length >= 1);
  for (let seed = 0; loops.length < MAX_VEHICLES - 1 && seed < 600; seed++) {
    const loop = driveLoop(nodes, next, starts[Math.floor(hash(`loop:${seed}`) * starts.length)], seed);
    if (!loop) continue;
    const length = loop.reduce((n, a, i) => n + flatLen(nodes[a], nodes[loop[(i + 1) % loop.length]]), 0);
    const districts = new Set(loop.map(i => inDistrict(nodes[i])).filter(Boolean));
    if (length < 18 || districts.size < 3 || loops.some(l => keyOf(l) === keyOf(loop) && l[0] === loop[0] && l[1] === loop[1])) continue;
    // A loop a twin can drive the other way gets one, so two-way streets carry traffic both ways;
    // a loop on a one-way street drives it only its signed way.
    const back = [...loop].reverse();
    if (canDrive(back)) loops.push(loop, back);
    else loops.push(loop);
  }
  // Fewer distinct loops than vehicles (a small city): more cars share them, spaced round the loop.
  return Array.from({ length: loops.length ? MAX_VEHICLES : 0 }, (_, k) => {
    const order = loops[k % loops.length], share = Math.floor(k / loops.length);
    const legs = loopLegs(order.map(n => nodes[n]), order.map(n => next[n].length >= 3), order.map((n, i) => lane(n, order[(i + 1) % order.length])), SPEED);
    const period = legs.reduce((n, l) => n + l.dur, 0);
    return { id: `city:traffic:${k}`, ...FLEET[k % FLEET.length], legs, period, offset: ((hash(`city:${k % loops.length}:offset`) + share * 0.37) % 1) * period };
  });
}

const flatLen = (a: Pt3, b: Pt3) => Math.hypot(b[0] - a[0], b[2] - a[2]);

/**
 * The street graph with every dead-end spur trimmed away, so each street leads on to another.
 * `lane(a, b)` is how far right of the centre line a car drives from node a to node b: half a lane
 * on a street; on a headquarters plaza lane, which is drawn hugging the tower, the car on the
 * tower side keeps to the plaza line and the other passes outside it.
 */
export function drivingGraph(scene: Scene3D): { nodes: Pt3[]; next: number[][]; lane: (a: number, b: number) => number; oneWay: OneWayStreet[] } | undefined {
  const g = buildStreetGraph(withCrossings(streetLines(scene, { drive: true })));
  const rings = [...plazaRings(scene).values()];
  const on = (p: Pt3, x: number | null, z: number | null) => (x === null || Math.abs(p[0] - x) < 1e-6) && (z === null || Math.abs(p[2] - z) < 1e-6);
  const within = (p: Pt3, r: Ring) => p[0] > r.x0 - 1e-6 && p[0] < r.x1 + 1e-6 && p[2] > r.z0 - 1e-6 && p[2] < r.z1 + 1e-6;
  const ringOf = (a: Pt3, b: Pt3) => rings.find(r => within(a, r) && within(b, r) && ([r.x0, r.x1].some(x => on(a, x, null) && on(b, x, null)) || [r.z0, r.z1].some(z => on(a, null, z) && on(b, null, z))));
  const lane = (i: number, j: number) => {
    const a = g.nodes[i], b = g.nodes[j], r = ringOf(a, b);
    if (!r) return LANE_OFF;
    const dx = b[0] - a[0], dz = b[2] - a[2], cx = (r.x0 + r.x1) / 2 - (a[0] + b[0]) / 2, cz = (r.z0 + r.z1) / 2 - (a[2] + b[2]) / 2;
    return -dz * cx + dx * cz > 0 ? 0 : 2 * LANE_OFF;
  };
  // A street whose lanes would brush a tower or its entrance stairs is left to pedestrians.
  const towerHit = (x: number, z: number) => scene.towers.some(w => Math.abs(x - w.x) < w.size / 2 + 0.1 && z > w.z - w.size / 2 - 0.1 && z < w.z + w.size / 2 + 0.24 + 0.1) || scene.kiosks.some(k => Math.abs(x - k.x) < k.size / 2 + 0.2 && Math.abs(z - k.z) < k.size / 2 + 0.2);
  const brushes = (i: number, j: number) => {
    const a = g.nodes[i], b = g.nodes[j], l = flatLen(a, b) || 1, nx = -(b[2] - a[2]) / l, nz = (b[0] - a[0]) / l;
    const off = lane(i, j), steps = Math.ceil(l / 0.05);
    for (let s = 0; s <= steps; s++) { const f = s / steps; if (towerHit(a[0] + (b[0] - a[0]) * f + nx * off, a[2] + (b[2] - a[2]) * f + nz * off)) return true; }
    return false;
  };
  const both = g.edges.map((list, i) => [...new Set(list.map(e => e.to))].filter(j => !brushes(i, j) && !brushes(j, i)));
  // New York style one-way cross streets: drive each east-west street only its signed way, as long
  // as every junction can still reach every other (a street that would strand a corner of the
  // city, as in the smaller groupings, stays two-way).
  const isPlaza = (i: number, j: number) => !!ringOf(g.nodes[i], g.nodes[j]);
  const directed = (streets: OneWayStreet[]) => both.map((list, i) => list.filter(j => {
    const a = g.nodes[i], b = g.nodes[j];
    if (Math.abs(a[2] - b[2]) > 1e-6 || isPlaza(i, j)) return true;
    const street = streets.find(s => s.zs.some(z => Math.abs(z - a[2]) < ONE_WAY_Z));
    return !street || Math.sign(b[0] - a[0]) === street.dir;
  }));
  const base = leadOn(both), city = base.flatMap((l, i) => (l.length ? [i] : []));
  let oneWay: OneWayStreet[] = [], kept = base;
  // Alternate block by block: each street tries the other way from the one before it first.
  for (const zs of oneWayStreets(g.nodes, both, isPlaza)) {
    const prefer = (oneWay.length ? -oneWay[oneWay.length - 1].dir : 1) as 1 | -1;
    for (const dir of [prefer, -prefer as 1 | -1]) {
      const tryWith = [...oneWay, { zs, dir }], graph = leadOn(directed(tryWith));
      if (stronglyConnected(graph, city)) { oneWay = tryWith; kept = graph; break; }
    }
  }
  return kept.some(l => l.length) ? { nodes: g.nodes, next: kept, lane, oneWay } : undefined;
}

/** A one-way cross street: the z of each of its runs (it may step to meet a bridge), and +1 for eastbound or -1 for westbound. */
export interface OneWayStreet { zs: number[]; dir: 1 | -1 }

/**
 * Peel off ends until every street that is left leads on: each junction has a way in and a way
 * out, and joins at least two others, so no street ends in a U-turn; and no car drives into a
 * junction whose only way on is straight back (where a one-way street meets it head on).
 */
function leadOn(lists: number[][]): number[][] {
  const next = lists.map(l => [...l]), alive = next.map(l => l.length > 0);
  for (let changed = true; changed; ) {
    changed = false;
    const into = next.map(() => new Set<number>());
    next.forEach((list, i) => { if (alive[i]) for (const j of list) if (alive[j]) into[j].add(i); });
    next.forEach((list, i) => {
      if (!alive[i]) return;
      const out = list.filter(j => alive[j]);
      if (!out.length || !into[i].size || new Set([...out, ...into[i]]).size < 2) { alive[i] = false; changed = true; }
    });
    next.forEach((list, i) => {
      if (!alive[i]) return;
      for (let k = list.length - 1; k >= 0; k--) {
        const j = list[k];
        if (alive[j] && !next[j].some(n => n !== i && alive[n])) { list.splice(k, 1); changed = true; }
      }
    });
  }
  return next.map((list, i) => (alive[i] ? list.filter(j => alive[j]) : []));
}

/** Can every junction in `nodes` be driven to from every other in this graph? */
function stronglyConnected(next: number[][], nodes: number[]): boolean {
  if (!nodes.length) return true;
  if (nodes.some(i => !next[i].length)) return false;
  const reach = (lists: number[][]) => { const seen = new Set([nodes[0]]), todo = [nodes[0]]; while (todo.length) for (const j of lists[todo.pop()!]) if (!seen.has(j)) { seen.add(j); todo.push(j); } return seen; };
  const back = next.map(() => [] as number[]);
  next.forEach((list, i) => list.forEach(j => back[j].push(i)));
  const fwd = reach(next), rev = reach(back);
  return nodes.every(i => fwd.has(i) && rev.has(i));
}

/** Points on an east-west street this close in z belong to it. */
const ONE_WAY_Z = 0.05;
/** Only a street at least this long counts as a cross street; shorter runs are links and stay two-way. */
export const CROSS_STREET_MIN = 9;
/** East-west runs closer together than this are one cross street that steps (to meet a bridge, say). */
const CORRIDOR = 1.5;

/**
 * The candidate one-way cross streets (Khaneil, 2026-11-13, "set up like New York city streets"),
 * north to south, as the z of each street's runs: the east-west streets between the north and
 * south boulevards. drivingGraph signs them eastbound and westbound in turn, as Manhattan's are.
 * The boulevards (the northernmost and southernmost cross streets), the avenues (north-south) and
 * the plaza lanes stay two-way.
 */
export function oneWayStreets(nodes: Pt3[], next: number[][], isPlaza: (i: number, j: number) => boolean): number[][] {
  const runs = new Map<number, number>();
  next.forEach((list, i) => list.forEach(j => {
    const a = nodes[i], b = nodes[j];
    if (j < i || Math.abs(a[2] - b[2]) > 1e-6 || isPlaza(i, j)) return;
    const z = [...runs.keys()].find(k => Math.abs(k - a[2]) < ONE_WAY_Z) ?? a[2];
    runs.set(z, (runs.get(z) ?? 0) + Math.abs(b[0] - a[0]));
  }));
  // Runs a few metres apart are one corridor (a street that steps to meet a bridge): one direction.
  const corridors: { zs: number[]; len: number }[] = [];
  for (const [z, len] of [...runs].sort((a, b) => a[0] - b[0])) {
    const last = corridors[corridors.length - 1];
    if (last && z - last.zs[last.zs.length - 1] < CORRIDOR) { last.zs.push(z); last.len += len; } else corridors.push({ zs: [z], len });
  }
  const streets = corridors.filter(c => c.len >= CROSS_STREET_MIN);
  return streets.slice(1, -1).map(c => c.zs);
}

/** Adds a point wherever two streets cross mid-way, so the crossing is a junction in the graph. */
function withCrossings(lines: Pt3[][]): Pt3[][] {
  const segs = lines.flatMap((l, li) => l.slice(1).map((b, i) => ({ li, i, a: l[i], b })));
  const extra = new Map<string, Pt3[]>();
  for (let u = 0; u < segs.length; u++) for (let v = u + 1; v < segs.length; v++) {
    const p = segs[u], q = segs[v];
    if (p.li === q.li) continue;
    const rx = p.b[0] - p.a[0], rz = p.b[2] - p.a[2], sx = q.b[0] - q.a[0], sz = q.b[2] - q.a[2], den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((q.a[0] - p.a[0]) * sz - (q.a[2] - p.a[2]) * sx) / den, w = ((q.a[0] - p.a[0]) * rz - (q.a[2] - p.a[2]) * rx) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6 || w <= 1e-6 || w >= 1 - 1e-6) continue;
    // Only at street level: a bridge deck passes over what it crosses.
    const y1 = p.a[1] + (p.b[1] - p.a[1]) * t, y2 = q.a[1] + (q.b[1] - q.a[1]) * w;
    if (y1 > 1e-6 || y2 > 1e-6) continue;
    const at: Pt3 = [p.a[0] + rx * t, 0, p.a[2] + rz * t];
    for (const s of [p, q]) { const k = `${s.li}:${s.i}`; extra.set(k, [...(extra.get(k) ?? []), at]); }
  }
  return lines.map((l, li) => l.flatMap((b, i) => {
    if (!i) return [b];
    const a = l[i - 1], cuts = (extra.get(`${li}:${i - 1}`) ?? []).sort((x, y) => flatLen(a, x) - flatLen(a, y));
    return [...cuts, b];
  }));
}

/**
 * A closed drive from a start node: at each junction take any street but the one just driven
 * (preferring straight on), until the drive comes back to a street it already drove in the same
 * direction. The repeating part is the loop.
 */
function driveLoop(nodes: Pt3[], next: number[][], start: number, seed: number): number[] | undefined {
  const path = [start, next[start][Math.floor(hash(`first:${seed}`) * next[start].length)]];
  const seen = new Map<string, number>([[`${path[0]}>${path[1]}`, 0]]);
  for (let step = 0; step < 600; step++) {
    const [p, c] = [path[path.length - 2], path[path.length - 1]];
    const dx = nodes[c][0] - nodes[p][0], dz = nodes[c][2] - nodes[p][2], l = Math.hypot(dx, dz) || 1;
    const straightness = (n: number) => { const ex = nodes[n][0] - nodes[c][0], ez = nodes[n][2] - nodes[c][2]; return (dx * ex + dz * ez) / (l * (Math.hypot(ex, ez) || 1)); };
    // Never back the way it came, not even by a short link between two road ends.
    const options = next[c].filter(n => n !== p && straightness(n) > -0.5);
    if (!options.length) return;
    // Straight on twice as often as a turn: through traffic, with some turning off.
    const weights = options.map(n => (straightness(n) > 0.9 ? 2 : 1));
    let pick = hash(`turn:${seed}:${step}`) * weights.reduce((a, b) => a + b, 0), n = options[0];
    for (let i = 0; i < options.length; i++) { pick -= weights[i]; if (pick <= 0) { n = options[i]; break; } }
    const key = `${c}>${n}`;
    const at = seen.get(key);
    if (at !== undefined) return path.slice(at, path.length - 1);
    seen.set(key, path.length - 1);
    path.push(n);
  }
}

/**
 * Legs for one closed loop of street points: shifted into the right-hand lane all the way round,
 * with a stop at the stop line before each junction.
 */
function loopLegs(points: Pt3[], junction: boolean[], laneOf: number[], speed: number): Leg[] {
  // Stop lines: a point just short of each junction, where the vehicle waits. `lanes` is the
  // offset of the stretch leaving each point.
  const pts: Pt3[] = [], stops: boolean[] = [], lanes: number[] = [];
  points.forEach((p, i) => {
    const prev = points[(i - 1 + points.length) % points.length], len = flatLen(prev, p);
    if (junction[i] && len > STOP_BACK + 0.12) {
      const f = 1 - STOP_BACK / len;
      pts.push([prev[0] + (p[0] - prev[0]) * f, prev[1] + (p[1] - prev[1]) * f, prev[2] + (p[2] - prev[2]) * f]);
      stops.push(true); lanes.push(laneOf[(i - 1 + points.length) % points.length]);
    }
    pts.push(p); stops.push(false); lanes.push(laneOf[i]);
  });
  let lane = keepRightLoop(pts, lanes);
  // Where two bends sit closer together than the lane is wide, the shifted points can step back on
  // themselves; drop such a point so the drive never reverses, even for a moment.
  for (let changed = true; changed && lane.length > 3; ) {
    changed = false;
    for (let k = 0; k < lane.length; k++) {
      const a = lane[(k - 1 + lane.length) % lane.length], b = lane[k], c = lane[(k + 1) % lane.length];
      const ux = b[0] - a[0], uz = b[2] - a[2], wx = c[0] - b[0], wz = c[2] - b[2], lu = Math.hypot(ux, uz), lw = Math.hypot(wx, wz);
      if (lu > 1e-7 && lw > 1e-7 && (ux * wx + uz * wz) / (lu * lw) < -0.5) { lane.splice(k, 1); stops.splice(k, 1); lanes.splice(k, 1); changed = true; break; }
    }
  }
  lane = lane.slice();
  const legs: Leg[] = [];
  for (let k = 0; k < lane.length; k++) {
    const a = lane[k], b = lane[(k + 1) % lane.length], length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (stops[k]) legs.push({ a: [a[0], a[2]], b: [b[0], b[2]], ya: a[1], yb: a[1], dur: JUNCTION_STOP, hold: true });
    if (length > 1e-7) legs.push({ a: [a[0], a[2]], b: [b[0], b[2]], ya: a[1], yb: b[1], dur: length / (speed * (a[1] !== b[1] ? 0.7 : 1)), hold: false });
  }
  return legs;
}

/**
 * Every point of a closed loop moved into the lane on its right, mitred at the bends. off[i] is the
 * offset of the stretch leaving point i; where it changes, the point takes the offset stretch's shift.
 */
function keepRightLoop(pts: Pt3[], offs: number[]): Pt3[] {
  const right = (p: Pt3, q: Pt3) => { const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l] as const; };
  const n = pts.length;
  return pts.map((p, i) => {
    let a = (i - 1 + n) % n, b = (i + 1) % n;
    // Skip repeated points so a stop line never makes a zero-length direction.
    while (flatLen(pts[a], p) < 1e-7 && a !== i) a = (a - 1 + n) % n;
    while (flatLen(p, pts[b]) < 1e-7 && b !== i) b = (b + 1) % n;
    const n1 = right(pts[a], p), n2 = right(p, pts[b]), o1 = offs[a], o2 = offs[i];
    // At a corner between two lane widths (onto or off a plaza lane): where the two offset lines meet.
    const det = n1[0] * n2[1] - n1[1] * n2[0];
    if (Math.abs(o1 - o2) > 1e-9 && Math.abs(det) > 0.3) return [p[0] + (o1 * n2[1] - o2 * n1[1]) / det, p[1], p[2] + (n1[0] * o2 - n2[0] * o1) / det];
    if (Math.abs(o1 - o2) > 1e-9) { const [n, o] = o1 > o2 ? [n1, o1] : [n2, o2]; return [p[0] + n[0] * o, p[1], p[2] + n[1] * o]; }
    const k = o1 / Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    // On the outside of a corner, the car cuts the corner a little rather than leave the road.
    const mx = (n1[0] + n2[0]) * k, mz = (n1[1] + n2[1]) * k, m = Math.hypot(mx, mz), cap = ROAD_W / 2 / Math.max(m, ROAD_W / 2);
    return [p[0] + mx * cap, p[1], p[2] + mz * cap];
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

/** Seconds a service car always has left in its interval, so a visit never overruns the next. */
const DEALER_VISIT_SLACK=8;
/** Service visits are decorative and share the exact driveway/bridge centerline. */
export function planDealershipTraffic(scene:Pick<Scene3D,'dealership'>):VehiclePlan[]{
 const d=scene.dealership;if(!d)return [];
 const source=[...d.service,...d.drive.slice(1),[d.x+d.showroom.cx+d.showroom.w/2+.06,d.z+d.showroom.cz] as Pt].filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>1e-7);
 return [{id:'bmw-service-out',interval:60,path:[...source].reverse(),kind:'bmw' as const,color:'#3577c4'}, {id:'bmw-service-in',interval:90,path:source,kind:'gwagon' as const,color:'#202a30'}].map(v=>{
  const path=lanePath(v.path,TRANSPORT.cityLaneOffset),length=path.slice(1).reduce((n,b,i)=>n+Math.hypot(b[0]-path[i][0],b[1]-path[i][1]),0);
  // Cruise at .9, but speed up on a longer drive so every visit ends well inside its interval.
  const speed=Math.max(.9,length/(v.interval-DEALER_VISIT_SLACK));
  const legs:Leg[]=path.slice(1).map((b,i)=>({a:path[i],b,ya:.03,yb:.03,dur:Math.hypot(b[0]-path[i][0],b[1]-path[i][1])/speed,hold:false}));
  const duration=legs.reduce((n,l)=>n+l.dur,0),end=v.path[v.path.length-1];
  legs.push({a:end,b:end,ya:.03,yb:.03,dur:Math.max(.1,v.interval-duration),hold:true});
  return {id:v.id,kind:v.kind,color:v.color,legs,period:v.interval,offset:0,serviceWindow:{start:v.interval,duration}};
 });
}
export function vehicleVisible(v:VehiclePlan,seconds:number){return !v.serviceWindow||(seconds>=v.serviceWindow.start&&seconds%v.period<v.serviceWindow.duration);}

/** Door follows the same service-visit schedule as the cars, with time to clear the opening. */
export function dealershipGarageOpen(plans:VehiclePlan[],seconds:number):number{
 let open=0;
 for(const v of plans){if(!v.serviceWindow)continue;const cycle=Math.floor(seconds/v.period);
  for(const n of [cycle,cycle+1]){if(n<1)continue;const event=n*v.period+(v.id.endsWith('-in')?v.serviceWindow.duration:0),start=event-(v.id.endsWith('-in')?3:2),end=event+(v.id.endsWith('-in')?2:4);
   open=Math.max(open,Math.max(0,Math.min(1,seconds-start,end-seconds)));
  }
 }
 return open;
}

/** Highway cruising is faster than city driving, with evenly spaced traffic in both lanes. */
export const HIGHWAY_TRAFFIC_SPEED=1.55;
export const HIGHWAY_TRAFFIC_COUNT=16;
export function planHighwayTraffic(scene:Pick<Scene3D,'freight'>):VehiclePlan[]{
 if(!scene.freight||scene.freight.highway.length<2)return [];
 const fleet:VehicleKind[]=['taxi','pickup','bmw','van','gwagon','convertible','sedan','semi'];
 const road=scene.freight.highway;
 const lanes=[road,[...road].reverse()].map(center=>{
  const path=lanePath(center);
  const legs:Leg[]=path.slice(1).map((b,j)=>({a:path[j],b,ya:.03,yb:.03,dur:Math.hypot(b[0]-path[j][0],b[1]-path[j][1])/HIGHWAY_TRAFFIC_SPEED,hold:false}));
  return {legs,period:legs.reduce((sum,l)=>sum+l.dur,0)};
 });
 return Array.from({length:HIGHWAY_TRAFFIC_COUNT},(_,i)=>{
  const lane=lanes[i%2],slot=Math.floor(i/2),kind=fleet[(slot+(i%2)*3)%fleet.length];
  return {id:`highway-${i}-${kind}`,kind,color:['#d7aa43','#172326','#e5dfcf','#2163ad','#91a4ac','#813f38'][i%6],...lane,offset:lane.period*(slot+.25+(i%2)*.35)/(HIGHWAY_TRAFFIC_COUNT/2)};
 });
}

/**
 * Side lettering for the commercial fleet (Khaneil, 2026-11-13: "relabel trucks ... make it an Atlas delivery truck
 * with Atlas written on it, follow same suit for other commercial vehicles"). Atlas's own fleet only, no real brands.
 */
export const VEHICLE_LIVERY:Partial<Record<VehicleKind,{text:string;ink:string}>>={
 delivery:{text:"ATLAS",ink:"#ffffff"},
 parcel:{text:"ATLAS",ink:"#e5bd62"},
 bus:{text:"ATLAS TRANSIT",ink:"#1f3b4d"},
};
