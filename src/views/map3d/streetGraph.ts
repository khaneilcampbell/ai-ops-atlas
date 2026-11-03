import { crossing, towerRing, type Pt, type Pt3, type Ring } from "./roads";
import type { Scene3D } from "./scene";

/**
 * The city's streets as one graph, for anyone who has to get from one building to another: the
 * Financial District street and Circa's street, the local links between neighbourhoods, each road
 * bridge with its deck, and the lane around each headquarters plaza. Built only from roads the scene
 * already draws, so a route never leaves the pavement. Pure: no rendering, no randomness.
 * Points are [x, height above the terrace, z], the same as the vehicles' drives.
 */
export interface StreetGraph {
  nodes: Pt3[];
  /** Neighbours of each node with the length of the street between them. */
  edges: { to: number; len: number }[][];
  /** Every street segment, by node index, for finding the nearest street to a doorway. */
  segments: [number, number][];
}

/** A road end this close to another street joins it (T junction or end to end). */
export const JOIN = 0.35;

/** The plaza lane around each headquarters, the same ring the vehicles drive. */
export function plazaRings(scene: Pick<Scene3D, "towers" | "paving">): Map<string, Ring> {
  return new Map(
    scene.towers.flatMap((t) => {
      const plaza = scene.paving
        .filter((p) => p.w > t.size && Math.abs(p.x + p.w / 2 - t.x) < 1e-6 && Math.abs(p.z + p.d / 2 - t.z) < 1e-6 && Math.abs(p.w - p.d) < 1e-6)
        .sort((a, b) => a.w - b.w)[0];
      const ring = plaza && towerRing(t, plaza.w);
      return ring ? [[t.projectId, ring] as const] : [];
    }),
  );
}

/** The centre lines of every street a pedestrian may follow, as 3D polylines. */
export function streetLines(scene: Scene3D): Pt3[][] {
  const flat = (line: Pt[]): Pt3[] => line.map((p) => [p[0], 0, p[1]]);
  const lines: Pt3[][] = [];
  if (scene.financial) {
    lines.push(flat(scene.financial.street), flat(scene.financial.road));
    if (scene.financial.circa) lines.push(flat(scene.financial.circa.street));
  }
  for (const c of scene.transportConnections) lines.push(flat(c.road));
  for (const b of scene.carBridges) {
    // The centre of the drive, ramps included: the deck is not in the end roads.
    const lane = crossing(b, 0);
    lines.push(flat(b.roads[0]), flat(b.roads[1]), [[b.a[0], 0, b.a[1]], ...lane.filter((p) => p[1] > 0).map((p): Pt3 => (b.axis === "x" ? [p[0], p[1], b.a[1]] : [b.a[0], p[1], p[2]])), [b.b[0], 0, b.b[1]]]);
  }
  for (const g of plazaRings(scene).values()) lines.push(flat([[g.x0, g.z0], [g.x1, g.z0], [g.x1, g.z1], [g.x0, g.z1], [g.x0, g.z0]]));
  return lines.map((l) => l.filter((p, i) => !i || Math.hypot(p[0] - l[i - 1][0], p[2] - l[i - 1][2]) > 1e-6)).filter((l) => l.length > 1);
}

const flatDist = (a: Pt3, b: Pt3) => Math.hypot(b[0] - a[0], b[2] - a[2]);
const len3 = (a: Pt3, b: Pt3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** Nearest point to p on segment ab (in plan), with its parameter t along ab. */
function project(p: Pt3, a: Pt3, b: Pt3) {
  const dx = b[0] - a[0], dz = b[2] - a[2], l = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / l));
  const q: Pt3 = [a[0] + dx * t, a[1] + (b[1] - a[1]) * t, a[2] + dz * t];
  return { q, t, d: flatDist(p, q) };
}

