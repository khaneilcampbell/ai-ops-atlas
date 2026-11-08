import {planRingRoad} from './ringRoad';
import {planPerimeterRail} from './perimeterRailPlan';
import {compactSquareLand} from './compactLand';
import { ANNEX } from "./commerceAnnexPlan";
import {planCommunityRail,planMarketplaceRail,stationAccessAreas,type CommunityPlan,type RailPlan} from './hillsCommunityPlan';
import {planNeighborhoodLinks} from './neighborhoodLinks';
import {cityEnvelope} from './citySpacing';
import {planFinancial,type FinancialPlan} from "./financialPlan";
import {sizeCustomTowers} from "./customTowers";
import {sizeGithubTower} from "./githubTowerPlan";
import {sizeIntelligenceHub} from "./intelligenceHubPlan";
import {addGithubAnnex,type GithubAnnex} from "./githubAnnex";
import {type HillsPlan} from "./hillsPlan";
import {planDealership,type DealershipPlan} from "./dealershipPlan";
import {type FreightPlan} from "./freight";
import {planStadium,type StadiumPlan} from "./stadiumPlan";
import {stadiumPlaza} from "./stadiumGeometry";
import {planStadiumSite,type StadiumSite} from "./stadiumSite";
import {planAgency,type AgencyPlan} from "./marketingAgencyPlan";
import {planMall,type MallPlan} from "./mallPlan";
import {planGalleria,type GalleriaPlan} from "./galleriaPlan";
import {distanceToRoad} from "./highway";
import {districtConnections,type DistrictConnection} from "./connections";
import { AIRPORT_LAYOUT, airportFootprint, airportForecourt, airportPoint, pathCrossesRect, planAirport, type AirportPlan } from "./airport";
import { toolWorkflowRoads } from "../toolWorkflowLayout";
import { isAiAgent } from "../../catalog/roles";
import type { Agent, Status } from "../../catalog/types";
import { DISTRICT_MIN_SIZE, hash, treeSpots, type Layout } from "../mapLayout";
import { identityFor, type BuildingIdentity } from "./identity";
import { DECK_W, planBridges, ROAD_W, stairsOf, towerRing, type BridgeSite, type CarBridge, type DistrictRoads } from "./roads";
import { CITY_SCALE,alignOfficeScale } from "./cityScale";
import { OPEN_LOT_LABEL, openLot } from "./openLot";

// The 3D map reuses the 2D layout: grid x becomes world x and grid y becomes world z, so the
// camera looking from +x+z sees the same arrangement as the isometric map.

/** Height of a district terrace above the meadow, and how far it overhangs its lot. */
export const TERRACE_H = 0.6;
export const TERRACE_M = 0.35;
/** The sea sits this far below the meadow; the cliffs fill the gap. */
export const WATER_Y = -1.4;
export const LAND_BOTTOM = -1.8;
/**
 * Atlas stands on one ground plane (KC, 2026-11-07): open land is level with the district terraces,
 * streets, bridges' landings and stations, instead of a meadow 0.6 below them. It sits a hair under
 * TERRACE_H so a terrace, plaza or forecourt top never flickers against it. Only the canals and the
 * sea stay lower, and only bridges and the elevated railway stay higher.
 */
