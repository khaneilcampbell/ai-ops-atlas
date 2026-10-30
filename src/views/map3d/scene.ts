import { toolWorkflowRoads } from "../toolWorkflowLayout";
import { isAiAgent } from "../../catalog/roles";
import type { Agent, Status } from "../../catalog/types";
import { hash, treeSpots, type Layout } from "../mapLayout";
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
  /** Area reserved by an interior cutaway; outdoor crowds must stay outside. */
  pedestrianExclusion?: Rect;
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
  /** Pedestrian paths and level footbridges, with optional continuous building-to-building routes. */
  walks: { x0: number; z0: number; x1: number; z1: number; y?: number; bridge?: boolean; shopEntrance?: boolean; route?: { gx: number; gy: number }[] }[];
  parks: Park[];
  houses: House[];
  kiosks: Kiosk[];
  retail: Kiosk[];
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
  const retail: Kiosk[] = [];
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
    const floors = ["benjaire-site", "github-profile", "intelligence-hub", "service-desk", "benjaire-ops", "soc-lab", "portfolio-site", "career-optimizer"].includes(d.project.id) ? 14 : identity.landmark ? 15 : Math.min(identity.style === "timber" ? 9 : 18, 6 + Math.min(agents, 12));
    const size = d.hq.size * (identity.landmark ? 1.02 : 0.92);
    const cx = d.hq.gx + d.hq.size / 2;
    const cz = d.hq.gy + d.hq.size / 2;
    towers.push({
      key: `project:${d.project.id}`,
      projectId: d.project.id,
      repository: d.project.repository,
      name: d.project.name,
      status: d.project.status,
      agents: d.crew.filter(isAiAgent).length,
      automations: d.crew.filter(a => !isAiAgent(a)).length + d.lots.length,
      identity,
      x: cx,
      z: cz,
      size,
      floors,
      height: floors * FLOOR_H,
    });
    // Paved plaza around the tower, and paths out to each house.
    const pz = d.hq.size * 1.25 + 1.0;
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
        roof: "#58665f",
        wall: a.status === "retired" ? "#d4d6cc" : WALLS[Math.floor(hash(`${a.id}:w`) * WALLS.length)],
        hip: hash(`${a.id}:roof`) > 0.5,
        chimney: hash(`${a.id}:ch`) > 0.4,
        solar: hash(`${a.id}:sol`) > 0.6,
      });
    }
    for (const k of d.kiosks) {
      const kx = k.gx + k.size / 2;
      const kz = k.gy + k.size / 2;
      paving.push(strip(kx, kz + Math.min(k.size, 0.9) * 0.4, kx, k.gy + k.size + 0.25, INNER_PATH_W, top));
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
    for (const path of toolWorkflowRoads({ gx: d.hq.gx, gy: d.hq.gy, size: d.hq.size }, d.kiosks)) {
      for (let i = 1; i < path.length; i++) paving.push(strip(path[i-1].gx, path[i-1].gy, path[i].gx, path[i].gy, INNER_PATH_W, top));
      for (const p of path.slice(1,-1)) {
        const b = { x: p.gx + INNER_PATH_W, y: top, z: p.gy + INNER_PATH_W, s: 1 };
        if (!bollards.some(o => Math.hypot(o.x-b.x,o.z-b.z)<0.3)) bollards.push(b);
      }
    }
    // Light the paths to supporting tool buildings as well as legacy lots.
    for (const l of [...d.lots, ...d.kiosks]) {
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
      ring: towerRing(t, d.hq.size * 1.25 + 1.0),
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

  // A continuous pedestrian network links each front entrance to the dedicated footbridge.
  const pedestrianJourneys = new Map<string, { gx: number; gy: number }[]>();
  for (const w of layout.walks) {
    const x = w.axis === "x";
    const a = x ? { gx: w.a.gx + TERRACE_M, gy: w.a.gy } : { gx: w.a.gx, gy: w.a.gy + TERRACE_M };
    const b = x ? { gx: w.b.gx - TERRACE_M, gy: w.b.gy } : { gx: w.b.gx, gy: w.b.gy - TERRACE_M };
    const approaches = [w.from, w.to].map((id, i) => {
      const d = byId.get(id);
      if (!d) return [];
      const entrance = { gx: d.hq.gx + d.hq.size / 2, gy: d.hq.gy + d.hq.size + 0.25 };
      const path = toolWorkflowRoads(d.hq, d.kiosks, [entrance, i ? b : a])[0] ?? [];
      for (let j = 1; j < path.length; j++) {
        const slab = strip(path[j-1].gx, path[j-1].gy, path[j].gx, path[j].gy, INNER_PATH_W, top);
        paving.push(slab); pavedIn.get(id)!.push(slab);
      }
      return path;
    });
    if (approaches.every(path => path.length > 1)) pedestrianJourneys.set(`${w.from}:${w.to}`, [...approaches[0], ...approaches[1].slice().reverse()]);
  }

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
    parks.push({ id: p.id, label: "Skyline", x: p.ox, z: p.oy, w: p.w, d: p.h });
    // Stagger the tall offices behind the low storefronts, with an open central lobby view.
    const tenants = [
      { name: "Anthropic", dx: -4.3, dz: -2.7, size: 1.4 },
      { name: "OpenAI", dx: 4.3, dz: -2.7, size: 1.1 },
      { name: "Zara", dx: 4.4, dz: 0.5, size: 0.85 },
      { name: "Wells Fargo", dx: -4.4, dz: 0.5, size: 1.2 },
      { name: "Smashburger", dx: -3.2, dz: 3, size: 0.85 },
      { name: "Starbucks", dx: -0.8, dz: 3, size: 0.85 },
      { name: "Chipotle", dx: 2.5, dz: 3, size: 0.85 },
    ];
    for (const tenant of tenants) {
      const x = cx + tenant.dx, z = cz + tenant.dz;
      retail.push({ key: `retail:${p.id}:${tenant.name}`, projectId: p.id, name: tenant.name, users: [], x, z, size: tenant.size, canopy: "#c9a35a" });
      const promenadeZ = tenant.dz < 0 ? cz - 1.2 : cz + 3.9;
      paving.push(strip(x, z + tenant.size * 0.4, x, promenadeZ, 0.32, top));
    }
    for (const side of [-1, 1]) {
      const x = cx + side * 5.4;
      paving.push(strip(x, cz - 1.2, x, cz + 3.9, 0.4, top));
    }
    paving.push(strip(cx-5.4,cz-1.2,cx+5.4,cz-1.2,0.4,top),strip(cx-5.4,cz+3.9,cx+5.4,cz+3.9,0.4,top));
    // Rear observation-wheel plaza connects to the promenade without crossing the lobby.
    paving.push(strip(cx + 2.15, cz - 3.5, cx + 2.15, cz - 1.2, 0.4, top));
    paving.push(strip(cx, cz - 3.5, cx + 2.15, cz - 3.5, 0.4, top));
    // A small paved square with a fountain, and a pond beside it.
    paving.push({ x: cx - 1.1, z: cz - 1.1, w: 2.2, d: 2.2, y: top, h: 0.03 });
    fountains.push({ x: cx - 1.5, z: cz + 1.5, k: 0.45 });
    ponds.push({ x: cx + 1.05, y: top, z: cz + 2.05, r: 0.28 });
    for (const s of treeSpots(p.id, p.ox + 0.2, p.oy + 0.2, p.w - 0.4, Math.round(p.w * 3), p.h - 0.4)) {
      if (Math.abs(s.gx-cx) < 2.3 && Math.abs(s.gy-(cz-3.5)) < 1.05) continue;
      if (Math.abs(s.gx - cx) < 1.95 && Math.abs(s.gy - cz) < 1.4) continue;
      if (retail.some(k => k.projectId === p.id && Math.abs(k.x-s.gx) < k.size/2+0.4 && Math.abs(k.z-s.gy) < k.size/2+0.5)) continue;
      if (paving.some(q => inRect(q, s.gx, s.gy, 0.2))) continue;
      if (ponds.some((q) => Math.hypot(q.x - s.gx, q.z - s.gy) < q.r + 0.3)) continue;
      trees.push({ x: s.gx, y: top, z: s.gy, s: 0.26, kind: hash(`${s.gx}:${s.gy}`) > 0.9 ? "blossom" : "round" });
    }
  }

  // Level pedestrian bridges between terraces.
  const bridges: Scene3D["bridges"] = [];
  const walks: Scene3D["walks"] = [];
  for (const w of layout.walks) {
    const x = w.axis === "x";
    const a = x ? w.a.gx + TERRACE_M : w.a.gy + TERRACE_M;
    const b = x ? w.b.gx - TERRACE_M : w.b.gy - TERRACE_M;
    const c = x ? w.a.gy : w.a.gx;
    // Extend park-side bridge landings into Skyline's front promenade, around its wings.
    for (const [id,endpoint] of [[w.from,x?{gx:a,gy:c}:{gx:c,gy:a}],[w.to,x?{gx:b,gy:c}:{gx:c,gy:b}]] as const) {
      const park=parks.find(p=>p.id===id);
      if(!park) continue;
      const cx=park.x+park.w/2,cz=park.z+park.d/2;

      // Keep each bridge approach straight on arrival; turn only at the front promenade.
      const buildings=[{gx:cx-0.75,gy:cz-0.475,size:1.5},{gx:cx-1.695,gy:cz-0.475,size:0.95},{gx:cx+0.745,gy:cz-0.475,size:0.95},...retail.filter(k=>k.projectId===id).map(k=>({gx:k.x-k.size/2,gy:k.z-k.size/2,size:k.size}))];
      const path=toolWorkflowRoads(buildings[0],buildings.slice(1),[endpoint,{gx:cx,gy:cz+1.35}])[0]??[];
      for(let j=1;j<path.length;j++) paving.push(strip(path[j-1].gx,path[j-1].gy,path[j].gx,path[j].gy,0.4,top));
      if(path.length>1) walks.push({x0:endpoint.gx,z0:endpoint.gy,x1:cx,z1:cz+1.35,y:top,route:path});
    }
    // A level pedestrian boardwalk joins the terraces independently of the road bridge.
    walks.push(x ? { x0: a, z0: c, x1: b, z1: c, y: top, bridge: true, route: pedestrianJourneys.get(`${w.from}:${w.to}`) } : { x0: c, z0: a, x1: c, z1: b, y: top, bridge: true, route: pedestrianJourneys.get(`${w.from}:${w.to}`) });
  }

  // People also stroll the narrow paved routes inside each district, including tool workflows.
  for (const path of paving) {
    if (Math.min(path.w, path.d) > 0.4 || Math.max(path.w, path.d) < 0.55 || path.y < top - 0.05) continue;
    walks.push({ x0: path.x + (path.w > path.d ? 0.08 : path.w / 2), z0: path.z + (path.d > path.w ? 0.08 : path.d / 2), x1: path.x + (path.w > path.d ? path.w - 0.08 : path.w / 2), z1: path.z + (path.d > path.w ? path.d - 0.08 : path.d / 2), y: top });
  }

  // Shop visitors leave the promenade, enter through the center door, and return after a visit.
  for(const shop of retail) {
    const park=parks.find(p=>p.id===shop.projectId)!;
    const startZ=shop.z<park.z+park.d/2 ? park.z+park.d/2-1.2 : park.z+park.d/2+3.9;
    walks.push({x0:shop.x,z0:startZ,x1:shop.x,z1:shop.z+0.12,y:top,shopEntrance:true});
  }

  // Residents approach the lobby, disappear inside, then return to the promenade.
  for (const park of parks) {
    const x=park.x+park.w/2,z=park.z+park.d/2;
    paving.push(strip(x,z+0.25,x,z+1.2,0.5,top),strip(x,z+1.2,x+0.95,z+1.2,0.4,top),strip(x+0.95,z+1.2,x+0.95,park.z+park.d,0.4,top));
    walks.push({x0:x+0.95,z0:park.z+park.d-0.15,x1:x,z1:z+0.25,y:top,shopEntrance:true,route:[{gx:x+0.95,gy:park.z+park.d-0.15},{gx:x+0.95,gy:z+1.2},{gx:x,gy:z+1.2},{gx:x,gy:z+0.25}]});
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

  // Reserve a lawn pocket for each fountain, clear of pedestrian routes and entrances.
  const segmentDistance=(x:number,z:number,a:{gx:number;gy:number},b:{gx:number;gy:number})=>{
    const dx=b.gx-a.gx,dz=b.gy-a.gy;
    const t=Math.max(0,Math.min(1,((x-a.gx)*dx+(z-a.gy)*dz)/(dx*dx+dz*dz||1)));
    return Math.hypot(x-a.gx-t*dx,z-a.gy-t*dz);
  };
  for(const fountain of fountains) {
    const radius=FOUNTAIN_R*(fountain.k??1)+0.3;
    const blocked=(x:number,z:number)=>walks.some(w=>{
      const route=w.route??[{gx:w.x0,gy:w.z0},{gx:w.x1,gy:w.z1}];
      return route.slice(1).some((b,i)=>segmentDistance(x,z,route[i],b)<radius);
    });
    if(!blocked(fountain.x,fountain.z))continue;
    const terrace=terraces.find(t=>inRect(t,fountain.x,fountain.z));
    if(!terrace)continue;
    let moved=false;
    for(let z=terrace.z+0.7;z<terrace.z+terrace.d-0.7&&!moved;z+=0.4)for(let x=terrace.x+0.7;x<terrace.x+terrace.w-0.7;x+=0.4){
      if(blocked(x,z)||paving.some(p=>inRect(p,x,z,radius))||houses.some(h=>Math.abs(h.x-x)<h.w/2+radius&&Math.abs(h.z-z)<h.d/2+radius)||kiosks.some(k=>Math.abs(k.x-x)<k.size/2+radius&&Math.abs(k.z-z)<k.size/2+radius)||towers.some(t=>Math.abs(t.x-x)<t.size/2+radius&&Math.abs(t.z-z)<t.size/2+radius)||retail.some(k=>Math.abs(k.x-x)<k.size/2+radius&&Math.abs(k.z-z)<k.size/2+radius)||trees.some(t=>Math.hypot(t.x-x,t.z-z)<radius+0.3))continue;
      fountain.x=x;fountain.z=z;moved=true;break;
    }
  }

  // A crowded terrace may have no safe decorative pocket. Keep the routes clear rather
  // than leaving a basin on a walking lane after a failed relocation.
  const safeFountains=fountains.filter(f=>walks.every(w=>{
    const route=w.route??[{gx:w.x0,gy:w.z0},{gx:w.x1,gy:w.z1}];
    return route.slice(1).every((b,i)=>segmentDistance(f.x,f.z,route[i],b)>=FOUNTAIN_R*(f.k??1)+0.16);
  }));

  // Keep the marina stair corridor free, including trees on the lower coastal shelf.
  const harborTerrace=terraces.reduce<(typeof terraces)[number] | undefined>((best,t)=>!best || t.z+t.d>best.z+best.d?t:best,undefined);
  if(harborTerrace) {
    const h=harborTerrace, dockX=h.x+h.w/2, edgeZ=h.z+h.d;
    for(const tree of trees) {
      if(Math.abs(tree.x-dockX)>0.9 || tree.z<edgeZ-1 || tree.z>edgeZ+3) continue;
      for(const offset of [-1.4,1.4,-2,2,-2.6,2.6,-3.2,3.2]) {
        const x=dockX+offset,z=edgeZ-0.9;
        if(x<h.x+0.5 || x>h.x+h.w-0.5 || paving.some(p=>inRect(p,x,z,0.5)) || retail.some(k=>Math.hypot(k.x-x,k.z-z)<1) || trees.some(t=>t!==tree&&Math.hypot(t.x-x,t.z-z)<0.7)) continue;
        tree.x=x;tree.z=z;tree.y=top;
        break;
      }
    }
  }

  const xs = land.flatMap((r) => [r.x, r.x + r.w]);
  const zs = land.flatMap((r) => [r.z, r.z + r.d]);
  for (let i=trees.length-1;i>=0;i--) if ((harborTerrace && Math.abs(trees[i].x-(harborTerrace.x+harborTerrace.w/2))<0.9 && trees[i].z>=harborTerrace.z+harborTerrace.d-1 && trees[i].z<=harborTerrace.z+harborTerrace.d+3) || paving.some(p=>p.y>=top && inRect(p,trees[i].x,trees[i].z,0.4)) || retail.some(k=>Math.abs(k.x-trees[i].x)<0.75&&Math.abs(k.z-trees[i].z)<0.75)) trees.splice(i,1);

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
    fountains:safeFountains,
    bollards,
    walks,
    parks,
    houses,
    kiosks,
    retail,
    towers,
    strays,
    trees,
    bushes,
    rocks,
    bounds: xs.length ? { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) } : { x0: -5, z0: -5, x1: 5, z1: 5 },
  };
}
