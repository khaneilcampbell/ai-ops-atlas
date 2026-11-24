import type { Rect, Scene3D } from "./scene";
import { TERRACE_H } from "./scene";
import { uncoveredLand } from "./neighborhoodLinks";
import { distanceToRoad } from "./highway";
import { towerRing, type Pt } from "./roads";

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

/** The pond: the water between the cleared lot north of it, Atlas Stadium south of it, the city's west canal and AI Engineering's block. */
export function portfolioPondArea(s: Pick<Scene3D, "terraces" | "stadium">): Rect | undefined {
  const north = s.terraces.find(t => t.id === "park:cleared:benjaire-ops"), east = s.terraces.find(t => t.id === "park:vacant:career-optimizer");
  const soc = s.terraces.find(t => t.id === "soc-lab");
  if (!north || !east || !soc || !s.stadium) return;
  const x = soc.x + 0.85, z = north.z + north.d + 0.9;
  return { x, z, w: east.x - 0.25 - x, d: s.stadium.z - 1.2 - z };
}

export function movePortfolioOntoPond(scene: Scene3D): void {
  const tower = scene.towers.find(t => t.projectId === PORTFOLIO_POND.projectId), pond = portfolioPondArea(scene);
  if (!tower || !pond || pond.w < tower.size * PORTFOLIO_POND.plaza || pond.d < tower.size * PORTFOLIO_POND.plaza) return;
  const top = TERRACE_H, cx = pond.x + pond.w / 2, cz = pond.z + pond.d / 2;
  // Fill the pond level with the city, right up to the stadium's parcel: no moat, ditch or bare basin wall is left.
  const fill: Rect = { ...pond, d: (scene.stadium?.z ?? pond.z + pond.d) - pond.z };
  scene.land.push(...uncoveredLand(fill, scene.land));
  // Boardwalks that crossed the pond become paved paths on the new ground.
  for (const w of scene.walks) if (w.bridge && inside(fill, (w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2)) {
    w.bridge = false;
    const x0 = Math.min(w.x0, w.x1), z0 = Math.min(w.z0, w.z1), along = Math.abs(w.x1 - w.x0) > Math.abs(w.z1 - w.z0);
    scene.paving.push(along ? { x: x0, z: z0 - 0.16, w: Math.abs(w.x1 - w.x0), d: 0.32, y: top, h: 0.03 } : { x: x0 - 0.16, z: z0, w: 0.32, d: Math.abs(w.z1 - w.z0), y: top, h: 0.03 });
  }
  tower.x = cx; tower.z = cz;
  const p = tower.size * PORTFOLIO_POND.plaza, plaza: Rect = { x: cx - p / 2, z: cz - p / 2, w: p, d: p };
  scene.paving.push({ ...plaza, y: top, h: 0.03 });
  // One straight driveway from the plaza lane to the nearest street, meeting it square on. It is a real
  // street, so the plaza lane, sidewalks, cars and walking agents all use it like any other link road.
  const ring = towerRing(tower, p), line = ring && driveLine({ x: ring.x0, z: ring.z0, w: ring.x1 - ring.x0, d: ring.z1 - ring.z0 }, scene.transportConnections.map(c => c.road));
  if (line) scene.transportConnections.push({ id: "portfolio-pond-drive", road: line, walk: [] });
  // The plaza lane round the forecourt, as every headquarters has: the driveway meets it, so cars can go round and pull up.
  if (ring && line) scene.transportConnections.push({ id: "portfolio-pond-lane", road: [[ring.x0, ring.z0], [ring.x1, ring.z0], [ring.x1, ring.z1], [ring.x0, ring.z1], [ring.x0, ring.z0]], walk: [] });
  const drive = line && { x: Math.min(line[0][0], line[1][0]) - 0.4, z: Math.min(line[0][1], line[1][1]) - 0.4, w: Math.abs(line[1][0] - line[0][0]) + 0.8, d: Math.abs(line[1][1] - line[0][1]) + 0.8 };
  const lane = ring && { x: ring.x0, z: ring.z0, w: ring.x1 - ring.x0, d: ring.z1 - ring.z0 };
  const keep = (x: number, z: number) => !inside(lane ?? plaza, x, z, PORTFOLIO_POND.clear + 0.3) && !(drive && inside(drive, x, z, PORTFOLIO_POND.clear));
  scene.trees = scene.trees.filter(t => keep(t.x, t.z));
  scene.bushes = scene.bushes.filter(b => keep(b.x, b.z));
}

function inside(r: Rect, x: number, z: number, pad = 0) {
  return x >= r.x - pad && x <= r.x + r.w + pad && z >= r.z - pad && z <= r.z + r.d + pad;
}

/** The shortest straight drive (north, south, east or west) from the middle of a plaza-lane side to a street's centre line. */
export function driveLine(ring: Rect, roads: Pt[][], max = 6): [Pt, Pt] | undefined {
  const cx = ring.x + ring.w / 2, cz = ring.z + ring.d / 2;
  const dirs: [number, number, Pt][] = [[0, -1, [cx, ring.z]], [0, 1, [cx, ring.z + ring.d]], [-1, 0, [ring.x, cz]], [1, 0, [ring.x + ring.w, cz]]];
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
