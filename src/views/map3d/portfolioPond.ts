import type { Rect, Scene3D } from "./scene";
import { TERRACE_H } from "./scene";
import { uncoveredLand } from "./neighborhoodLinks";
import { distanceToRoad } from "./highway";
import type { Pt } from "./roads";

/**
 * Khaneil, 2026-11-24: Projects & Portfolio Studio stands on the pond north of Atlas Stadium, in
 * front of the AI Engineering & Research Center. Only the building moves: its district, streets and
 * agents keep their place, so nothing else in the city is re-planned. The pond is filled level with
 * the city, the studio gets a concrete plaza, and a concrete driveway joins the nearest street.
 */
export const PORTFOLIO_POND = {
  projectId: "portfolio-site",
  /** Plaza side as a share of the building's footprint: wide enough for the lobby steps and a forecourt, like a headquarters plaza. */
  plaza: 2.3,
  /** Grounds kept clear of trees round the plaza. */
  clear: 0.35,
} as const;

/**
 * The pond: the water between the cleared lot north of it, the next lot south of it (Atlas Stadium or the
 * Security Operations Center's old parcel, whichever stands there), the city's west canal and AI Engineering's block.
 */
export function portfolioPondArea(s: Pick<Scene3D, "terraces" | "stadium">): Rect | undefined {
  const north = s.terraces.find(t => t.id === "park:cleared:benjaire-ops"), east = s.terraces.find(t => t.id === "park:vacant:career-optimizer");
  const soc = s.terraces.find(t => t.id === "soc-lab");
  if (!north || !east || !soc) return;
  const x = soc.x + 0.85, z = north.z + north.d + 0.9, w = east.x - 0.25 - x;
  const lots = [...s.terraces, ...(s.stadium ? [s.stadium] : [])].filter(t => t.z > z + 2 && t.x < x + w && t.x + t.w > x);
  if (!lots.length) return;
  const south = Math.min(...lots.map(t => t.z));
  return { x, z, w, d: south - 1.2 - z };
}

export function movePortfolioOntoPond(scene: Scene3D): void {
  const tower = scene.towers.find(t => t.projectId === PORTFOLIO_POND.projectId), pond = portfolioPondArea(scene);
  if (!tower || !pond || pond.w < tower.size * PORTFOLIO_POND.plaza || pond.d < tower.size * PORTFOLIO_POND.plaza) return;
  const top = TERRACE_H, cz = pond.z + pond.d / 2;
  // Fill the pond level with the city, right up to the next lot south: no moat, ditch or bare basin wall is left.
  const fill: Rect = { ...pond, d: pond.d + 1.2 };
  scene.land.push(...uncoveredLand(fill, scene.land));
  // Boardwalks that crossed the pond become paved paths on the new ground.
  for (const w of scene.walks) if (w.bridge && inside(fill, (w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2)) {
    w.bridge = false;
    const x0 = Math.min(w.x0, w.x1), z0 = Math.min(w.z0, w.z1), along = Math.abs(w.x1 - w.x0) > Math.abs(w.z1 - w.z0);
    scene.paving.push(along ? { x: x0, z: z0 - 0.16, w: Math.abs(w.x1 - w.x0), d: 0.32, y: top, h: 0.03 } : { x: x0 - 0.16, z: z0, w: 0.32, d: Math.abs(w.z1 - w.z0), y: top, h: 0.03 });
  }
  // The forecourt is the same size as the studio's own plaza back in its district, paved in the same
  // tiles as outside the other buildings, with a light kerb (streetPavement.ts plainPlaza).
  const own = scene.paving.filter(q => q.w > tower.size && Math.abs(q.x + q.w / 2 - tower.x) < 1e-6 && Math.abs(q.z + q.d / 2 - tower.z) < 1e-6 && Math.abs(q.w - q.d) < 1e-6).sort((a, b) => a.w - b.w)[0];
  // The studio's old plaza back in its district stays a paved square, and its lane stays a street, so the
  // district's streets still join up round it (the same as a cleared headquarters lot).
  scene.clearedLots = [...(scene.clearedLots ?? []), { projectId: `street-reserve:${tower.projectId}`, x: tower.x, z: tower.z, size: tower.size }];
  const p = own?.w ?? tower.size * PORTFOLIO_POND.plaza, cx = clearOfBridges(pond, p, scene.carBridges);
  if (cx === undefined) return;
  tower.x = cx; tower.z = cz; tower.plainPlaza = true;
  const plaza: Rect = { x: cx - p / 2, z: cz - p / 2, w: p, d: p };
  scene.paving.push({ ...plaza, y: top, h: 0.03 });
  // One straight driveway from the forecourt's front edge (the entrance side) to the nearest street, meeting it
  // square on; no lane runs round the building. It is a real street, so sidewalks, cars and walking agents use it.
  const line = driveLine(plaza, scene.transportConnections.map(c => c.road));
  if (line) scene.transportConnections.push({ id: "portfolio-pond-drive", road: line, walk: line, private: true });
  const drive = line && { x: Math.min(line[0][0], line[1][0]) - 0.4, z: Math.min(line[0][1], line[1][1]) - 0.4, w: Math.abs(line[1][0] - line[0][0]) + 0.8, d: Math.abs(line[1][1] - line[0][1]) + 0.8 };
  const keep = (x: number, z: number) => !inside(plaza, x, z, PORTFOLIO_POND.clear) && !(drive && inside(drive, x, z, PORTFOLIO_POND.clear));
  scene.trees = scene.trees.filter(t => keep(t.x, t.z));
  scene.bushes = scene.bushes.filter(b => keep(b.x, b.z));
  // A few street trees in pits along the driveway's sidewalks, set back from the carriageway.
  if (line) {
    const [a, b] = line, along = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 1.1; d < len - 0.9; d += 1.3) for (const side of [-1, 1]) {
      const x = a[0] + (b[0] - a[0]) * d / len + (along ? 0 : side * 0.95), z = a[1] + (b[1] - a[1]) * d / len + (along ? side * 0.95 : 0);
      scene.trees.push({ x, z, y: top, s: 0.24, kind: "round" });
    }
  }
}