export const LAND_TOP = TERRACE_H - 0.004;
const INNER_PATH_W = 0.32;
const BROOK_W = 0.55;
/** One headquarters storey: 0.32 grown by CITY_SCALE.hq.storey to sit with the Marketplace. */
export const FLOOR_H = 0.32 * CITY_SCALE.hq.storey;
/** A fountain's basin radius at full size. */
export const FOUNTAIN_R = 0.475;
/** Most the Marketplace site may sit below the open lot (map units); keeps the two side by side. */
const MARKETPLACE_PARK_GAP = 1.125;

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
  /** Roof height for a district tool office, sized with its headquarters (see customTowers.ts). */
  height?: number;
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
  /**
   * Roof height above the floor base for the custom-built HQs (Atlas HQ, Benjaire HQ, the GitHub
   * tower), sized with the Financial District so they stand among its towers, just under the shortest.
   */
  customHeight?: number;
}
export interface StrayBuilding {
  key: string;
  name: string;
  x: number;
  z: number;
  size: number;
  height: number;
}
/** "palm" is drawn by the building it belongs to (Atlas Stadium), not by Landscape. */
export type TreeKind = "round" | "cone" | "blossom" | "palm";
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
  coreLand?:Rect[];
  financial?:FinancialPlan;
  hills?: HillsPlan;
  community?:CommunityPlan;
  communityRail?:RailPlan;
  airport?: AirportPlan;
  transportConnections:DistrictConnection[];
  stadium?: StadiumPlan;
  /** Atlas Stadium's grounds on the open land round its lot: pools, training pitches, car parks, plazas. */
  stadiumSite?: StadiumSite;
  dealership?:DealershipPlan;
  /** Benjaire Marketing Agency on new land in the bay below the Financial District. */
  agency?:AgencyPlan;
  /** Atlas Marketplace mall beside the open lot (once the Skyline park). */
  mall?:MallPlan;
  /** Atlas Galleria, the shopping mall on the green behind the Marketplace (replaced the Marketplace Gardens). */
  galleria?:GalleriaPlan;
  /**
   * Canva's freight route to the airport. Not built since KC's 2026-11-07 road review: the Commerce
   * district keeps its own streets and grass, without a trunk road or truck lot cut through it.
   */
  freight?: FreightPlan;
  /** Area reserved by an interior cutaway; outdoor crowds must stay outside. */
  pedestrianExclusion?: Rect;
  land: Rect[];
  /** Land-backed neighborhood connections share the terrace elevation. */
  neighborhoodLand?: Rect[];
  /** Terrace-height land joining the airport entrance to the district across from it. */
  airportForecourt?: Rect;
  /** Low land lifted to terrace height where it sits inside a neighborhood green. */
  raisedLand?: Rect[];
  terraces: Terrace[];
  /** Land added beside the GitHub terrace for its glass podium, when a side is free. */
  githubAnnex?: GithubAnnex;
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

/**
 * Candidate tree spots for a widened district's grounds: an even grid over the lot, inset from
 * its edges, outside the tower's plaza. The caller drops any that land on a road or path.
 */
export function districtGrove(d: { ox: number; oy: number; size: number; hq: { size: number } }, cx: number, cz: number, step = 0.85): [number, number][] {
  const out: [number, number][] = [], plaza = (d.hq.size * 1.25 + 1.0) / 2 + 0.35, inset = 0.55;
  for (let x = d.ox + inset; x <= d.ox + d.size - inset + 1e-6; x += step)
    for (let z = d.oy + inset; z <= d.oy + d.size - inset + 1e-6; z += step)
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) > plaza) out.push([x, z]);
  return out;
}

/** The whole city, then the GitHub tower's podium on whatever open ground is left (githubAnnex.ts). */
export function buildScene(layout: Layout): Scene3D {
  const scene = buildCity(layout);
  addGithubAnnex(scene);
  return scene;
}

