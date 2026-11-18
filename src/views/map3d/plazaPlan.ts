import type { Point, Rect, Scene3D, Tree } from "./scene";
import { ROAD_W, type Pt } from "./roads";
import { streetHitTest } from "./streetAlign";

/**
 * Atlas Automation Plaza: a round landscaped plaza on the lawn where the Career Applications tower
 * stood (its vacant lot, kept since 2026-11-10 so nothing else moves). Everything fits inside the
 * lot and the open lawn around it: no building, road, district or the perimeter train moves.
 * Angles are measured in the map's x/z plane: x = cx + r cos(a), z = cz + r sin(a).
 */
export const PLAZA_KEY = "service:automation-plaza";
export const PLAZA_NAME = "Atlas Automation Plaza";
export const PLAZA_LOT = "park:vacant:career-optimizer";

export const PLAZA = {
  /** Paved disc. */
  radius: 1.95,
  /** Curved steps run round the front, from the disc out to this radius. */
  stepsOuter: 2.3,
  /** Planted beds ring the disc between these radii, broken by the entrances. */
  bedInner: 1.5,
  bedOuter: 1.9,
  /** The disc sits this high above the lawn; the steps climb to it. */
  rise: 0.09,
  enclosureRadius: 0.78,
  enclosureHeight: 1.5,
  pedestalRadius: 0.36,
  /** Ring centre height above the disc. */
  ringHeight: 0.6,
  ringRadii: [0.6, 0.54, 0.48] as const,
  ringTube: 0.032,
  /** Gold paths are laid this wide, a hair above the ground they cross. */
  pathWidth: 0.07,
  /** Only buildings this close get a path, so the lines stay local to the plaza. */
  pathReach: 13.5,
  /** The front faces the map's default camera (from +x, +z). */
  front: Math.PI / 4,
  /** Half the angle of each entrance gap in the beds. */
  gap: 0.24,
} as const;

export interface PlazaPath {
  /** The building's map key (project:<id>). */
  key: string;
  projectId: string;
  from: Pt;
  to: Pt;
  /** Entrance angle on the plaza. */
  angle: number;
}

export interface PlazaPlan {
  cx: number;
  cz: number;
  lot: Rect;
  /** Entrance angles: the front steps plus one per path. */
  entrances: number[];
  /** Bed arcs [from, to] in radians, between the entrances. */
  beds: [number, number][];
  benches: { x: number; z: number; ry: number }[];
  lamps: Pt[];
  sign: { x: number; z: number; ry: number; w: number; h: number };
  /** The amber "needs attention" and green "completed" markers stand either side of the front steps. */
  markers: { attention: Pt; done: Pt };
  paths: PlazaPath[];
}

const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
/** Signed shortest difference between two angles. */
export const angleGap = (a: number, b: number) => {
  const d = norm(a - b);
  return d > Math.PI ? d - 2 * Math.PI : d;
};

/** A long straight street can pass the lot with both ends far away. */
function segmentCrossesLot(a: Pt, b: Pt, lot: { x: number; z: number; w: number; d: number }, m: number): boolean {
  return Math.max(a[0], b[0]) > lot.x - m && Math.min(a[0], b[0]) < lot.x + lot.w + m && Math.max(a[1], b[1]) > lot.z - m && Math.min(a[1], b[1]) < lot.z + lot.d + m;
}

