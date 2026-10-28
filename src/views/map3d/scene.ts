import type { Agent, Status } from "../../catalog/types";
import { frameworkColor, hash, treeSpots, type Layout } from "../mapLayout";
import { identityFor, type BuildingIdentity } from "./identity";

// The 3D map reuses the 2D layout: grid x becomes world x and grid y becomes world z, so the
// camera looking from +x+z sees the same arrangement as the isometric map.

/** Height of a district terrace above the meadow, and how far it overhangs its lot. */
export const TERRACE_H = 0.6;
export const TERRACE_M = 0.35;
/** The sea sits this far below the meadow; the cliffs fill the gap. */
export const WATER_Y = -1.4;
export const LAND_BOTTOM = -1.8;
const PATH_W = 0.55;
const INNER_PATH_W = 0.32;
const ROAD_W = 0.6;
export const FLOOR_H = 0.32;

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}
export interface Slab extends Rect {
  /** Top surface height. */
  y: number;
  h: number;
  /** An asphalt street between districts, rather than stone paving. */
  street?: boolean;
}
export interface Terrace extends Rect {
  id: string;
  park: boolean;
}
export interface House {
  key: string;
  agent: Agent;
  projectId: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  roofH: number;
  roof: string;
  wall: string;
  hip: boolean;
  chimney: boolean;
  solar: boolean;
}
export interface Tower {
  key: string;
  projectId: string;
  repository: string;
  name: string;
  status: Status;
  agents: number;
  identity: BuildingIdentity;
  x: number;
  z: number;
  size: number;
  floors: number;
  height: number;
}
export interface StrayBuilding {
  key: string;
  name: string;
  x: number;
  z: number;
  size: number;
  height: number;
}
export type TreeKind = "round" | "cone" | "blossom";
export interface Tree {
  x: number;
  y: number;
  z: number;
  s: number;
  kind: TreeKind;
}
export interface Point {
  x: number;
  y: number;
  z: number;
  s: number;
}
export interface Fall {
  x: number;
  z: number;
  /** Direction the water falls toward. */
  axis: "x" | "z";
  dir: 1 | -1;
}
export interface Park extends Rect {
  id: string;
  label: string;
}

export interface Scene3D {
  land: Rect[];
  terraces: Terrace[];
  /** Paved strips: walkways on the meadow, paths and plazas on terraces. */
  paving: Slab[];
  steps: Slab[];
  brooks: Rect[];
  bridges: (Rect & { axis: "x" | "z" })[];
  ponds: { x: number; y: number; z: number; r: number }[];
  falls: Fall[];
  fountains: { x: number; z: number }[];
  /** Low path lights along each district's footpaths. */
  bollards: Point[];
  /** Walkways between terraces at meadow level, end to end, for strollers. */
  walks: { x0: number; z0: number; x1: number; z1: number }[];
  parks: Park[];
  houses: House[];
  towers: Tower[];
  strays: StrayBuilding[];
  trees: Tree[];
  bushes: Point[];
  rocks: Point[];
  lamps: Point[];
  bounds: { x0: number; z0: number; x1: number; z1: number };
}

const WALLS = ["#f3eadb", "#efe6d2", "#f6f1e6", "#e9dfca"];

function inRect(r: Rect, x: number, z: number, pad = 0) {
  return x >= r.x - pad && x <= r.x + r.w + pad && z >= r.z - pad && z <= r.z + r.d + pad;
}

/** A strip of paving from (x0,z0) to (x1,z1) along one axis, width w. */
function strip(x0: number, z0: number, x1: number, z1: number, w: number, y: number): Slab {
  const x = Math.min(x0, x1) - (x0 === x1 ? w / 2 : 0);
  const z = Math.min(z0, z1) - (z0 === z1 ? w / 2 : 0);
  return { x, z, w: x0 === x1 ? w : Math.abs(x1 - x0), d: z0 === z1 ? w : Math.abs(z1 - z0), y, h: 0.03 };
}

