import type { Agent, Status } from "../../catalog/types";
import { frameworkColor, hash, treeSpots, type Layout } from "../mapLayout";
import { identityFor, type BuildingIdentity } from "./identity";
import { planBridges, ROAD_W, stairsOf, towerRing, type BridgeSite, type CarBridge, type DistrictRoads } from "./roads";

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
const BROOK_W = 0.55;
export const FLOOR_H = 0.32;
/** A fountain's basin radius at full size. */
export const FOUNTAIN_R = 0.475;

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
/** A small market kiosk for an outside service named in the project's manifests. */
export interface Kiosk {
  key: string;
  projectId: string;
  name: string;
  /** Names of the items that use it. */
  users: string[];
  x: number;
  z: number;
  /** Footprint, square. */
  size: number;
  /** Canopy color. */
  canopy: string;
}
export interface Tower {
  key: string;
  projectId: string;
  repository: string;
  name: string;
  status: Status;
  /** AI agents at desks inside, and automations in houses around it. */
  agents: number;
  automations: number;
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
  /** Road bridges between neighboring districts, at terrace height, with roads out to each plaza. */
  carBridges: CarBridge[];
  ponds: { x: number; y: number; z: number; r: number }[];
  falls: Fall[];
  /** k scales the fountain down from its full size (1) where room is tight. */
  fountains: { x: number; z: number; k?: number }[];
  /** Low path lights along each district's footpaths. */
  bollards: Point[];
  /** Walkways between terraces at meadow level, end to end, for strollers. */
  walks: { x0: number; z0: number; x1: number; z1: number }[];
  parks: Park[];
  houses: House[];
  kiosks: Kiosk[];
  towers: Tower[];
  strays: StrayBuilding[];
  trees: Tree[];
  bushes: Point[];
  rocks: Point[];
  bounds: { x0: number; z0: number; x1: number; z1: number };
}