/** The plaza on its lot, or undefined when the lot isn't on the map. */
export function planPlaza(s: Pick<Scene3D, "parks" | "towers"> & { cleared?: ReadonlySet<string>; roads?: Pt[][] }): PlazaPlan | undefined {
  const lot = s.parks.find((p) => p.id === PLAZA_LOT);
  if (!lot) return;
  // The lot's west edge runs under the middle avenue, so the plaza slides east onto open lawn until its
  // rim keeps a kerb's width from every street.
  // Only the street segments near the lot matter; a big city has thousands.
  const m = PLAZA.radius + ROAD_W + 2.5;
  const segs: Pt[][] = [];
  for (const r of s.roads ?? []) for (let k = 1; k < r.length; k++) if (segmentCrossesLot(r[k - 1], r[k], lot, m)) segs.push([r[k - 1], r[k]]);
  const street = streetHitTest(segs, ROAD_W / 2 + 0.55);
  const hits = (x: number, z: number) => Array.from({ length: 48 }, (_, i) => (i / 48) * Math.PI * 2).some((a) => street(x + PLAZA.radius * Math.cos(a), z + PLAZA.radius * Math.sin(a)));
  let cx = lot.x + lot.w / 2;
  const cz = lot.z + lot.d / 2;
  for (let n = 0; n < 40 && hits(cx, cz); n++) cx += 0.05;
  cx = Math.round(cx * 100) / 100;
  // A gold path to each nearby headquarters, leaving the plaza on the side that faces it.
  const paths: PlazaPath[] = [];
  for (const t of s.towers) {
    // A cleared lot draws no building, so nothing to lead to.
    if (s.cleared?.has(t.projectId)) continue;
    const dx = t.x - cx;
    const dz = t.z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist > PLAZA.pathReach || dist < PLAZA.radius + t.size) continue;
    const ux = dx / dist;
    const uz = dz / dist;
    const angle = Math.atan2(dz, dx);
    const stop = dist - (t.size / 2 + 0.35);
    paths.push({ key: t.key, projectId: t.projectId, angle, from: [cx + ux * PLAZA.radius, cz + uz * PLAZA.radius], to: [cx + ux * stop, cz + uz * stop] });
  }
  paths.sort((a, b) => a.angle - b.angle);
  const entrances = [PLAZA.front];
  for (const p of paths) if (entrances.every((e) => Math.abs(angleGap(e, p.angle)) > PLAZA.gap * 2.2)) entrances.push(p.angle);
  entrances.sort((a, b) => norm(a) - norm(b));
  const beds: [number, number][] = [];
  for (let i = 0; i < entrances.length; i++) {
    const a = norm(entrances[i]);
    let b = norm(entrances[(i + 1) % entrances.length]);
    if (b <= a) b += 2 * Math.PI;
    // The front steps take a wider opening than a path.
    const ga = Math.abs(angleGap(a, PLAZA.front)) < 1e-6 ? PLAZA.gap * 2.4 : PLAZA.gap;
    const gb = Math.abs(angleGap(b, PLAZA.front)) < 1e-6 ? PLAZA.gap * 2.4 : PLAZA.gap;
    if (b - gb - (a + ga) > 0.15) beds.push([a + ga, b - gb]);
  }
  // A bench facing the sculpture in front of the middle of each bed.
  const benches = beds.map(([a, b]) => {
    const m = (a + b) / 2;
    const r = PLAZA.bedInner - 0.17;
    return { x: cx + r * Math.cos(m), z: cz + r * Math.sin(m), ry: Math.atan2(Math.cos(m), Math.sin(m)) };
  });
  // Lamps stand at each entrance, either side, on the disc's rim.
  const lamps: Pt[] = [];
  for (const e of entrances) {
    const w = Math.abs(angleGap(e, PLAZA.front)) < 1e-6 ? PLAZA.gap * 2.4 : PLAZA.gap;
    for (const side of [-1, 1]) {
      const a = e + side * (w + 0.05);
      lamps.push([cx + (PLAZA.radius - 0.08) * Math.cos(a), cz + (PLAZA.radius - 0.08) * Math.sin(a)]);
    }
  }
  // The sign stands on the lawn in front of the steps, facing the map's camera. A plane's front looks
  // along +z; this turn faces it out along the front angle.
  const sr = PLAZA.stepsOuter + 0.75;
  const sign = { x: cx + sr * Math.cos(PLAZA.front), z: cz + sr * Math.sin(PLAZA.front), ry: Math.PI / 2 - PLAZA.front, w: 1.25, h: 0.46 };
  const mk = (a: number): Pt => [cx + (PLAZA.stepsOuter + 0.18) * Math.cos(a), cz + (PLAZA.stepsOuter + 0.18) * Math.sin(a)];
  return { cx, cz, lot: { x: lot.x, z: lot.z, w: lot.w, d: lot.d }, entrances, beds, benches, lamps, sign, markers: { attention: mk(PLAZA.front - 0.42), done: mk(PLAZA.front + 0.42) }, paths };
}

/** Trees round the plaza and shrubs in its beds, drawn by Landscape with the city's other planting. */
export function plazaPlanting(p: PlazaPlan, y: number): { trees: Tree[]; bushes: Point[] } {
  const trees: Tree[] = [];
  const bushes: Point[] = [];
  const top = y + PLAZA.rise;
  // Olives on the lawn at the lot's back corners and sides, away from the paths, the sign and the steps.
  for (const [a, r] of [[PLAZA.front + Math.PI * 0.62, 2.9], [PLAZA.front - Math.PI * 0.62, 2.9], [PLAZA.front + Math.PI * 0.85, 3.05], [PLAZA.front - Math.PI * 0.85, 3.05], [PLAZA.front + Math.PI * 0.3, 3.0], [PLAZA.front - Math.PI * 0.3, 3.0]] as const) {
    if (p.paths.some((q) => Math.abs(angleGap(q.angle, a)) < 0.3)) continue;
    trees.push({ x: p.cx + r * Math.cos(a), y, z: p.cz + r * Math.sin(a), s: 0.3, kind: "round", la: "olive" });
  }
  for (const [a, b] of p.beds) {
    const mid = (PLAZA.bedInner + PLAZA.bedOuter) / 2;
    const n = Math.max(2, Math.round(((b - a) * mid) / 0.42));
    for (let i = 0; i < n; i++) {
      const t = a + ((i + 0.5) / n) * (b - a);
      const r = mid + (i % 2 ? 0.07 : -0.07);
      bushes.push({ x: p.cx + r * Math.cos(t), y: top + 0.05, z: p.cz + r * Math.sin(t), s: i % 3 === 0 ? 0.12 : 0.095 });
    }
  }
  return { trees, bushes };
}
