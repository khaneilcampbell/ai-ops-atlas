// Where the decorative vehicles can drive: the lane round each headquarters, and the road bridges
// that join neighboring districts. Pure data, shared by the scene (which paves and builds them)
// and the vehicles (which drive them), so both agree on every coordinate.

export type Pt = [number, number];

/** How far a vehicle's center keeps from any wall: half its width and a little air. */
export const CLEAR = 0.08;
/** The tower's entrance stairs and flowerbeds reach this far out from its front. */
export const ENTRANCE = 0.26;
/** And from the plaza's edge, so wheels stay on the paving. */
const EDGE = 0.08;
/** How far out from the tower's walls the plaza lane runs. */
const LANE = 0.15;

/** A bridge's deck width, and how far each lane's center sits from the middle of the road. */
export const DECK_W = 0.46;
export const LANE_OFF = 0.1;
/** Width of the paved road from a plaza out to its bridge. */
export const ROAD_W = 0.44;
/** The deck rises this much over its ramps, so it reads as a bridge rather than a plank. */
export const RISE = 0.07;
const RAMP = 0.42;
/** A bridge keeps at least this far to the side of the footpath it runs beside. */
const PATH_GAP = 0.75;

export const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The lane around a tower: a rectangle inside its plaza. */
export interface Ring {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** The plaza lane for a tower of this size on a square plaza this wide, or null if there's no room. */
export function towerRing(t: { x: number; z: number; size: number }, plazaW: number): Ring | null {
  const lane = Math.min(plazaW / 2 - EDGE, t.size / 2 + LANE);
  if (lane < t.size / 2 + CLEAR) return null;
  return { x0: t.x - lane, z0: t.z - lane, x1: t.x + lane, z1: t.z + lane };
}

/** The tower's entrance stairs, in front (+z), which vehicles never drive through. */
export const stairsOf = (t: { x: number; z: number; size: number }): Box => ({
  x: t.x,
  z: t.z + t.size / 2 + ENTRANCE / 2,
  w: t.size,
  d: ENTRANCE,
});

/** Position along the ring by distance s, counterclockwise from its -x,-z corner. */
export function ringPoint(g: Ring, s: number): Pt {
  const w = g.x1 - g.x0;
  const d = g.z1 - g.z0;
  const total = 2 * (w + d);
  s = ((s % total) + total) % total;
  if (s <= w) return [g.x0 + s, g.z0];
  if (s <= w + d) return [g.x1, g.z0 + s - w];
  if (s <= 2 * w + d) return [g.x1 - (s - w - d), g.z1];
  return [g.x0, g.z1 - (s - 2 * w - d)];
}
export function ringParam(g: Ring, p: Pt): number {
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
export function ringPath(g: Ring, from: Pt, to: Pt): Pt[] {
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

/** An axis-aligned footprint, by its center. */
export interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** True when a polyline of axis-aligned legs keeps at least m clear of every box, after its first `skip` of length. */
export function pathClear(pts: Pt[], boxes: Box[], m: number, skip = 0) {
  let left = skip;
  for (let k = 1; k < pts.length; k++) {
    let a = pts[k - 1];
    const b = pts[k];
    const len = dist(a, b);
    if (left >= len) {
      left -= len;
      continue;
    }
    if (left > 0) {
      a = [a[0] + ((b[0] - a[0]) * left) / len, a[1] + ((b[1] - a[1]) * left) / len];
      left = 0;
    }
    // Each leg runs along one axis, so it is its own bounding box.
    const [x0, x1] = a[0] < b[0] ? [a[0], b[0]] : [b[0], a[0]];
    const [z0, z1] = a[1] < b[1] ? [a[1], b[1]] : [b[1], a[1]];
    for (const h of boxes) if (x1 > h.x - h.w / 2 - m && x0 < h.x + h.w / 2 + m && z1 > h.z - h.d / 2 - m && z0 < h.z + h.d / 2 + m) return false;
  }
  return true;
}

/** A road bridge between two neighboring districts, high over the meadow and the brooks. */
export interface CarBridge {
  key: string;
  /** The two districts' project ids: the first at a, the second at b. */
  ends: [string, string];
  axis: "x" | "z";
  /** The deck's centerline, from the first district's terrace edge to the second's. */
  a: Pt;
  b: Pt;
  /** For each end, the road across its terrace: ring exit first, deck end last. */
  roads: [Pt[], Pt[]];
}

/** Where two districts face each other across a footpath: the place a bridge could go. */
export interface BridgeSite {
  from: string;
  to: string;
  axis: "x" | "z";
  /** Terrace edges along the axis: from's (lower) and to's (higher). */
  a: number;
  b: number;
  /** The footpath's line, and the stretch across the axis that both districts share. */
  mid: number;
  lo: number;
  hi: number;
}

/** What a bridge road needs to know about each district it touches. */
export interface DistrictRoads {
  tower: { x: number; z: number; size: number };
  ring: Ring | null;
  /** Houses, kiosks, the entrance stairs and fountains: the road keeps clear of all of them. */
  obstacles: Box[];
}

/** Height of the deck above the terrace paving at distance s from end a, for a deck of length len. */
export function deckRise(len: number, s: number) {
  const r = rampOf(len);
  return RISE * Math.min(1, Math.max(0, s / r), Math.max(0, (len - s) / r));
}
export const rampOf = (len: number) => Math.min(RAMP, len * 0.3);

/**
 * A road from the plaza lane to the deck end at e (along the axis) and q (across it), leaving the
 * ring on its side facing the bridge or, failing that, a side beside it. Never through the front
 * of the tower, where the entrance stairs are. Returns the shortest clear road, or null.
 */
function roadTo(d: DistrictRoads, axis: "x" | "z", sign: 1 | -1, e: number, q: number): { pts: Pt[]; cost: number } | null {
  const g = d.ring;
  if (!g) return null;
  // Work in (u along the bridge, v across it), then map back.
  const W = (u: number, v: number): Pt => (axis === "x" ? [u, v] : [v, u]);
  const [u0, u1, v0, v1] = axis === "x" ? [g.x0, g.x1, g.z0, g.z1] : [g.z0, g.z1, g.x0, g.x1];
  const uF = sign > 0 ? u1 : u0;
  const frontFacing = axis === "z" && sign > 0;
  const m = LANE_OFF + CLEAR;
  const out: { pts: Pt[]; cost: number }[] = [];
  const consider = (raw: Pt[], penalty: number) => {
    const pts = raw.filter((p, i) => !i || dist(p, raw[i - 1]) > 1e-6);
    // The exit itself is on the plaza lane, which already keeps clear; check from just beyond it.
    if (!pathClear(pts, d.obstacles, m, 0.12)) return;
    out.push({
      pts,
      cost: pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : s), 0) + penalty,
    });
  };
  const towards = (from: number, to: number, step = 0.1) => {
    const n = Math.floor(Math.abs(to - from) / step);
    return Array.from({ length: n + 1 }, (_, i) => from + Math.sign(to - from) * i * step);
  };
  if (!frontFacing) {
    if (q > v0 + 1e-6 && q < v1 - 1e-6) consider([W(uF, q), W(e, q)], 0);
    const vs = Math.min(v1, Math.max(v0, q));
    // A bend part way out, to line up with the deck.
    if (Math.abs(vs - q) > 1e-6) for (const um of towards(uF + sign * 0.25, e - sign * 0.3, 0.15)) consider([W(uF, vs), W(um, vs), W(um, q), W(e, q)], 0.4);
  }
  // Or leave from the side beside the bridge, toward it, and turn once.
  const side = q < v0 - 0.05 || Math.abs(q - v0) < 1e-6 ? v0 : q > v1 + 0.05 || Math.abs(q - v1) < 1e-6 ? v1 : null;
  // The +z side of the ring is the tower's front.
  const sideIsFront = axis === "x" && side === v1;
  if (side !== null && !sideIsFront) for (const us of towards(uF, sign > 0 ? u0 : u1, 0.15)) consider([W(us, side), W(us, q), W(e, q)], 0.2);
  // Cheapest first, so most roads are checked against the buildings only once. The exit itself is
  // on the plaza lane, which already keeps clear; check from just beyond it.
  out.sort((x, y) => x.cost - y.cost);
  return out.find((r) => pathClear(r.pts, d.obstacles, m, 0.12)) ?? null;
}

/**
 * Road bridges for the footpaths between districts: one per pair of neighbors, beside the footpath,
 * where both ends can reach their plaza lane on a clear road. Walkways already join every district
 * to its neighbors, and through them to AI Ops Atlas, which reads every repository; the bridges
 * follow the same network, so the map stays one street grid in every grouping.
 */
export function planBridges(sites: BridgeSite[], districts: Map<string, DistrictRoads>): CarBridge[] {
  const out: CarBridge[] = [];
  for (const s of sites) {
    const A = districts.get(s.from);
    const B = districts.get(s.to);
    if (!A || !B || s.b - s.a < 0.6) continue;
    let best: { q: number; ra: Pt[]; rb: Pt[]; cost: number } | null = null;
    // Offsets from the footpath, and the lines of either plaza lane, which give the straightest roads.
    const lanes = [A.ring, B.ring].flatMap((g) => (!g ? [] : s.axis === "x" ? [g.z0, g.z1] : [g.x0, g.x1]));
    for (const q of [...[0.8, 1.0, 1.2, 1.45, 1.7, 2.0, 2.4, 2.8].flatMap((k) => [s.mid - k, s.mid + k]), ...lanes]) {
      const k = Math.abs(q - s.mid);
      if (q < s.lo + DECK_W / 2 + 0.05 || q > s.hi - DECK_W / 2 - 0.05 || Math.abs(q - s.mid) < PATH_GAP) continue;
      const ra = roadTo(A, s.axis, 1, s.a, q);
      const rb = ra && roadTo(B, s.axis, -1, s.b, q);
      if (!ra || !rb) continue;
      const cost = ra.cost + rb.cost + k * 0.2;
      if (!best || cost < best.cost) best = { q, ra: ra.pts, rb: rb.pts, cost };
      // Straight roads at both ends are as good as it gets.
      if (ra.pts.length === 2 && rb.pts.length === 2) break;
    }
    if (!best) continue;
    const W = (u: number): Pt => (s.axis === "x" ? [u, best.q] : [best.q, u]);
    out.push({
      key: `bridge:${s.from}:${s.to}`,
      ends: [s.from, s.to],
      axis: s.axis,
      a: W(s.a),
      b: W(s.b),
      roads: [best.ra, best.rb],
    });
  }
  return out;
}

/** A point on a drive, with its height above the terrace paving. */
export type Pt3 = [number, number, number];

/**
 * The drive from one end's ring exit, over the bridge, to the other end's ring exit, in the lane on
 * the right. Heights follow the deck's ramps.
 */
export function crossing(br: CarBridge, fromEnd: 0 | 1): Pt3[] {
  const [near, far] = fromEnd === 0 ? [br.roads[0], br.roads[1]] : [br.roads[1], br.roads[0]];
  const [a, b] = fromEnd === 0 ? [br.a, br.b] : [br.b, br.a];
  const len = dist(a, b);
  const r = rampOf(len);
  const along = (s: number): Pt3 => [a[0] + ((b[0] - a[0]) * s) / len, deckRise(len, s), a[1] + ((b[1] - a[1]) * s) / len];
  const flat = (p: Pt): Pt3 => [p[0], 0, p[1]];
  const center: Pt3[] = [...near.slice(0, -1).map(flat), along(0), along(r), along(len - r), along(len), ...[...far].reverse().slice(1).map(flat)];
  return keepRight(center, LANE_OFF);
}

/**
 * Shifts a drive into the lane on its right, mitering at the bends. The first and last points stay
 * on the centerline, where the drive joins the plaza lane, so the vehicle eases in and out.
 */
function keepRight(pts: Pt3[], off: number): Pt3[] {
  const right = (p: Pt3, q: Pt3) => {
    const dx = q[0] - p[0];
    const dz = q[2] - p[2];
    const l = Math.hypot(dx, dz) || 1;
    // Facing +x with y up, the right hand points to +z.
    return [-dz / l, dx / l] as const;
  };
  return pts.map((p, i): Pt3 => {
    if (i === 0 || i === pts.length - 1) return p;
    const n1 = right(pts[i - 1], p);
    const n2 = right(p, pts[i + 1]);
    const k = off / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1], p[2] + (n1[1] + n2[1]) * k];
  });
}