/** Atlas's own palette: forest green, sage, gold, terracotta. */
const CANOPIES = ["#2f4a3a", "#8fa58a", "#c9a35a", "#b8735a"];
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
  const kiosks: Kiosk[] = [];
  const towers: Tower[] = [];
  const strays: StrayBuilding[] = [];
  const trees: Tree[] = [];
  const bushes: Point[] = [];
  const rocks: Point[] = [];
  const ponds: Scene3D["ponds"] = [];
  const fountains: Scene3D["fountains"] = [];
  const bollards: Point[] = [];
  const parks: Park[] = [];
  const top = TERRACE_H;
  const onLand = (x: number, z: number) => land.some((r) => inRect(r, x, z));

  // Each district's own paving, so its trees only check what is on its terrace.
  const pavedIn = new Map<string, Slab[]>();
  for (const d of layout.districts) {
    const pavedFrom = paving.length;
    terraces.push({ id: d.project.id, park: false, x: d.ox - TERRACE_M, z: d.oy - TERRACE_M, w: d.size + 2 * TERRACE_M, d: d.size + 2 * TERRACE_M });
    const agents = d.lots.length + d.crew.length;
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
      agents: d.crew.length,
      automations: d.lots.length,
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
    for (const k of d.kiosks) {
      const kx = k.gx + k.size / 2;
      const kz = k.gy + k.size / 2;
      paving.push(strip(cx, cz, kx, cz, INNER_PATH_W, top), strip(kx, cz, kx, kz, INNER_PATH_W, top));
      kiosks.push({
        key: `service:${d.project.id}:${k.service.id}`,
        projectId: d.project.id,
        name: k.service.name,
        users: k.service.users.map((a) => a.name),
        x: kx,
        z: kz,
        size: Math.min(k.size, 0.9),
        canopy: CANOPIES[Math.floor(hash(k.service.id) * CANOPIES.length)],
      });
    }
    // A path light at each bend, on the outside corner, unless a house stands there.
    for (const l of d.lots) {
      const lx = l.gx + l.size / 2;
      const lz = l.gy + l.size / 2;
      const b = { x: lx + Math.sign(lx - cx || 1) * (INNER_PATH_W / 2 + 0.07), y: top, z: cz - Math.sign(lz - cz || 1) * (INNER_PATH_W / 2 + 0.07), s: 1 };
      const clear =
        !houses.some((h) => h.projectId === d.project.id && Math.abs(h.x - b.x) < h.w / 2 + 0.05 && Math.abs(h.z - b.z) < h.d / 2 + 0.05) &&
        !kiosks.some((k) => k.projectId === d.project.id && Math.abs(k.x - b.x) < k.size / 2 + 0.05 && Math.abs(k.z - b.z) < k.size / 2 + 0.05);
      if (clear && !bollards.some((o) => Math.hypot(o.x - b.x, o.z - b.z) < 0.3)) bollards.push(b);
    }
    // The landmark stands on a wider civic plaza with a fountain, wherever the houses leave room.
    if (identity.landmark) {
      const half = d.hq.size * 0.62 + 0.45;
      paving.push({ x: cx - half, z: cz - half, w: half * 2, d: half * 2, y: top, h: 0.02 });
      const clear = (x: number, z: number, r: number) =>
        ![...houses, ...kiosks.map((k) => ({ ...k, w: k.size, d: k.size }))].some((h) => h.projectId === d.project.id && Math.abs(h.x - x) < h.w / 2 + r && Math.abs(h.z - z) < h.d / 2 + r);
      // In the plaza's front-left corner, so it stands beside the tower rather than in front of it
      // from the map's viewpoint, as large as fits between the tower's corner and the plaza's edge:
      // inset o from the edge, it clears the tower by o * sqrt(2) on the diagonal.
      const room = half - size / 2 - 0.03;
      const r = Math.min(FOUNTAIN_R, (room * Math.SQRT2 - 0.06) / (1 + Math.SQRT2));
      const at = size / 2 + room - r;
      if (r > 0.2 && clear(cx - at, cz + at, r + 0.08)) fountains.push({ x: cx - at, z: cz + at, k: r / FOUNTAIN_R });
    }
    pavedIn.set(d.project.id, paving.slice(pavedFrom));
  }

  // Road bridges between neighboring districts, beside the footpaths, and the roads out to them.
  const byId = new Map(layout.districts.map((d) => [d.project.id, d]));
  const roadsOf = new Map<string, DistrictRoads>();
  for (const t of towers) {
    const d = byId.get(t.projectId)!;
    const own = <T extends { projectId: string }>(xs: T[]) => xs.filter((x) => x.projectId === t.projectId);
    roadsOf.set(t.projectId, {
      tower: t,
      ring: towerRing(t, d.hq.size * 1.25),
      obstacles: [
        stairsOf(t),
        ...own(houses),
        ...own(kiosks).map((k) => ({ x: k.x, z: k.z, w: k.size, d: k.size })),
        ...fountains
          .filter((f) => inRect({ x: d.ox, z: d.oy, w: d.size, d: d.size }, f.x, f.z))
          .map((f) => ({ x: f.x, z: f.z, w: FOUNTAIN_R * 2 * (f.k ?? 1), d: FOUNTAIN_R * 2 * (f.k ?? 1) })),
      ],
    });
  }
  const sites: BridgeSite[] = layout.walks.flatMap((w) => {
    const a = byId.get(w.from);
    const b = byId.get(w.to);
    if (!a || !b) return [];
    const x = w.axis === "x";
    const [alo, ahi, blo, bhi] = x ? [a.oy, a.oy + a.size, b.oy, b.oy + b.size] : [a.ox, a.ox + a.size, b.ox, b.ox + b.size];
    return [
      {
        from: w.from,
        to: w.to,
        axis: x ? "x" : "z",
        a: (x ? w.a.gx : w.a.gy) + TERRACE_M,
        b: (x ? w.b.gx : w.b.gy) - TERRACE_M,
        mid: x ? w.a.gy : w.a.gx,
        lo: Math.max(alo, blo),
        hi: Math.min(ahi, bhi),
      },
    ];
  });
  const carBridges = planBridges(sites, roadsOf);
  const roadStart = paving.length;
  for (const br of carBridges)
    br.roads.forEach((road, end) =>
      road.forEach((p, k) => {
        if (!k) return;
        // Overlap at the bends, so corners are paved; the last piece stops at the terrace edge.
        const q = road[k - 1];
        const last = k === road.length - 1;
        const ext = (from: number, to: number, e0: number, e1: number) => [from - Math.sign(to - from) * e0, to + Math.sign(to - from) * e1];
        const [x0, x1] = p[0] === q[0] ? [q[0], p[0]] : ext(q[0], p[0], ROAD_W / 2, last ? 0 : ROAD_W / 2);
        const [z0, z1] = p[1] === q[1] ? [q[1], p[1]] : ext(q[1], p[1], ROAD_W / 2, last ? 0 : ROAD_W / 2);
        const slab = strip(x0, z0, x1, z1, ROAD_W, top);
        paving.push(slab);
        pavedIn.get(br.ends[end])!.push(slab);
      }),
    );
  const roadPaving = paving.slice(roadStart);
  // Path lights that would stand in the road give way to it.
  for (let i = bollards.length - 1; i >= 0; i--) if (roadPaving.some((r) => inRect(r, bollards[i].x, bollards[i].z, 0.06))) bollards.splice(i, 1);
  const decks: Rect[] = carBridges.map((br) => {
    const x0 = Math.min(br.a[0], br.b[0]);
    const z0 = Math.min(br.a[1], br.b[1]);
    return br.axis === "x" ? { x: x0, z: br.a[1] - 0.3, w: Math.abs(br.b[0] - br.a[0]), d: 0.6 } : { x: br.a[0] - 0.3, z: z0, w: 0.6, d: Math.abs(br.b[1] - br.a[1]) };
  });

  for (const d of layout.districts) {
    const cx = d.hq.gx + d.hq.size / 2;
    const cz = d.hq.gy + d.hq.size / 2;
    // Trees and flowering shrubs along the terrace edges, clear of houses and paths.
    const blocked = (x: number, z: number) =>
      houses.some((h) => h.projectId === d.project.id && Math.abs(h.x - x) < h.w / 2 + 0.35 && Math.abs(h.z - z) < h.d / 2 + 0.35) ||
      kiosks.some((k) => k.projectId === d.project.id && Math.abs(k.x - x) < k.size / 2 + 0.3 && Math.abs(k.z - z) < k.size / 2 + 0.3) ||
      pavedIn.get(d.project.id)!.some((p) => inRect(p, x, z, 0.22)) ||
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
  }

  // Brooks run along the gaps between shelf rows, under small bridges, and fall into the sea at the shore.
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
      const bx0 = s0 ? x0 : x0 + 0.6;
      const bx1 = s1 ? x1 : r2.x1 < r1.x1 - 1e-6 && !onLand(x1 - 0.42, r2.z + r2.d + 0.2) ? x1 - 0.42 + BROOK_W / 2 : x1 - 0.6;
      brooks.push({ x: bx0, z: z - BROOK_W / 2, w: bx1 - bx0, d: BROOK_W });
      // Where the lower row ends first, the brook turns toward the viewer and falls off the front cliff.
      const turnX = x1 - 0.42;
      const front = r2.z + r2.d;
      const turns = !s1 && r2.x1 < r1.x1 - 1e-6 && !onLand(turnX, front + 0.2);
      if (s1) falls.push({ x: x1, z, axis: "x", dir: 1 });
      else if (turns) {
        brooks.push({ x: turnX - BROOK_W / 2, z: z - BROOK_W / 2, w: BROOK_W, d: front - z + BROOK_W / 2 });
        falls.push({ x: turnX, z: front, axis: "z", dir: 1 });
      } else ponds.push({ x: bx1, y: 0, z, r: 0.45 });
      if (s0) falls.push({ x: x0, z, axis: "x", dir: -1 });
      else ponds.push({ x: bx0, y: 0, z, r: 0.45 });
      for (const w of layout.walks)
        if (w.axis === "y" && w.a.gx > bx0 && w.a.gx < bx1 && w.a.gy < z && w.b.gy > z) bridges.push({ x: w.a.gx - 0.3, z: z - 0.45, w: 0.6, d: 0.9, axis: "z" });
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
    !decks.some((b) => inRect(b, x, z, 0.4)) &&
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
    carBridges,
    ponds,
    falls,
    fountains,
    bollards,
    walks,
    parks,
    houses,
    kiosks,
    towers,
    strays,
    trees,
    bushes,
    rocks,
    bounds: xs.length ? { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) } : { x0: -5, z0: -5, x1: 5, z1: 5 },
  };
}
