import type { ToolFacility } from "../../catalog/toolFacilities";
import { distanceToRoad } from "./highway";
import { STREET_CLEAR } from "./streetAlign";
import { FOUNTAIN_R, type Rect, type Scene3D, type Tower } from "./scene";

// Deterministic placement for satellite Tool Facilities (catalog/toolFacilities.ts). Pure: the same
// scene and facilities always give the same spots, so placements are stable between sessions
// without storing anything, and the map computes them once per layout (never per frame).
//
// 1. Find the parent tower and its district terraces (the only ground a facility may use).
// 2. Size the facility at `scaleFactor` of the parent (width, depth and height).
// 3. Try every spot on a fine grid over those terraces, keeping its margin from the terrace edge.
// 4. Reject spots that touch a tower or its plaza (entrance stairs and plaza lane included),
//    another tool office, a house, a fountain, any paving (paths, plazas, bridge landings), a
//    street, footpath or the railway, or an already placed facility.
// 5. Take the valid spot nearest the parent; ties break by position, never randomly.
// 6. No spot at full size: shrink the footprint step by step (to MIN_SHRINK of full size). Still
//    none: the facility stays unplaced with the reason, rather than forced somewhere invalid.

export interface FacilityPlacement {
  facility: ToolFacility;
  x: number;
  z: number;
  /** Square footprint side and height, already scaled. */
  size: number;
  height: number;
  rotationY: number;
  /** Share of the standard (0.5×) size it was placed at; 1 unless room was tight. */
  fit: number;
}
export interface FacilityPlan {
  placed: FacilityPlacement[];
  unplaced: { facility: ToolFacility; reason: string }[];
}

/** Smallest share of the standard size a facility may shrink to before it is left unplaced. */
export const MIN_SHRINK = 0.6;
const SHRINK_STEPS = [1, 0.9, 0.8, 0.7, MIN_SHRINK];
/** Grid step for candidate spots, map units. */
const STEP = 0.125;
/** Clear ground kept round every facility. */
const CLEARANCE = 0.12;
/** Margin from the terrace edge (the terrace overhangs its lot; keep the facility on solid ground). */
const EDGE = 0.25;
/** Extra space kept between two facilities, on top of CLEARANCE. */
const SIBLING_GAP = 0.25;
/** Half the perimeter railway's width, with its ballast and a little room. */
const RAIL_CLEAR = 0.7;
/** Footpaths and links are about this wide. */
const WALK_CLEAR = 0.24;

/** The plaza square every headquarters stands on (scene.ts, districtGrove): size × 1.25 + 1. */
export const plazaHalf = (t: Pick<Tower, "size">) => (t.size * 1.25 + 1) / 2;

/** Height of the parent building used to scale its facilities (roof height above its plinth). */
export const parentHeight = (t: Pick<Tower, "height" | "customHeight">) => t.customHeight ?? t.height;

const overlaps = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.z < b.z + b.d + pad && a.z + a.d + pad > b.z;
const centred = (x: number, z: number, w: number, d = w): Rect => ({ x: x - w / 2, z: z - d / 2, w, d });

/** Everything a facility may not stand on, as rectangles, plus the street and path centrelines. */
export function facilityObstacles(scene: Scene3D) {
  const boxes: Rect[] = [
    ...scene.towers.map((t) => centred(t.x, t.z, plazaHalf(t) * 2)),
    ...(scene.clearedLots ?? []).map((t) => centred(t.x, t.z, plazaHalf(t) * 2)),
    ...scene.kiosks.map((k) => centred(k.x, k.z, k.size)),
    ...scene.houses.map((h) => centred(h.x, h.z, h.w, h.d)),
    ...scene.fountains.map((f) => centred(f.x, f.z, FOUNTAIN_R * 2 * (f.k ?? 1))),
    ...scene.paving.map(({ x, z, w, d }) => ({ x, z, w, d })),
    ...scene.steps.map(({ x, z, w, d }) => ({ x, z, w, d })),
    ...scene.bridges.map(({ x, z, w, d }) => ({ x, z, w, d })),
    ...(scene.githubAnnex ? [...scene.githubAnnex.tiers, scene.githubAnnex.skybridge].map((b) => ({ x: b.x0, z: b.z0, w: b.x1 - b.x0, d: b.z1 - b.z0 })) : []),
  ];
  const streets = [...scene.transportConnections.flatMap((c) => [c.road, ...(c.frontage ? [c.frontage] : [])]), ...scene.carBridges.flatMap((b) => b.roads)];
  const walks = [...scene.transportConnections.map((c) => c.walk), ...scene.walks.map((w) => [[w.x0, w.z0], [w.x1, w.z1]] as [number, number][])];
  const rails = [scene.communityRail?.loop?.route ?? scene.communityRail?.route].filter((r): r is [number, number][] => !!r && r.length > 1);
  return { boxes, streets, walks, rails };
}

