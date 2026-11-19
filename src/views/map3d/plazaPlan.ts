import type { Point, Rect, Scene3D, Tree } from "./scene";
import { ROAD_W, type Pt } from "./roads";
import { streetHitTest } from "./streetAlign";

/**
 * Atlas Automation Plaza: a round landscaped plaza on the open lawn in front of the Growth & Marketing
 * Studio, across the street from its forecourt (Khaneil, 2026-11-18). It takes the open spot nearest
 * the studio's front axis that clears every street, building, tool office and brook: no building,
 * road, district or the perimeter train moves.
 * Angles are measured in the map's x/z plane: x = cx + r cos(a), z = cz + r sin(a).
 */
export const PLAZA_KEY = "service:automation-plaza";
export const PLAZA_NAME = "Atlas Automation Plaza";
/** How far in front of the studio's forecourt the search for open lawn starts. */
const FRONT_GAP = 6;

export const PLAZA = {
  /** Paved disc. */
  radius: 2.0,
  /**
   * Curved steps run round the front, from the disc out to this radius. The lawn in front of the studio
   * is a 6.4-wide strip between two streets, so the plaza can't grow past this without covering one.
   */
  stepsOuter: 2.4,
  /** Planted beds ring the disc between these radii, broken by the entrances. */
  bedInner: 1.58,
  bedOuter: 1.95,
  /** The disc sits this high above the lawn; the steps climb to it. */
  rise: 0.1,
  /**
   * The glass lantern: taller than the Vendor & Supplier Hub next door (its roof and atrium dome top out
   * about 5 above the ground; Khaneil, 2026-11-18), so the sculpture reads over it from the map's camera.
   */
  enclosureRadius: 1.25,
  enclosureHeight: 5.55,
  /**
   * Concept B's top (Khaneil, 2026-11-19: "use B top part instead of A"): the glass ends in an open gold rim,
   * with a shallow gold saucer set just inside it and the mast running up to meet it. The saucer's low dome
   * rises this much above the rim; glass plus saucer keep the old 5.7 total, below the nearest tower.
   */
  crownRise: 0.15,
  /** Fine gold mullions round the glass. */
  mullions: 16,
  pedestalRadius: 0.6,
  /** The pedestal and gyroscope are drawn this much larger than their base model (kept in proportion). */
  sculptureScale: 1.65,
  /** Ring centre height above the disc: the gyroscope is gathered in the middle of the lantern. */
  ringHeight: 2.65,
  ringRadii: [0.99, 0.89, 0.79] as const,
  ringTube: 0.06,
  /** Gold paths are laid this wide, a hair above the ground they cross. */
  pathWidth: 0.07,
  /** Only buildings this close get a path, so the lines stay local to the plaza. */
  pathReach: 19,
  /**
   * The front steps and sign face east, along the street toward the Atlas Command Center: the Vendor &
   * Supplier Hub stands between the plaza and the default camera, so a front facing +x +z would face its wall.
   */
  front: -0.45 as number,
  /**
   * The sign's face turns toward the map's default camera, which looks along (-1, 0, -1) from the
   * south-east (Khaneil, 2026-11-18), so its words read square-on from the opening view.
   */
  signFacing: Math.PI / 4,
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
  /** The 5 x 5 square the plaza and its planting occupy, centred on it. */
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

interface Box { x: number; z: number; w: number; d: number }
const overlaps = (b: Box, x: number, z: number, r: number) => x + r > b.x && x - r < b.x + b.w && z + r > b.z && z - r < b.z + b.d;
const within = (b: Box, x: number, z: number) => x >= b.x && x <= b.x + b.w && z >= b.z && z <= b.z + b.d;

export interface PlazaSite {
  towers: Scene3D["towers"];
  kiosks?: Scene3D["kiosks"];
  /** The Growth & Marketing Studio: its centre, and every parcel of its grounds (forecourt, pools). */
  agency?: { cx: number; cz: number; land: Rect[] };
  /** Other landmarks' footprints the plaza must not touch (Vendor & Supplier Hub, Marketplace). */
  landmarks?: Rect[];
  /** City land, brooks, houses and streets the plaza has to keep to or clear. */
  land?: Rect[];
  brooks?: Rect[];
  houses?: { x: number; z: number; w: number; d: number }[];
  roads?: Pt[][];
  /** Footpaths beside the streets: the plaza's rim stays off them too. */
  walks?: Pt[][];
  cleared?: ReadonlySet<string>;
  /** Paved squares left where a tower moved off (Scene3D.clearedLots); the plaza takes one in front of the studio. */
  clearedLots?: { x: number; z: number; size: number }[];
}

/** Whether a point is open lawn for the plaza's planting: on land, off every street, brook and building. */
export function plazaGround(s: PlazaSite): (x: number, z: number, r: number) => boolean {
  const street = streetHitTest(s.roads ?? [], ROAD_W / 2 + 0.2);
  const blocks: Box[] = [
    // A cleared lot's tower is taken off the map later, so it blocks nothing.
    ...[...s.towers.filter((t) => !s.cleared?.has(t.projectId)), ...(s.kiosks ?? [])].map((t) => ({ x: t.x - t.size / 2, z: t.z - t.size / 2, w: t.size, d: t.size })),
    ...(s.brooks ?? []),
    ...(s.agency?.land ?? []),
    ...(s.landmarks ?? []),
    ...(s.houses ?? []).map((h) => ({ x: h.x - h.w / 2, z: h.z - h.d / 2, w: h.w, d: h.d })),
  ];
  return (x, z, r) => !street(x, z) && !blocks.some((b) => overlaps(b, x, z, r)) && (!s.land || s.land.some((l) => within(l, x, z)));
}

/** The plaza in front of the Growth & Marketing Studio, or undefined when the studio isn't on the map. */
export function planPlaza(s: PlazaSite): PlazaPlan | undefined {
  const studio = s.agency;
  if (!studio || !studio.land.length) return;
  // Start just past the studio's forecourt on its front axis, then take the nearest open spot.
  const front = Math.max(...studio.land.map((r) => r.z + r.d));
  // Aim for the paved square a moved tower left in front of the studio (Khaneil's screenshot, 2026-11-18),
  // else the studio's own front axis.
  const square = (s.clearedLots ?? [])
    .filter((c) => Math.abs(c.x - studio.cx) <= 6 && c.z > front && c.z <= front + FRONT_GAP + 6)
    .sort((a, b) => Math.hypot(a.x - studio.cx, a.z - front) - Math.hypot(b.x - studio.cx, b.z - front))[0];
  const tx = square?.x ?? studio.cx;
  const tz = square?.z ?? front + FRONT_GAP;
  const R = PLAZA.stepsOuter + 0.2;
  // Only the streets near the search area matter; a big city has thousands of segments.
  // When the studio's front has no room (another grouping can put it at the shore), the plaza takes the
  // nearest open lawn on any side of the studio within this distance of its centre.
  const SPAN = 16;
  const x0 = Math.min(tx - 6, studio.cx - SPAN) - R - 1;
  const z0 = Math.min(tz - 6, studio.cz - SPAN) - R - 1;
  const area = { x: x0, z: z0, w: Math.max(tx + 6, studio.cx + SPAN) + R + 1 - x0, d: Math.max(tz + 6, studio.cz + SPAN) + R + 1 - z0 };
  const inArea = (x: number, z: number, pad: number) => x > area.x - pad && x < area.x + area.w + pad && z > area.z - pad && z < area.z + area.d + pad;
  const nearby = (paths: Pt[][]) => {
    const out: Pt[][] = [];
    for (const r of paths)
      for (let k = 1; k < r.length; k++) {
        const [a, b] = [r[k - 1], r[k]];
        if (Math.max(a[0], b[0]) > area.x && Math.min(a[0], b[0]) < area.x + area.w && Math.max(a[1], b[1]) > area.z && Math.min(a[1], b[1]) < area.z + area.d) out.push([a, b]);
      }
    return out;
  };
  const segs = nearby(s.roads ?? []);
  const walkSegs = nearby(s.walks ?? []);
  // No street may cross the plaza disc, including a short driveway that starts inside it.
  const clearR = R + ROAD_W / 2 + 0.2;
  const near = (x: number, z: number, list: Pt[][], r: number) =>
    list.some(([a, b]) => {
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1)));
      return Math.hypot(a[0] + t * ex - x, a[1] + t * ez - z) < r;
    });
  const street = (x: number, z: number) => near(x, z, segs, clearR) || near(x, z, walkSegs, PLAZA.stepsOuter + 0.1);
  const ground = plazaGround({
    ...s,
    roads: [],
    towers: s.towers.filter((t) => inArea(t.x, t.z, t.size)),
    kiosks: s.kiosks?.filter((t) => inArea(t.x, t.z, t.size)),
    houses: s.houses?.filter((h) => inArea(h.x, h.z, h.w + h.d)),
  });
  const rim = Array.from({ length: 48 }, (_, i) => (i / 48) * Math.PI * 2);
  const fits = (x: number, z: number) =>
    ground(x, z, R) &&
    !street(x, z) &&
    rim.every((a) => !s.land || s.land.some((l) => within(l, x + R * Math.cos(a), z + R * Math.sin(a))));
  // Nearest open spot first: candidates in order of distance from the target, stopping at the first that fits.
  const candidates: [number, number, number][] = [];
  for (let dx = -6; dx <= 6; dx += 0.25) for (let dz = -6; dz <= 6; dz += 0.25) if (tz + dz - R > front) candidates.push([tx + dx, tz + dz, Math.hypot(dx, dz)]);
  candidates.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  let best = candidates.find(([x, z]) => fits(x, z));
  if (!best) {
    const around: [number, number, number][] = [];
    for (let dx = -SPAN; dx <= SPAN; dx += 0.5)
      for (let dz = -SPAN; dz <= SPAN; dz += 0.5) around.push([studio.cx + dx, studio.cz + dz, Math.hypot(studio.cx + dx - tx, studio.cz + dz - tz)]);
    around.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
    best = around.find(([x, z]) => fits(x, z));
  }
  if (!best) return;
  const cx = Math.round(best[0] * 100) / 100;
  const cz = Math.round(best[1] * 100) / 100;
  const lot = { x: cx - 2.5, z: cz - 2.5, w: 5, d: 5 };
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
  // No benches on the plaza (Khaneil, 2026-11-18).
  const benches: PlazaPlan["benches"] = [];
  // Lamps stand at each entrance, either side, on the disc's rim.
  const lamps: Pt[] = [];
  for (const e of entrances) {
    const w = Math.abs(angleGap(e, PLAZA.front)) < 1e-6 ? PLAZA.gap * 2.4 : PLAZA.gap;
    for (const side of [-1, 1]) {
      const a = e + side * (w + 0.05);
      lamps.push([cx + (PLAZA.radius - 0.08) * Math.cos(a), cz + (PLAZA.radius - 0.08) * Math.sin(a)]);
    }
  }
  // The sign stands on the lawn in front of the steps, its face turned to the map's default camera.
  // A plane's front looks along +z; this turn faces it out along signFacing.
  const sr = PLAZA.stepsOuter + 0.75;
  const sign = { x: cx + sr * Math.cos(PLAZA.front), z: cz + sr * Math.sin(PLAZA.front), ry: Math.PI / 2 - PLAZA.signFacing, w: 1.6, h: 0.59 };
  const mk = (a: number): Pt => [cx + (PLAZA.stepsOuter + 0.18) * Math.cos(a), cz + (PLAZA.stepsOuter + 0.18) * Math.sin(a)];
  return { cx, cz, lot: { x: lot.x, z: lot.z, w: lot.w, d: lot.d }, entrances, beds, benches, lamps, sign, markers: { attention: mk(PLAZA.front - 0.42), done: mk(PLAZA.front + 0.42) }, paths };
}

/** Trees round the plaza and shrubs in its beds, drawn by Landscape with the city's other planting. */
export function plazaPlanting(p: PlazaPlan, y: number, open: (x: number, z: number) => boolean = () => true): { trees: Tree[]; bushes: Point[] } {
  const trees: Tree[] = [];
  const bushes: Point[] = [];
  const top = y + PLAZA.rise;
  // Olives on the lawn at the lot's back corners and sides, away from the paths, the sign and the steps.
  const o = PLAZA.stepsOuter + 0.6;
  for (const [a, r] of [[PLAZA.front + Math.PI * 0.62, o], [PLAZA.front - Math.PI * 0.62, o], [PLAZA.front + Math.PI * 0.85, o + 0.15], [PLAZA.front - Math.PI * 0.85, o + 0.15], [PLAZA.front + Math.PI * 0.3, o + 0.1], [PLAZA.front - Math.PI * 0.3, o + 0.1]] as const) {
    if (p.paths.some((q) => Math.abs(angleGap(q.angle, a)) < 0.3)) continue;
    const x = p.cx + r * Math.cos(a);
    const z = p.cz + r * Math.sin(a);
    if (!open(x, z)) continue;
    trees.push({ x, y, z, s: 0.3, kind: "round", la: "olive" });
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