export function buildScene(layout: Layout): Scene3D {
  const land: Rect[] = layout.meadows.map((m) => ({ x: m.ox, z: m.oy, w: m.w, d: m.h }));
  const terraces: Terrace[] = [];
  const paving: Slab[] = [];
  const steps: Slab[] = [];
  const houses: House[] = [];
  const towers: Tower[] = [];
  const strays: StrayBuilding[] = [];
  const trees: Tree[] = [];
  const bushes: Point[] = [];
  const rocks: Point[] = [];
  const lamps: Point[] = [];
  const ponds: Scene3D["ponds"] = [];
  const fountains: Scene3D["fountains"] = [];
  const bollards: Point[] = [];
  const parks: Park[] = [];
  const top = TERRACE_H;
  const onLand = (x: number, z: number) => land.some((r) => inRect(r, x, z));

  for (const d of layout.districts) {
    terraces.push({ id: d.project.id, park: false, x: d.ox - TERRACE_M, z: d.oy - TERRACE_M, w: d.size + 2 * TERRACE_M, d: d.size + 2 * TERRACE_M });
    const agents = d.lots.length;
    const identity = identityFor(d.project);
    // The landmark stands tallest; timber labs stay low and broad; the others grow with their agents.
    const floors = identity.landmark ? 15 : Math.min(identity.style === "timber" ? 9 : 18, 6 + Math.min(agents, 12));
    const size = d.hq.size * (identity.landmark ? 1.02 : 0.92);
    const cx = d.hq.gx + d.hq.size / 2;
    const cz = d.hq.gy + d.hq.size / 2;
    towers.push({
      key: `repo:${d.project.repository}`,
      projectId: d.project.id,
      repository: d.project.repository,
      name: d.project.name,
      status: d.project.status,
      agents,
      identity,
      x: cx,
      z: cz,
      size,
      floors,
      height: floors * FLOOR_H,
    });
    // Paved plaza around the tower, and paths out to each house.
    const pz = d.hq.size * 1.25;
    paving.push({ x: cx - pz / 2, z: cz - pz / 2, w: pz, d: pz, y: top, h: 0.03 });
    for (const l of d.lots) {
      const a = l.agent;
      const lx = l.gx + l.size / 2;
      const lz = l.gy + l.size / 2;
      paving.push(strip(cx, cz, lx, cz, INNER_PATH_W, top), strip(lx, cz, lx, lz, INNER_PATH_W, top));
      const t = hash(a.id);
      const tall = hash(`${a.id}:tall`) > 0.75;
      houses.push({
        key: `agent:${a.id}`,
        agent: a,
        projectId: d.project.id,
        x: lx,
        z: lz,
        w: l.size * (0.7 + t * 0.12),
        d: l.size * 0.78,
        h: tall ? 0.8 : 0.5 + t * 0.14,
        roofH: 0.34 + hash(`${a.id}:r`) * 0.08,
        roof: a.status === "attention" ? "#c9a35a" : frameworkColor(a.framework),
        wall: a.status === "retired" ? "#d4d6cc" : WALLS[Math.floor(hash(`${a.id}:w`) * WALLS.length)],
        hip: hash(`${a.id}:roof`) > 0.5,
        chimney: hash(`${a.id}:ch`) > 0.4,
        solar: hash(`${a.id}:sol`) > 0.6,
      });
    }
    // A path light at each bend, on the outside corner, unless a house stands there.
    for (const l of d.lots) {
      const lx = l.gx + l.size / 2;
      const lz = l.gy + l.size / 2;
      const b = { x: lx + Math.sign(lx - cx || 1) * (INNER_PATH_W / 2 + 0.07), y: top, z: cz - Math.sign(lz - cz || 1) * (INNER_PATH_W / 2 + 0.07), s: 1 };
      const clear = !houses.some((h) => h.projectId === d.project.id && Math.abs(h.x - b.x) < h.w / 2 + 0.05 && Math.abs(h.z - b.z) < h.d / 2 + 0.05);
      if (clear && !bollards.some((o) => Math.hypot(o.x - b.x, o.z - b.z) < 0.3)) bollards.push(b);
    }
    // The landmark stands on a wider civic plaza with a fountain and lamps at its corners,
    // wherever the houses leave room.
    if (identity.landmark) {
      const half = d.hq.size * 0.62 + 0.45;
      paving.push({ x: cx - half, z: cz - half, w: half * 2, d: half * 2, y: top, h: 0.02 });
      const clear = (x: number, z: number, r: number) => !houses.some((h) => h.projectId === d.project.id && Math.abs(h.x - x) < h.w / 2 + r && Math.abs(h.z - z) < h.d / 2 + r);
      const fx = cx + half - 0.5;
      const fz = cz + half - 0.5;
      if (clear(fx, fz, 0.55)) fountains.push({ x: fx, z: fz });
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const lx = cx + sx * (half - 0.12);
        const lz = cz + sz * (half - 0.12);
        if (clear(lx, lz, 0.15) && !(sx === 1 && sz === 1)) lamps.push({ x: lx, y: top, z: lz, s: 1 });
      }
    }
    // Trees and flowering shrubs along the terrace edges, clear of houses and paths.
    const blocked = (x: number, z: number) =>
      houses.some((h) => h.projectId === d.project.id && Math.abs(h.x - x) < h.w / 2 + 0.35 && Math.abs(h.z - z) < h.d / 2 + 0.35) ||
      paving.some((p) => inRect(p, x, z, 0.22)) ||
      Math.hypot(x - cx, z - cz) < d.hq.size * 0.9;
    for (const s of treeSpots(d.project.id, d.ox - 0.15, d.oy - 0.15, d.size + 0.3, Math.round(d.size * 3.4))) {
      if (blocked(s.gx, s.gy)) continue;
      const pick = hash(`${s.gx.toFixed(2)}:${s.gy.toFixed(2)}`);
      trees.push({ x: s.gx, y: top, z: s.gy, s: 0.24 + (s.r - 7) * 0.025, kind: pick < 0.2 ? "cone" : pick > 0.95 ? "blossom" : "round" });
    }
    for (const s of treeSpots(`${d.project.id}:bush`, d.ox + 0.2, d.oy + 0.2, d.size - 0.4, Math.round(d.size * 2.2))) {
      if (blocked(s.gx, s.gy)) continue;
      bushes.push({ x: s.gx, y: top, z: s.gy, s: 0.1 + hash(`${s.gx}:${s.gy}:b`) * 0.06 });
    }
  }

  for (const p of layout.parks) {
    if (p.strays.length) {
      for (const s of p.strays) strays.push({ key: `repo:${s.name}`, name: s.name, x: s.gx + s.size / 2, z: s.gy + s.size / 2, size: s.size * 1.2, height: 0.9 + hash(s.name) * 0.7 });
      continue;
    }
    terraces.push({ id: p.id, park: true, x: p.ox, z: p.oy, w: p.w, d: p.h });
    const cx = p.ox + p.w / 2;
    const cz = p.oy + p.h / 2;
    parks.push({ id: p.id, label: "Room for the next project", x: p.ox, z: p.oy, w: p.w, d: p.h });
    // A small paved square with a fountain, and a pond beside it.
    paving.push({ x: cx - 1.1, z: cz - 1.1, w: 2.2, d: 2.2, y: top, h: 0.03 });
    fountains.push({ x: cx, z: cz });
    ponds.push({ x: p.ox + p.w * 0.27, y: top, z: p.oy + p.h * 0.72, r: Math.min(p.w, p.h) * 0.16 });
    for (const s of treeSpots(p.id, p.ox + 0.2, p.oy + 0.2, p.w - 0.4, Math.round(p.w * 3), p.h - 0.4)) {
      if (Math.abs(s.gx - cx) < 1.4 && Math.abs(s.gy - cz) < 1.4) continue;
      if (ponds.some((q) => Math.hypot(q.x - s.gx, q.z - s.gy) < q.r + 0.3)) continue;
      trees.push({ x: s.gx, y: top, z: s.gy, s: 0.26, kind: hash(`${s.gx}:${s.gy}`) > 0.9 ? "blossom" : "round" });
    }
  }

  // Walkways between terraces, with steps down each terrace face.
  const bridges: Scene3D["bridges"] = [];
  const walks: Scene3D["walks"] = [];
  for (const w of layout.walks) {
    const x = w.axis === "x";
    const a = x ? w.a.gx + TERRACE_M : w.a.gy + TERRACE_M;
    const b = x ? w.b.gx - TERRACE_M : w.b.gy - TERRACE_M;
    const c = x ? w.a.gy : w.a.gx;
    paving.push(x ? strip(a, c, b, c, PATH_W, 0) : strip(c, a, c, b, PATH_W, 0));
    // Strollers keep off the steps at either end.
    walks.push(x ? { x0: a + 0.45, z0: c, x1: b - 0.45, z1: c } : { x0: c, z0: a + 0.45, x1: c, z1: b - 0.45 });
    for (const [edge, dir] of [[a, 1], [b, -1]] as const)
      for (let i = 0; i < 3; i++) {
        const along = edge + dir * (i * 0.13) - (dir === 1 ? 0 : 0.13);
        const h = (top * (3 - i)) / 4;
        steps.push(x ? { x: along, z: c - PATH_W / 2, w: 0.13, d: PATH_W, y: h, h } : { x: c - PATH_W / 2, z: along, w: PATH_W, d: 0.13, y: h, h });
      }
    const mx = x ? (a + b) / 2 : c;
    const mz = x ? c : (a + b) / 2;
    lamps.push({ x: mx + (x ? 0 : 0.35), y: 0, z: mz + (x ? 0.35 : 0), s: 1 });
  }

  // Streets run along the gaps between shelf rows, out to the shore, lit by streetlights.
  const brooks: Rect[] = [];
  const falls: Fall[] = [];
  const rows = new Map<string, { z: number; d: number; x0: number; x1: number }>();
  for (const r of land) {
    const k = `${r.z.toFixed(4)}|${r.d.toFixed(4)}`;
    const row = rows.get(k);
    if (row) {
      row.x0 = Math.min(row.x0, r.x);
      row.x1 = Math.max(row.x1, r.x + r.w);
    } else rows.set(k, { z: r.z, d: r.d, x0: r.x, x1: r.x + r.w });
  }
  for (const r1 of rows.values())
    for (const r2 of rows.values()) {
      if (Math.abs(r2.z - (r1.z + r1.d)) > 1e-6) continue;
      const x0 = Math.max(r1.x0, r2.x0);
      const x1 = Math.min(r1.x1, r2.x1);
      if (x1 - x0 < 3) continue;
      const z = r2.z;
      const shore = (x: number) => !onLand(x, z - 0.2) && !onLand(x, z + 0.2);
      const s0 = shore(x0 - 0.05);
      const s1 = shore(x1 + 0.05);
      const bx0 = s0 ? x0 : x0 + 0.3;
      const bx1 = s1 ? x1 : x1 - 0.3;
      // Slightly lower than the stone walkways, so a crossing walkway reads as a crosswalk on top.
      paving.push({ x: bx0, z: z - ROAD_W / 2, w: bx1 - bx0, d: ROAD_W, y: 0, h: 0.02, street: true });
      for (let k = 0, at = bx0 + 1.2; at < bx1 - 0.6; at += 2.4, k++) lamps.push({ x: at, y: 0, z: z + (k % 2 ? -1 : 1) * (ROAD_W / 2 + 0.16), s: 1 });
    }

  // Break up the straight coastline with headlands, keeping clear of the waterfalls.
  const coast: Rect[] = [];
  land.forEach((r, i) => {
    const edges: [number, number, "x" | "z", number][] = [
      [r.x + r.w, r.z, "z", 1],
      [r.x, r.z + r.d, "x", 1],
      [r.x, r.z, "z", -1],
      [r.x, r.z, "x", -1],
    ];
    edges.forEach(([ex, ez, along, dir], e) => {
      const len = along === "z" ? r.d : r.w;
      for (let k = 0; k * 2.6 < len - 1; k++) {
        const t = hash(`c${i}:${e}:${k}`);
        if (t < 0.35) continue;
        const l = 0.8 + hash(`c${i}:${e}:${k}:l`) * 1.4;
        const out = 0.25 + hash(`c${i}:${e}:${k}:o`) * 0.5;
        const at = k * 2.6 + t * 1.2;
        if (at + l > len) continue;
        const b: Rect =
          along === "z"
            ? { x: dir > 0 ? ex : ex - out, z: ez + at, w: out, d: l }
            : { x: ex + at, z: dir > 0 ? ez : ez - out, w: l, d: out };
        const mx = b.x + b.w / 2 + (along === "z" ? dir * (b.w / 2 + 0.1) : 0);
        const mz = b.z + b.d / 2 + (along === "x" ? dir * (b.d / 2 + 0.1) : 0);
        if (onLand(mx, mz)) continue;
        if (falls.some((f) => Math.abs(f.x - (b.x + b.w / 2)) < l / 2 + 0.9 && Math.abs(f.z - (b.z + b.d / 2)) < l / 2 + 0.9)) continue;
        coast.push(b);
      }
    });
  });
  land.push(...coast);

  // Meadow trees between the terraces, and rocks on the beaches.
  const clear = (x: number, z: number) =>
    !terraces.some((t) => inRect(t, x, z, 0.3)) &&
    !paving.some((p) => p.y === 0 && inRect(p, x, z, 0.3)) &&
    !brooks.some((b) => inRect(b, x, z, 0.3)) &&
    !ponds.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 0.3) &&
    !strays.some((s) => Math.abs(s.x - x) < s.size && Math.abs(s.z - z) < s.size);
  land.forEach((r, i) => {
    const n = Math.round(r.w * r.d * 1.5);
    for (let k = 0; k < n; k++) {
      const x = r.x + 0.25 + hash(`m${i}:${k}:x`) * (r.w - 0.5);
      const z = r.z + 0.25 + hash(`m${i}:${k}:z`) * (r.d - 0.5);
      if (!clear(x, z)) continue;
      const p = hash(`m${i}:${k}:k`);
      if (p < 0.12) bushes.push({ x, y: 0, z, s: 0.12 });
      else trees.push({ x, y: 0, z, s: 0.24 + hash(`m${i}:${k}:s`) * 0.12, kind: p < 0.3 ? "cone" : p > 0.96 ? "blossom" : "round" });
    }
    for (let k = 0; k < Math.round((r.w + r.d) * 0.6); k++) {
      const t = hash(`r${i}:${k}`);
      const side = hash(`r${i}:${k}:s`) > 0.5;
      const x = side ? r.x + r.w + 0.18 : r.x + t * r.w;
      const z = side ? r.z + t * r.d : r.z + r.d + 0.18;
      if (onLand(x, z)) continue;
      rocks.push({ x, y: WATER_Y + 0.05, z, s: 0.1 + hash(`r${i}:${k}:z`) * 0.14 });
    }
  });

  const xs = land.flatMap((r) => [r.x, r.x + r.w]);
  const zs = land.flatMap((r) => [r.z, r.z + r.d]);
  return {
    land,
    terraces,
    paving,
    steps,
    brooks,
    bridges,
    ponds,
    falls,
    fountains,
    bollards,
    walks,
    parks,
    houses,
    towers,
    strays,
    trees,
    bushes,
    rocks,
    lamps,
    bounds: xs.length ? { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) } : { x0: -5, z0: -5, x1: 5, z1: 5 },
  };
}
