import { TERRACE_H, type Rect, type Scene3D } from "./scene";

/** Grid cell size for route finding, in world units: fine enough to land on every step. */
const CELL = 0.1;
/** Walking off the paving costs this much more, so routes keep to paths and use grass only to reach them. */
const GRASS = 6;
/** Largest height change between neighboring cells; terrace edges are only crossed on steps. */
const CLIMB = 0.2;

export interface RoutePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Turn-by-turn routes over the map's paths, walkways, steps and bridges, like directions on a
 * street map. Buildings and water are impassable; grass is allowed but costly. Routes are
 * cached per pair of points.
 */
export function makeRouter(scene: Scene3D) {
  const b = scene.bounds;
  const W = Math.ceil((b.x1 - b.x0) / CELL) + 1;
  const H = Math.ceil((b.z1 - b.z0) / CELL) + 1;
  const cost = new Float32Array(W * H); // 0 = blocked
  const height = new Float32Array(W * H);
  const blockers: Rect[] = [
    ...scene.towers.map((t) => ({ x: t.x - t.size / 2, z: t.z - t.size / 2, w: t.size, d: t.size })),
    ...scene.houses.map((h) => ({ x: h.x - h.w / 2, z: h.z - h.d / 2, w: h.w, d: h.d })),
    ...scene.strays.map((s) => ({ x: s.x - s.size / 2, z: s.z - s.size / 2, w: s.size, d: s.size })),
  ];
  // Paint the grid layer by layer, each layer overriding the ones before it.
  const fill = (r: Rect, pad: number, f: (k: number) => void) => {
    const i0 = Math.max(0, Math.ceil((r.x - pad - b.x0) / CELL));
    const i1 = Math.min(W - 1, Math.floor((r.x + r.w + pad - b.x0) / CELL));
    const j0 = Math.max(0, Math.ceil((r.z - pad - b.z0) / CELL));
    const j1 = Math.min(H - 1, Math.floor((r.z + r.d + pad - b.z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * W + i);
  };
  const set = (c: number, y: number) => (k: number) => {
    cost[k] = c;
    height[k] = y;
  };
  for (const r of scene.land) fill(r, 0, set(GRASS, 0));
  for (const t of scene.terraces) fill(t, 0, set(GRASS, TERRACE_H));
  for (const p of scene.paving) fill(p, 0.02, (k) => cost[k] && Math.abs(height[k] - p.y) < 0.01 && (cost[k] = 1));
  for (const st of scene.steps) fill(st, 0, set(1, st.y));
  for (const r of scene.brooks) fill(r, 0, set(0, 0));
  for (const p of scene.ponds) fill({ x: p.x - p.r, z: p.z - p.r, w: p.r * 2, d: p.r * 2 }, 0, (k) => Math.hypot(b.x0 + (k % W) * CELL - p.x, b.z0 + Math.floor(k / W) * CELL - p.z) < p.r && (cost[k] = 0));
  for (const r of scene.bridges) fill(r, 0, set(1, 0.06));
  // Keep a margin around buildings so rounded corners never cut into them.
  for (const r of blockers) fill(r, 0.15, set(0, 0));

  const cellOf = (x: number, z: number) => [Math.round((x - b.x0) / CELL), Math.round((z - b.z0) / CELL)] as const;
  /** The nearest open cell to a point, preferring paving, for starting beside a building. */
  const nearestOpen = (x: number, z: number) => {
    const [ci, cj] = cellOf(x, z);
    let best = -1;
    let bestScore = Infinity;
    for (let r = 0; r <= 40 && best < 0; r += 4)
      for (let j = Math.max(0, cj - r - 4); j <= Math.min(H - 1, cj + r + 4); j++)
        for (let i = Math.max(0, ci - r - 4); i <= Math.min(W - 1, ci + r + 4); i++) {
          const c = cost[j * W + i];
          if (!c) continue;
          const score = Math.hypot(i - ci, j - cj) + (c > 1 ? 6 : 0);
          if (score < bestScore) {
            bestScore = score;
            best = j * W + i;
          }
        }
    return best;
  };

  const cache = new Map<string, RoutePoint[] | null>();
  const DIRS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ] as const;

  /** A* from one point to another; null when no route exists. */
  function route(from: { x: number; z: number }, to: { x: number; z: number }): RoutePoint[] | null {
    const key = `${from.x.toFixed(2)},${from.z.toFixed(2)}>${to.x.toFixed(2)},${to.z.toFixed(2)}`;
    if (cache.has(key)) return cache.get(key)!;
    const s = nearestOpen(from.x, from.z);
    const t = nearestOpen(to.x, to.z);
    let out: RoutePoint[] | null = null;
    if (s >= 0 && t >= 0) {
      const ti = t % W;
      const tj = Math.floor(t / W);
      const g = new Float32Array(W * H).fill(Infinity);
      const prev = new Int32Array(W * H).fill(-1);
      const heap = new Heap();
      const h = (k: number) => {
        const dx = Math.abs((k % W) - ti);
        const dz = Math.abs(Math.floor(k / W) - tj);
        return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
      };
      g[s] = 0;
      heap.push(s, h(s));
      while (heap.size) {
        const k = heap.pop();
        if (k === t) break;
        const i = k % W;
        const j = Math.floor(k / W);
        for (const [di, dj, len] of DIRS) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const n = nj * W + ni;
          const c = cost[n];
          if (!c || Math.abs(height[n] - height[k]) > CLIMB) continue;
          // No cutting corners past a blocked cell.
          if (di && dj && (!cost[j * W + ni] || !cost[nj * W + i])) continue;
          const ng = g[k] + len * (c + cost[k]) * 0.5;
          if (ng < g[n]) {
            g[n] = ng;
            prev[n] = k;
            heap.push(n, ng + h(n));
          }
        }
      }
      if (prev[t] >= 0 || s === t) {
        const cells: number[] = [];
        for (let k = t; k >= 0; k = prev[k]) cells.push(k);
        cells.reverse();
        out = simplify(cells.map((k) => ({ x: b.x0 + (k % W) * CELL, y: height[k], z: b.z0 + Math.floor(k / W) * CELL })));
      }
    }
    cache.set(key, out);
    return out;
  }

  return { route };
}