function buildCity(layout: Layout): Scene3D {
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
    const floors = ["benjaire-site", "github-profile", "intelligence-hub", "service-desk", "benjaire-ops", "soc-lab", "portfolio-site", "career-optimizer"].includes(d.project.id) ? 14 : identity.landmark ? 15 : Math.min(identity.style === "timber" ? 9 : 18, 6 + Math.min(agents, 12));
    const size = d.hq.size * (identity.landmark ? 1.02 : 0.92) * CITY_SCALE.hq.footprint;
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
      paving.push(strip(kx, kz + (d.project.id === ANNEX.projectId ? k.size * 0.3 : Math.min(k.size, 0.9) * 0.4), kx, k.gy + k.size + 0.25, INNER_PATH_W, top));
      kiosks.push({
        key: `service:${d.project.id}:${k.service.id}`,
        projectId: d.project.id,
        name: k.service.name,
        users: k.service.users.map((a) => a.name),
        x: kx,
        z: kz,
        // Commerce tool offices are the tower's teardrop siblings and use their whole lot (commerceAnnexPlan).
        size: d.project.id === ANNEX.projectId ? k.size : Math.min(k.size, 0.9),
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
        // Fountains are not obstacles: the street grid is laid first, and a fountain in a street's way
        // moves to a lawn pocket below, the way a real city lays its streets before the decoration.
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
    return br.axis === "x" ? { x: x0, z: br.a[1] - DECK_W / 2, w: Math.abs(br.b[0] - br.a[0]), d: DECK_W } : { x: br.a[0] - DECK_W / 2, z: z0, w: DECK_W, d: Math.abs(br.b[1] - br.a[1]) };
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
    // The Intelligence Hub's widened district keeps the planting it had at 5 across, spread over the
    // bigger lawn: a tree costs over a thousand triangles a frame and the map is at its budget.
    const planted = d.project.id === "intelligence-hub" ? 2.5 : d.size;
    for (const s of treeSpots(d.project.id, d.ox - 0.15, d.oy - 0.15, d.size + 0.3, Math.round(planted * 3.4))) {
      if (blocked(s.gx, s.gy)) continue;
      const pick = hash(`${s.gx.toFixed(2)}:${s.gy.toFixed(2)}`);
      trees.push({ x: s.gx, y: top, z: s.gy, s: 0.24 + (s.r - 7) * 0.025, kind: pick < 0.2 ? "cone" : pick > 0.95 ? "blossom" : "round" });
    }
    for (const s of treeSpots(`${d.project.id}:bush`, d.ox + 0.2, d.oy + 0.2, d.size - 0.4, Math.round(planted * 2.2))) {
      if (blocked(s.gx, s.gy)) continue;
      bushes.push({ x: s.gx, y: top, z: s.gy, s: 0.1 + hash(`${s.gx}:${s.gy}:b`) * 0.06 });
    }
    // A widened district's extra land becomes planted grounds: rows of trees over the open lawn,
    // clear of every road, path and plaza, like a tree-lined city block (see DISTRICT_MIN_SIZE).
    if (DISTRICT_MIN_SIZE[d.project.id] && d.project.id !== "intelligence-hub") for (const [x, z] of districtGrove(d, cx, cz)) {
      if (blocked(x, z) || paving.some((p) => inRect(p, x, z, 0.42)) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 0.5)) continue;
      trees.push({ x, y: top, z, s: 0.22 + hash(`${x.toFixed(2)}:${z.toFixed(2)}:g`) * 0.06, kind: hash(`${x.toFixed(2)}:${z.toFixed(2)}`) > 0.9 ? "blossom" : "round" });
    }
  }

  for (const p of layout.parks) {
    if (p.strays.length) {
      for (const s of p.strays) strays.push({ key: `repo:${s.name}`, name: s.name, x: s.gx + s.size / 2, z: s.gy + s.size / 2, size: s.size * 1.2, height: 0.9 + hash(s.name) * 0.7 });
      continue;
    }
    // The open lot is plain level lawn, ready for the next build (KC, 2026-11-08: the Skyline
    // residences, shops and wheel that stood here were removed to make space). The Marketplace, the
    // airport road and the railway still take their places from it.
    terraces.push({ id: p.id, park: true, x: p.ox, z: p.oy, w: p.w, d: p.h });
    parks.push({ id: p.id, label: OPEN_LOT_LABEL, x: p.ox, z: p.oy, w: p.w, d: p.h });
  }

  // Level pedestrian bridges between terraces.
  const bridges: Scene3D["bridges"] = [];
  const walks: Scene3D["walks"] = [];
  for (const w of layout.walks) {
    const x = w.axis === "x";
    const a = x ? w.a.gx + TERRACE_M : w.a.gy + TERRACE_M;
    const b = x ? w.b.gx - TERRACE_M : w.b.gy - TERRACE_M;
    const c = x ? w.a.gy : w.a.gx;
    // A level pedestrian boardwalk joins the terraces independently of the road bridge.
    walks.push(x ? { x0: a, z0: c, x1: b, z1: c, y: top, bridge: true, route: pedestrianJourneys.get(`${w.from}:${w.to}`) } : { x0: c, z0: a, x1: c, z1: b, y: top, bridge: true, route: pedestrianJourneys.get(`${w.from}:${w.to}`) });
  }

  // People also stroll the narrow paved routes inside each district, including tool workflows.
  for (const path of paving) {
    if (Math.min(path.w, path.d) > 0.4 || Math.max(path.w, path.d) < 0.55 || path.y < top - 0.05) continue;
    walks.push({ x0: path.x + (path.w > path.d ? 0.08 : path.w / 2), z0: path.z + (path.d > path.w ? 0.08 : path.d / 2), x1: path.x + (path.w > path.d ? path.w - 0.08 : path.w / 2), z1: path.z + (path.d > path.w ? path.d - 0.08 : path.d / 2), y: top });
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
  // Within this distance of a district street's centre line a basin would sit on the road or its sidewalk.
  const onBridgeRoad=(x:number,z:number,r:number)=>carBridges.some(br=>br.roads.some(road=>road.slice(1).some((b,i)=>segmentDistance(x,z,{gx:road[i][0],gy:road[i][1]},{gx:b[0],gy:b[1]})<r+ROAD_W/2+0.18)));
  for(const fountain of fountains) {
    const radius=FOUNTAIN_R*(fountain.k??1)+0.3;
    const blocked=(x:number,z:number)=>walks.some(w=>{
      const route=w.route??[{gx:w.x0,gy:w.z0},{gx:w.x1,gy:w.z1}];
      return route.slice(1).some((b,i)=>segmentDistance(x,z,route[i],b)<radius);
    })||onBridgeRoad(x,z,radius);
    if(!blocked(fountain.x,fountain.z))continue;
    const terrace=terraces.find(t=>inRect(t,fountain.x,fountain.z));
    if(!terrace)continue;
    let moved=false;
    for(let z=terrace.z+0.7;z<terrace.z+terrace.d-0.7&&!moved;z+=0.4)for(let x=terrace.x+0.7;x<terrace.x+terrace.w-0.7;x+=0.4){
      if(blocked(x,z)||paving.some(p=>inRect(p,x,z,radius))||houses.some(h=>Math.abs(h.x-x)<h.w/2+radius&&Math.abs(h.z-z)<h.d/2+radius)||kiosks.some(k=>Math.abs(k.x-x)<k.size/2+radius&&Math.abs(k.z-z)<k.size/2+radius)||towers.some(t=>Math.abs(t.x-x)<t.size/2+radius&&Math.abs(t.z-z)<t.size/2+radius)||trees.some(t=>Math.hypot(t.x-x,t.z-z)<radius+0.3))continue;
      fountain.x=x;fountain.z=z;moved=true;break;
    }
  }

  // A crowded terrace may have no safe decorative pocket. Keep the routes clear rather
  // than leaving a basin on a walking lane after a failed relocation.
  const safeFountains=fountains.filter(f=>walks.every(w=>{
    const route=w.route??[{gx:w.x0,gy:w.z0},{gx:w.x1,gy:w.z1}];
    return route.slice(1).every((b,i)=>segmentDistance(f.x,f.z,route[i],b)>=FOUNTAIN_R*(f.k??1)+0.16);
  })&&!onBridgeRoad(f.x,f.z,FOUNTAIN_R*(f.k??1)+0.08));

  // Keep the marina stair corridor free, including trees on the lower coastal shelf.
  const harborTerrace=terraces.reduce<(typeof terraces)[number] | undefined>((best,t)=>!best || t.z+t.d>best.z+best.d?t:best,undefined);
  if(harborTerrace) {
    const h=harborTerrace, dockX=h.x+h.w/2, edgeZ=h.z+h.d;
    for(const tree of trees) {
      if(Math.abs(tree.x-dockX)>0.9 || tree.z<edgeZ-1 || tree.z>edgeZ+3) continue;
      for(const offset of [-1.4,1.4,-2,2,-2.6,2.6,-3.2,3.2]) {
        const x=dockX+offset,z=edgeZ-0.9;
        if(x<h.x+0.5 || x>h.x+h.w-0.5 || paving.some(p=>inRect(p,x,z,0.5)) || trees.some(t=>t!==tree&&Math.hypot(t.x-x,t.z-z)<0.7)) continue;
        tree.x=x;tree.z=z;tree.y=top;
        break;
      }
    }
  }

  const cityLand=land.slice();
  const airport = planAirport(land, paving, openLot(parks));
  // Align the airport north edge with the future Financial waterfront, before planning neighbors.
  if(airport){airport.publicViaZ=undefined;airport.z=Math.min(...cityLand.map(r=>r.z))-AIRPORT_LAYOUT.landZ;}
  if (airport) {
    // Clear only decorative trees touching the new road/sidewalk approach.
    for(let i=trees.length-1;i>=0;i--)if(trees[i].x>=Math.min(airport.accessX,airport.x)-.35&&trees[i].x<=Math.max(airport.accessX,airportFootprint(airport).x+airportFootprint(airport).w)+.35&&Math.abs(trees[i].z-airport.accessZ)<.95)trees.splice(i,1);
    land.push(airportFootprint(airport));

  }
  // The bigger stadium lot must also keep clear of the airport's public road and walk.
  const airportAccess=airport?(()=>{const f=airportPoint(airport,-1.5,6),x0=Math.min(airport.accessX,f[0])-.9,x1=Math.max(airport.accessX,f[0])+.9;return [{x:x0,z:airport.accessZ-.9,w:x1-x0,d:1.8+.6}];})():[];
  const profile=terraces.find(t=>t.id==="github-profile"),blocks=()=>[...[...towers,...kiosks].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size})),...fountains.map(f=>({x:f.x,z:f.z,w:FOUNTAIN_R*2*(f.k??1),d:FOUNTAIN_R*2*(f.k??1)}))];
  // Centred in its open land when its roads and walks can still reach it; otherwise beside GitHub Profile.
  let stadium=planStadium([...land,...airportAccess],paving,profile);
  if(stadium&&districtConnections(airport,stadium,blocks()).some(l=>!l.road.length||!l.walk.length))stadium=planStadium([...land,...airportAccess],paving,profile,false);
  if(stadium)land.push({x:stadium.x-2,z:stadium.z-2,w:stadium.w+4,d:stadium.d+4});
  if(stadium){
    // Atlas Stadium's plaza: a ring of trees with planted beds, and lit bollards on the approach.
    const plaza=stadiumPlaza(stadium);
    // Palms in a ring round the stadium (KC, 2026-11-07), drawn with the stadium's plain boxes.
    trees.push(...plaza.trees.map(([x,z],i)=>({x,z,y:top,s:.3+(i%3)*.03,kind:'palm' as TreeKind})));
    bushes.push(...plaza.beds.map(([x,z],i)=>({x,y:top,z,s:.13+(i%2)*.03})));bollards.push(...plaza.bollards.map(([x,z])=>({x,y:top,z,s:1})));
  }
  // Marketplace owns its local access reservation; removing a residential district must not remove the mall.
  const core=cityEnvelope(cityLand)!;
  // The lot sits just south of the open lot, so it must follow that, not the core's south edge: a
  // project dropping out of the catalog (an archived repository) moves the two apart and the whole
  // Marketplace, its garden and the railway used to disappear.
  const sky=openLot(parks);
  const marketplaceSite={x:core.x+core.w-27,z:sky?Math.min(core.z+core.d,sky.z+sky.d+MARKETPLACE_PARK_GAP)+.6:core.z+core.d+.6,w:0,d:0};
  const hills:HillsPlan|undefined=undefined;
  sizeCustomTowers(towers, kiosks);
  sizeGithubTower(towers);
  sizeIntelligenceHub(towers);
  const financial=planFinancial({stadium,land,towers,kiosks,airport,terraces,carBridges,paving,coreLand:cityLand});
  if(financial)alignOfficeScale(towers,financial.referenceHeight);
  if(financial)land.push({x:financial.x,z:financial.z,w:financial.w,d:financial.d});
  if(financial?.circa){const c=financial.circa;land.push({x:c.x,z:c.z,w:c.w,d:c.d});}
  const community:CommunityPlan|undefined=undefined;
  // BMW takes the waterfront parcel east of the district; the train now stops in Financial Park.
  const dealership=planDealership({financial});
  if(dealership)land.push(dealership.lot);
  const connections=districtConnections(airport,stadium,[...[...towers,...kiosks].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size})),...fountains.map(f=>({x:f.x,z:f.z,w:FOUNTAIN_R*2*(f.k??1),d:FOUNTAIN_R*2*(f.k??1)}))]);
  if(dealership)connections.push({id:"bmw-dealership",road:dealership.road,walk:dealership.walk});
  if(financial)connections.push({id:"financial-district",road:financial.road,walk:financial.walk,frontage:financial.street});
  const neighborhood=planNeighborhoodLinks({marketplace:marketplaceSite,hills,financial,stadium,parks,land,carBridges,paving,coreLand:cityLand,links:connections,obstacles:[...[...towers,...kiosks].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size})),...fountains.map(f=>({x:f.x,z:f.z,w:FOUNTAIN_R*2*(f.k??1),d:FOUNTAIN_R*2*(f.k??1)})),...(stadium?[{x:stadium.x+stadium.w/2,z:stadium.z+stadium.d/2,w:stadium.w,d:stadium.d}]:[])]});
  connections.push(...neighborhood.links);land.push(...neighborhood.land);
  for(const path of neighborhood.walks){
    for(let i=1;i<path.length;i++)paving.push(strip(...path[i-1],...path[i],.48,top));
    walks.push({x0:path[0][0],z0:path[0][1],x1:path[path.length-1][0],z1:path[path.length-1][1],y:top+.08,route:path.map(([gx,gy])=>({gx,gy}))});
  }
  trees.push(...neighborhood.trees.map(([x,z])=>({x,z,y:top,s:.28,kind:'round' as const})));
  for(const link of connections){
    const route=link.walk.map(([gx,gy])=>({gx,gy}));
    walks.push({x0:route[0].gx,z0:route[0].gy,x1:route[route.length-1].gx,z1:route[route.length-1].gy,y:top+.08,route});
  }
  const agency=planAgency({city:cityLand,land,top,paving,terraces,roads:[...carBridges.flatMap(b=>b.roads),...connections.flatMap(c=>[c.road,c.walk])],obstacles:[...towers,...kiosks].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}))});
  if(agency){
    const inLot=(x:number,z:number,pad:number)=>agency.land.some(r=>inRect(r,x,z,pad));
    for(let i=rocks.length-1;i>=0;i--)if(inLot(rocks[i].x,rocks[i].z,.5))rocks.splice(i,1);
    land.push(...agency.land);paving.push(...agency.paving);
    trees.push(...agency.trees.map(([x,z],i)=>({x,z,y:top,s:.27+(i%3)*.03,kind:(i%4===1?'cone':'round') as TreeKind})));
    for(const path of agency.walks)walks.push({x0:path[0][0],z0:path[0][1],x1:path[path.length-1][0],z1:path[path.length-1][1],y:top+.08,route:path.map(([gx,gy])=>({gx,gy}))});
  }
  for(const items of [trees,bushes,rocks,bollards])for(let i=items.length-1;i>=0;i--)if(connections.some(link=>distanceToRoad([items[i].x,items[i].z],link.road)<.5||distanceToRoad([items[i].x,items[i].z],link.walk)<.45))items.splice(i,1);
  const mall=planMall({parks,land,towers,kiosks,marketplace:marketplaceSite,hills,links:connections,roads:[...connections.map(c=>c.road)]});
  if(mall)for(const items of [trees,bushes,rocks,bollards])for(let i=items.length-1;i>=0;i--)if(items[i].x>mall.x-.2&&items[i].x<mall.x+mall.w+.2&&items[i].z>mall.z-.2&&items[i].z<mall.z+mall.d+.2)items.splice(i,1);
  if(mall){
    const edge=mall.plaza.z+mall.plaza.d+.3,side=mall.x+mall.w+.4;
    const path:[[number,number],[number,number],[number,number]]=[[mall.cx,edge],[side,edge],[side,edge-2.5]];
    for(let i=1;i<path.length;i++)paving.push(strip(...path[i-1],...path[i],.48,top));
    walks.push({x0:path[0][0],z0:path[0][1],x1:path[2][0],z1:path[2][1],y:top+.08,route:path.map(([gx,gy])=>({gx,gy}))});
  }
  // Plain meadow filling the island out to a square; the stadium grounds may build on it. It is laid
  // before the Galleria, whose lot behind the Marketplace can reach onto it when a smaller catalog
  // moves the Marketplace toward the island's edge.
  const meadowLand=compactSquareLand(land,cityLand);
  land.push(...meadowLand);
  let galleria=mall?planGalleria(mall,land,[...[...towers,...kiosks].map(b=>({x:b.x-b.size/2,z:b.z-b.size/2,w:b.size,d:b.size})),...houses.map(h=>({x:h.x-h.w/2,z:h.z-h.d/2,w:h.w,d:h.d})),...paving.filter(p=>p.y>=top)],top,{roads:[...connections.map(c=>c.road),...carBridges.flatMap(b=>b.roads)],walks:connections.map(c=>c.walk)}):undefined;
  if(galleria){
    const r=galleria.rect;
    for(const items of [trees,bushes,rocks,bollards])for(let i=items.length-1;i>=0;i--)if(items[i].x>r.x-.2&&items[i].x<r.x+r.w+.2&&items[i].z>r.z-.2&&items[i].z<r.z+r.d+.2)items.splice(i,1);
    trees.push(...galleria.trees);bushes.push(...galleria.bushes);
  }
  // Close the ring road round the city, clear of every building, the Marketplace and its Galleria.
  const ring=planRingRoad(connections,financial?.street,[
    ...[...towers,...kiosks].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size})),...houses.map(h=>({x:h.x,z:h.z,w:h.w,d:h.d})),
    ...fountains.map(f=>({x:f.x,z:f.z,w:FOUNTAIN_R*2*(f.k??1),d:FOUNTAIN_R*2*(f.k??1)})),
    ...(mall?[{x:mall.x+mall.w/2,z:mall.z+mall.d/2,w:mall.w,d:mall.d}]:[]),...(galleria?[{x:galleria.rect.x+galleria.rect.w/2,z:galleria.rect.z+galleria.rect.d/2,w:galleria.rect.w,d:galleria.rect.d}]:[]),
    ...(stadium?[{x:stadium.x+stadium.w/2,z:stadium.z+stadium.d/2,w:stadium.w,d:stadium.d}]:[]),
    // BMW: its showroom and the cars on display; the drive aisle in front is already a street.
    ...(dealership?[{x:dealership.showroom.cx,z:dealership.showroom.cz,w:dealership.showroom.w,d:dealership.showroom.d},...dealership.cars.map(c=>({x:c.x,z:c.z,w:.6,d:.6}))]:[])]);
  connections.push(...ring);
  for(const items of [trees,bushes,rocks,bollards])for(let i=items.length-1;i>=0;i--)if(ring.some(link=>distanceToRoad([items[i].x,items[i].z],link.road)<.55))items.splice(i,1);
  const communityRail=mall&&financial?planMarketplaceRail(mall,financial,land,airport,[...[...towers,...kiosks].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size})),{x:mall.cx,z:mall.cz,w:mall.w,d:mall.d},...(stadium?[{x:stadium.x+stadium.w/2,z:stadium.z+stadium.d/2,w:stadium.w,d:stadium.d}]:[]),...(airport?(()=>{const r=airportFootprint(airport);return [{x:r.x+r.w/2,z:r.z+r.d/2,w:r.w,d:r.d}];})():[])]):planCommunityRail(community,financial,dealership?.lot);
  if(communityRail)communityRail.loop=planPerimeterRail({land,financial,mall,airport,stadium,towers,kiosks,dealership});
  // Keep station walks clear of plaza trees, beds and bollards.
  const stationWalks=communityRail?.loop?.stops.map(st=>st.walk.map(([x,,z]):[number,number]=>[x,z]))??[];
  for(const items of [trees,bushes,bollards])for(let i=items.length-1;i>=0;i--)if(stationWalks.some(w=>distanceToRoad([items[i].x,items[i].z],w)<.45))items.splice(i,1);
  if(communityRail){
    // Only the old two-stop line has stairs behind the Marketplace; the perimeter loop's stations
    // stand on the rail ring and keep their own walks clear (above), so its unused stop clears nothing.
    const areas=communityRail.loop?[]:stationAccessAreas(communityRail.hills);
    const touches=(x:number,z:number,w:number,d:number)=>areas.some(a=>x+w/2>a.x&&x-w/2<a.x+a.w&&z+d/2>a.z&&z-d/2<a.z+a.d);
    // The Galleria never stands in a station's stair or lift opening; where one falls on its lot,
    // the green stays open instead.
    if(galleria){const f=galleria.footprint;if(touches(f.x+f.w/2,f.z+f.d/2,f.w,f.d)){const own=new Set<object>([...galleria.trees,...galleria.bushes]);for(const items of [trees,bushes])for(let i=items.length-1;i>=0;i--)if(own.has(items[i]))items.splice(i,1);galleria=undefined;}}
    // Parking and ramp stay flat where a station's stair or lift lands; cars and walls step aside.
    if(galleria){galleria.boxes=galleria.boxes.filter(b=>b.h+b.y<=.03||!touches(b.x,b.z,b.w,b.d));for(const items of [galleria.trees,galleria.bushes])for(let i=items.length-1;i>=0;i--)if(touches(items[i].x,items[i].z,.5,.5))items.splice(i,1);}
    // Planting must not stand in the station's stair or lift opening.
    for(const items of [trees,bushes,rocks,bollards])for(let i=items.length-1;i>=0;i--)if(touches(items[i].x,items[i].z,.5,.5))items.splice(i,1);
  }
  // Trees, bushes and ponds planted on open land stand on the one ground plane, not 0.6 below it.
  for(const items of [trees,bushes,ponds])for(const item of items)if(Math.abs(item.y)<.05)item.y=LAND_TOP;
  const xs = land.flatMap((r) => [r.x, r.x + r.w]);
  const zs = land.flatMap((r) => [r.z, r.z + r.d]);
  // Join the terminal entrance to the district across the meadow, unless a street, path or stream runs there.
  const forecourtLand:Rect[]=[];
  const forecourt=airport?airportForecourt(airport,terraces):undefined;
  if(forecourt&&airport){
    const ground=[...connections.map(c=>c.road)];
    const blocked=ground.some(p=>pathCrossesRect(p,forecourt,.35))||[...brooks,...bridges].some(r=>r.x<forecourt.x+forecourt.w&&r.x+r.w>forecourt.x&&r.z<forecourt.z+forecourt.d&&r.z+r.d>forecourt.z);
    if(!blocked){
      forecourtLand.push(forecourt);
      const ez=airport.z+AIRPORT_LAYOUT.terminalZ;
      paving.push(strip(forecourt.x,ez,forecourt.x+forecourt.w,ez,1.4,top));
      for(const items of [trees,bushes,rocks,bollards])for(let i=items.length-1;i>=0;i--)if(inRect(forecourt,items[i].x,items[i].z,.3))items.splice(i,1);
    }
  }
  // Atlas Stadium takes the open land round its lot, last, so no other plan moves.
  const env=cityEnvelope(land);
  const stadiumSite=stadium&&env?planStadiumSite({stadium,envelope:env,
    land:[...land.filter(r=>!meadowLand.includes(r)),...forecourtLand,...brooks,...bridges,...ponds.map(p=>({x:p.x-p.r,z:p.z-p.r,w:p.r*2,d:p.r*2})),...houses.map(h=>({x:h.x-h.w/2,z:h.z-h.d/2,w:h.w,d:h.d})),
      ...fountains.map(f=>({x:f.x-FOUNTAIN_R*(f.k??1),z:f.z-FOUNTAIN_R*(f.k??1),w:FOUNTAIN_R*2*(f.k??1),d:FOUNTAIN_R*2*(f.k??1)}))],
    paths:[...connections.flatMap(c=>[c.road,c.walk,...(c.frontage?[c.frontage]:[])]),...carBridges.flatMap(b=>b.roads),...stationWalks,
      ...walks.map((w):[number,number][]=>w.route?w.route.map(r=>[r.gx,r.gy]):[[w.x0,w.z0],[w.x1,w.z1]])]}):undefined;
  if(stadiumSite&&stadium){
    const r=stadiumSite.site,lot={x:stadium.x-2,z:stadium.z-2,w:stadium.w+4,d:stadium.d+4};
    // The grounds are open lawn round the stadium: no scattered meadow planting; the plaza inside the lot stays.
    for(const items of [trees,bushes,rocks])for(let i=items.length-1;i>=0;i--)if(inRect(r,items[i].x,items[i].z)&&!inRect(lot,items[i].x,items[i].z))items.splice(i,1);
  }
  for (let i=trees.length-1;i>=0;i--) if ((harborTerrace && Math.abs(trees[i].x-(harborTerrace.x+harborTerrace.w/2))<0.9 && trees[i].z>=harborTerrace.z+harborTerrace.d-1 && trees[i].z<=harborTerrace.z+harborTerrace.d+3) || paving.some(p=>p.y>=top && inRect(p,trees[i].x,trees[i].z,0.4))) trees.splice(i,1);

  if(stadiumSite)stadiumSite.palms=trees.filter(t=>t.kind==='palm').map(t=>[t.x,t.z] as [number,number]);
  return {
    financial,
    community,
    coreLand:cityLand,communityRail,
    hills,
    airport,
    transportConnections:connections,
    stadium,
    stadiumSite,
    dealership,
    agency,
    land,
    neighborhoodLand:neighborhood.land,
    airportForecourt:forecourtLand[0],
    mall,
    galleria,
    raisedLand:neighborhood.raised,
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
    towers,
    strays,
    trees,
    bushes,
    rocks,
    bounds: xs.length ? { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) } : { x0: -5, z0: -5, x1: 5, z1: 5 },
  };
}