export function buildStreetGraph(lines: Pt3[][]): StreetGraph {
  const nodes: Pt3[] = [], keys = new Map<string, number>();
  const node = (p: Pt3) => {
    const k = `${p[0].toFixed(3)},${p[2].toFixed(3)}`;
    let i = keys.get(k);
    if (i === undefined) { i = nodes.length; nodes.push(p); keys.set(k, i); }
    return i;
  };
  const vertices = lines.flatMap((l) => l);
  const segments: [number, number][] = [], links: [number, number][] = [];
  for (const line of lines)
    for (let s = 1; s < line.length; s++) {
      const a = line[s - 1], b = line[s];
      // Every road end or bend that touches this segment splits it, so the two streets share a node.
      const cuts = new Map<string, { t: number; q: Pt3; from: Pt3 }>();
      for (const v of vertices) {
        const { q, t, d } = project(v, a, b);
        if (d > JOIN || t <= 1e-6 || t >= 1 - 1e-6) continue;
        cuts.set(`${q[0].toFixed(3)},${q[2].toFixed(3)}`, { t, q, from: v });
      }
      const chain = [a, ...[...cuts.values()].sort((x, y) => x.t - y.t).map((c) => c.q), b].map(node);
      for (let i = 1; i < chain.length; i++) if (chain[i] !== chain[i - 1]) segments.push([chain[i - 1], chain[i]]);
      for (const c of cuts.values()) if (flatDist(c.from, c.q) > 1e-6) links.push([node(c.from), node(c.q)]);
    }
  // Road ends that stop just short of another road's end join it too.
  const ends = lines.flatMap((l) => [l[0], l[l.length - 1]]);
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) if (flatDist(ends[i], ends[j]) < JOIN) links.push([node(ends[i]), node(ends[j])]);
  const edges: StreetGraph["edges"] = nodes.map(() => []);
  for (const [a, b] of [...segments, ...links]) {
    if (a === b) continue;
    const len = len3(nodes[a], nodes[b]);
    edges[a].push({ to: b, len });
    edges[b].push({ to: a, len });
  }
  return { nodes, edges, segments };
}

/** The point on the nearest street to p, and the segment it lies on. */
export function nearestStreet(g: StreetGraph, p: Pt3) {
  let best = { q: p, d: Infinity, seg: -1 };
  g.segments.forEach(([a, b], seg) => {
    const r = project(p, g.nodes[a], g.nodes[b]);
    if (r.d < best.d) best = { q: r.q, d: r.d, seg };
  });
  return best;
}

/** Shortest walk along the streets between two street points, as a polyline. Undefined if they are not connected. */
export function streetRoute(g: StreetGraph, from: Pt3, to: Pt3): Pt3[] | undefined {
  const a = nearestStreet(g, from), b = nearestStreet(g, to);
  if (a.seg < 0 || b.seg < 0) return;
  // Temporary nodes where the walk joins and leaves the street.
  const n = g.nodes.length, S = n, T = n + 1, nodes = [...g.nodes, a.q, b.q];
  const extra = new Map<number, { to: number; len: number }[]>();
  const add = (x: number, y: number) => {
    const len = len3(nodes[x], nodes[y]);
    for (const [u, v] of [[x, y], [y, x]]) extra.set(u, [...(extra.get(u) ?? []), { to: v, len }]);
  };
  for (const [k, seg] of [[S, a.seg], [T, b.seg]] as const) for (const end of g.segments[seg]) add(k, end);
  if (a.seg === b.seg) add(S, T);
  const cost = new Float64Array(n + 2).fill(Infinity), came = new Int32Array(n + 2).fill(-1), done = new Uint8Array(n + 2);
  cost[S] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n + 2; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0 || u === T) break;
    done[u] = 1;
    for (const e of [...(g.edges[u] ?? []), ...(extra.get(u) ?? [])]) if (cost[u] + e.len < cost[e.to]) { cost[e.to] = cost[u] + e.len; came[e.to] = u; }
  }
  if (cost[T] === Infinity) return;
  const path: Pt3[] = [];
  for (let i = T; i >= 0; i = came[i]) path.push(nodes[i]);
  return path.reverse().filter((p, i, all) => !i || len3(p, all[i - 1]) > 1e-6);
}