/**
 * The forecourt's centre across the pond: in the east-most stretch that a road bridge over the pond leaves
 * free, so the studio never stands on a street (the bridge stays as the street across the filled pond).
 */
export function clearOfBridges(pond: Rect, plaza: number, bridges: Scene3D["carBridges"]): number | undefined {
  const gap = 0.36 + 0.35;
  const cuts = bridges.filter(b => b.axis === "z" && b.a[0] > pond.x && b.a[0] < pond.x + pond.w && Math.min(b.a[1], b.b[1]) < pond.z + pond.d && Math.max(b.a[1], b.b[1]) > pond.z).map(b => b.a[0]).sort((a, b) => a - b);
  const edges = [pond.x, ...cuts.flatMap(x => [x - gap, x + gap]), pond.x + pond.w];
  // The east-most stretch that fits: the west edge of the pond has the Hills rail line beside it.
  let best: [number, number] | undefined;
  for (let i = 0; i < edges.length; i += 2) if (edges[i + 1] - edges[i] >= plaza) best = [edges[i], edges[i + 1]];
  if (!best) return;
  return cuts.length ? (best[0] === pond.x ? best[1] - plaza / 2 : best[0] + plaza / 2) : (best[0] + best[1]) / 2;
}

function inside(r: Rect, x: number, z: number, pad = 0) {
  return x >= r.x - pad && x <= r.x + r.w + pad && z >= r.z - pad && z <= r.z + r.d + pad;
}

/** The shortest straight drive (north, south, east or west) from the middle of a forecourt side to a street's centre line. */
export function driveLine(ring: Rect, roads: Pt[][], max = 6): [Pt, Pt] | undefined {
  const cx = ring.x + ring.w / 2, cz = ring.z + ring.d / 2;
  const dirs: [number, number, Pt][] = [[0, 1, [cx, ring.z + ring.d]], [0, -1, [cx, ring.z]], [-1, 0, [ring.x, cz]], [1, 0, [ring.x + ring.w, cz]]];
  let best: { len: number; l: [Pt, Pt] } | undefined;
  for (const [dx, dz, start] of dirs)
    for (let len = 0.1; len <= max; len += 0.01) {
      const end: Pt = [start[0] + dx * len, start[1] + dz * len];
      if (!roads.some(r => r.length > 1 && distanceToRoad(end, r) < 0.01)) continue;
      if (!best || len < best.len) best = { len, l: [start, end] };
      break;
    }
  return best?.l;
}