/** Does a square of side `s` at (x, z) clear every obstacle? Returns the first reason it fails. */
export function blockedBy(o: ReturnType<typeof facilityObstacles>, x: number, z: number, s: number): string | null {
  const r = centred(x, z, s);
  if (o.boxes.some((b) => overlaps(r, b, CLEARANCE))) return "building, plaza or paving";
  // Distance from the facility's edge to a street centreline: test its centre and corners against
  // the street's half width plus the footprint's half diagonal, a safe (slightly cautious) bound.
  const reach = (s / 2) * Math.SQRT2;
  if (o.streets.some((p) => distanceToRoad([x, z], p) < STREET_CLEAR + reach)) return "street";
  if (o.walks.some((p) => distanceToRoad([x, z], p) < WALK_CLEAR + reach)) return "footpath";
  if (o.rails.some((p) => distanceToRoad([x, z], p) < RAIL_CLEAR + reach)) return "railway";
  return null;
}

/** Only the obstacles near the ground being searched, so each candidate checks a handful. */
function local(o: ReturnType<typeof facilityObstacles>, ground: Rect[], s: number): ReturnType<typeof facilityObstacles> {
  const pad = s + STREET_CLEAR + CLEARANCE + 0.5;
  const area = ground.map((g) => ({ x: g.x - pad, z: g.z - pad, w: g.w + pad * 2, d: g.d + pad * 2 }));
  const touches = (r: Rect) => area.some((a) => overlaps(a, r));
  const pathNear = (p: [number, number][]) => p.some((q, i) => {
    const a = p[Math.max(0, i - 1)];
    return touches({ x: Math.min(a[0], q[0]), z: Math.min(a[1], q[1]), w: Math.abs(q[0] - a[0]), d: Math.abs(q[1] - a[1]) });
  });
  return { boxes: o.boxes.filter(touches), streets: o.streets.filter(pathNear), walks: o.walks.filter(pathNear), rails: o.rails.filter(pathNear) };
}

/** Place every satellite facility of every parent in `facilities`, in the order given. */
export function planToolFacilities(scene: Scene3D, facilities: ToolFacility[]): FacilityPlan {
  const obstacles = facilityObstacles(scene);
  const placed: FacilityPlacement[] = [];
  const unplaced: FacilityPlan["unplaced"] = [];
  for (const facility of facilities) {
    if (facility.source !== "satellite") continue;
    const parent = scene.towers.find((t) => t.projectId === facility.projectId);
    if (!parent) {
      unplaced.push({ facility, reason: "Its building isn't on the map." });
      continue;
    }
    const ground = scene.terraces.filter((t) => t.id === facility.projectId);
    if (!ground.length) {
      unplaced.push({ facility, reason: "Its district has no terrace to build on." });
      continue;
    }
    const full = parent.size * facility.scaleFactor;
    const fullH = parentHeight(parent) * facility.scaleFactor;
    let best: FacilityPlacement | undefined;
    for (const fit of SHRINK_STEPS) {
      const s = full * fit;
      const near = local(obstacles, ground, s);
      const spots: { x: number; z: number; score: number }[] = [];
      for (const g of ground) {
        const x0 = g.x + EDGE + s / 2, x1 = g.x + g.w - EDGE - s / 2, z0 = g.z + EDGE + s / 2, z1 = g.z + g.d - EDGE - s / 2;
        for (let i = 0; x0 + i * STEP <= x1 + 1e-9; i++)
          for (let j = 0; z0 + j * STEP <= z1 + 1e-9; j++) {
            const x = x0 + i * STEP, z = z0 + j * STEP;
            // Nearest the parent wins; scores round so float noise can't flip a tie.
            spots.push({ x, z, score: Math.round(Math.hypot(x - parent.x, z - parent.z) * 1000) });
          }
      }
      spots.sort((a, b) => a.score - b.score || a.x - b.x || a.z - b.z);
      const pick = spots.find((p) => !blockedBy(near, p.x, p.z, s));
      if (pick) {
        // Face the parent's front (+z), as its own tool offices do.
        best = { facility, x: pick.x, z: pick.z, size: s, height: fullH * fit, rotationY: 0, fit };
        break;
      }
    }
    if (!best) {
      unplaced.push({ facility, reason: `No free ground in its district fits it, even at ${Math.round(MIN_SHRINK * 100)}% of the standard size, clear of streets, paths, the railway, plazas and other buildings.` });
      continue;
    }
    placed.push(best);
    // Siblings keep a walkable gap between them, like the district's other buildings.
    obstacles.boxes.push(centred(best.x, best.z, best.size + SIBLING_GAP * 2));
  }
  return { placed, unplaced };
}

// The plan the map last drew, so the inspector can say where a facility stands, or why it couldn't
// be placed, without building the city again. Null until the map has shown tool facilities.
let latest: FacilityPlan | null = null;
export const rememberFacilityPlan = (plan: FacilityPlan | null) => {
  if (plan) latest = plan;
};
export const latestFacilityPlan = () => latest;