/** Drops points on straight runs, then rounds the corners a little, like a drawn route. */
function simplify(pts: RoutePoint[]): RoutePoint[] {
  if (pts.length < 3) return pts;
  const keep = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1];
    const p = pts[i];
    const c = pts[i + 1];
    const cross = (p.x - a.x) * (c.z - a.z) - (p.z - a.z) * (c.x - a.x);
    if (Math.abs(cross) > 1e-4 || Math.abs(p.y - c.y) > 1e-4 || Math.abs(p.y - a.y) > 1e-4) keep.push(p);
  }
  keep.push(pts[pts.length - 1]);
  // Two rounds of corner cutting, keeping the ends where they are.
  let r = keep;
  for (let n = 0; n < 2; n++) {
    const next = [r[0]];
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i];
      const c = r[i + 1];
      const q = { x: a.x * 0.75 + c.x * 0.25, y: a.y * 0.75 + c.y * 0.25, z: a.z * 0.75 + c.z * 0.25 };
      const w = { x: a.x * 0.25 + c.x * 0.75, y: a.y * 0.25 + c.y * 0.75, z: a.z * 0.25 + c.z * 0.75 };
      if (i > 0) next.push(q);
      if (i < r.length - 2) next.push(w);
    }
    next.push(r[r.length - 1]);
    r = next;
  }
  return r;
}

/** A minimal binary min-heap of cell indices by priority. */
class Heap {
  private k: number[] = [];
  private p: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, pri: number) {
    const { k, p } = this;
    let i = k.length;
    k.push(key);
    p.push(pri);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up] <= pri) break;
      k[i] = k[up];
      p[i] = p[up];
      i = up;
    }
    k[i] = key;
    p[i] = pri;
  }
  pop() {
    const { k, p } = this;
    const top = k[0];
    const lk = k.pop()!;
    const lp = p.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= k.length) break;
        const c = l + 1 < k.length && p[l + 1] < p[l] ? l + 1 : l;
        if (p[c] >= lp) break;
        k[i] = k[c];
        p[i] = p[c];
        i = c;
      }
      k[i] = lk;
      p[i] = lp;
    }
    return top;
  }
}
