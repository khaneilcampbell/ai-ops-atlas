import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { layoutMap } from "../mapLayout";
import { buildScene, TERRACE_H } from "./scene";
import { PLAZA, angleGap, planPlaza } from "./plazaPlan";
import { streetHitTest } from "./streetAlign";
import { ROAD_W } from "./roads";
import { distanceToRoad } from "./highway";

const scene = buildScene(layoutMap(catalog, [], "district"));
const p = scene.plaza!;

describe("Atlas Automation Plaza", () => {
  it("sits on the open lawn in front of the Growth & Marketing Studio, across the street from its forecourt", () => {
    expect(p).toBeDefined();
    const studio = scene.agency!;
    const forecourt = Math.max(...studio.land.map((r) => r.z + r.d));
    // Beside the paved square the Atlas Command Center left when it moved, across the street from the
    // studio's forecourt, on the lawn strip between the two streets there.
    const square = scene.clearedLots!.find((c) => c.projectId === "street-reserve:ai-ops-atlas")!;
    expect(Math.hypot(p.cx - square.x, p.cz - square.z)).toBeLessThan(2);
    // No street, bridge approach or footpath runs under the plaza (a bridge road reaches into that square).
    const streets = [...scene.transportConnections.map((c) => c.road), ...scene.carBridges.flatMap((b) => b.roads)];
    for (const r of streets) expect(distanceToRoad([p.cx, p.cz], r)).toBeGreaterThan(PLAZA.stepsOuter + ROAD_W / 2);
    for (const w of scene.transportConnections.map((c) => c.walk)) expect(distanceToRoad([p.cx, p.cz], w)).toBeGreaterThan(PLAZA.stepsOuter);
    expect(Math.abs(p.cx - studio.cx)).toBeLessThan(6);
    expect(p.cz - PLAZA.stepsOuter).toBeGreaterThan(forecourt);
    expect(scene.parks.find((l) => l.id === "park:vacant:career-optimizer")).toMatchObject({ x: 9.75, z: 22, w: 5, d: 5 });
  });

  it("moves no building, and keeps clear of every building, road and brook", () => {
    // Every tower is where the plan without the plaza puts it (the plaza only reads the scene).
    // The plaza only reads the scene: planning it again from the finished scene finds open lawn too.
    expect(planPlaza({ towers: scene.towers, kiosks: scene.kiosks, agency: scene.agency, land: scene.land, brooks: scene.brooks, houses: scene.houses, roads: scene.transportConnections.map((c) => c.road) })).toBeDefined();
    const clear = (x: number, z: number, r: number) => {
      for (const t of [...scene.towers, ...scene.kiosks]) expect(Math.abs(t.x - x) > t.size / 2 + r || Math.abs(t.z - z) > t.size / 2 + r, `clear of ${t.key}`).toBe(true);
      for (const b of [...scene.brooks, ...scene.agency!.land]) expect(x + r < b.x || x - r > b.x + b.w || z + r < b.z || z - r > b.z + b.d, "clear of a brook").toBe(true);
    };
    clear(p.cx, p.cz, PLAZA.stepsOuter);
    clear(p.sign.x, p.sign.z, p.sign.w / 2);
    const street = streetHitTest(scene.transportConnections.map((c) => c.road), ROAD_W / 2);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      expect(street(p.cx + PLAZA.stepsOuter * Math.cos(a), p.cz + PLAZA.stepsOuter * Math.sin(a))).toBe(false);
    }
    expect(street(p.sign.x, p.sign.z)).toBe(false);
  });

  it("stands taller than the Vendor & Supplier Hub next door, and below the nearby towers", () => {
    const top = TERRACE_H + PLAZA.rise + PLAZA.enclosureHeight + PLAZA.crownRise;
    const g = scene.galleria!;
    expect(top).toBeGreaterThan(g.y0 + Math.max(g.roof, g.column.top));
    for (const t of scene.towers.filter((t) => Math.hypot(t.x - p.cx, t.z - p.cz) < PLAZA.pathReach)) expect(top).toBeLessThan(t.height);
    // Clear of the Hub's and the Marketplace's footprints.
    for (const r of [g.footprint, scene.mall!]) expect(p.cx + PLAZA.stepsOuter < r.x || p.cx - PLAZA.stepsOuter > r.x + r.w || p.cz + PLAZA.stepsOuter < r.z || p.cz - PLAZA.stepsOuter > r.z + r.d).toBe(true);
  });

  it("leads gold paths only to real nearby buildings, each through its own entrance", () => {
    expect(p.paths.map((q) => q.projectId).sort()).toEqual(["benjaire-site", "commerce-pipeline", "github-profile", "portfolio-site"]);
    for (const q of p.paths) {
      expect(scene.towers.some((t) => t.key === q.key)).toBe(true);
      expect(Math.hypot(q.from[0] - p.cx, q.from[1] - p.cz)).toBeCloseTo(PLAZA.radius);
      // Through its own entrance, or the front steps when it leaves right beside them.
      expect(p.entrances.some((e) => Math.abs(angleGap(e, q.angle)) <= PLAZA.gap * 2.2)).toBe(true);
      // Never under the sign.
      const t = ((p.sign.x - q.from[0]) * (q.to[0] - q.from[0]) + (p.sign.z - q.from[1]) * (q.to[1] - q.from[1])) / Math.hypot(q.to[0] - q.from[0], q.to[1] - q.from[1]) ** 2;
      const px = q.from[0] + (q.to[0] - q.from[0]) * Math.max(0, Math.min(1, t));
      const pz = q.from[1] + (q.to[1] - q.from[1]) * Math.max(0, Math.min(1, t));
      expect(Math.hypot(px - p.sign.x, pz - p.sign.z)).toBeGreaterThan(p.sign.w / 2 + 0.1);
    }
    // Beds never cover an entrance.
    for (const e of p.entrances) for (const [a, b] of p.beds) for (const k of [-1, 0, 1]) expect(e + k * Math.PI * 2 > a && e + k * Math.PI * 2 < b).toBe(false);
  });

  it("has no benches, puts every lamp and bed shrub on the plaza and its trees on open lawn", () => {
    expect(p.benches).toEqual([]);
    for (const [x, z] of p.lamps) expect(Math.hypot(x - p.cx, z - p.cz)).toBeLessThan(PLAZA.radius);
    const trees = scene.trees.filter((t) => Math.hypot(t.x - p.cx, t.z - p.cz) < PLAZA.stepsOuter + 1.1);
    for (const t of trees) expect(Math.hypot(t.x - p.cx, t.z - p.cz)).toBeGreaterThan(PLAZA.stepsOuter);
  });
  it("turns the sign's face to the map's default camera (south-east, looking along -x -z)", () => {
    // A plane faces +z before the turn; after ry its normal is (sin ry, cos ry).
    const n = [Math.sin(p.sign.ry), Math.cos(p.sign.ry)];
    expect(n[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(n[1]).toBeCloseTo(Math.SQRT1_2, 5);
  });
  it("runs no footpath under the plaza and leaves no boardwalk over dry lawn beside it", () => {
    for (const w of scene.walks) {
      expect(distanceToRoad([p.cx, p.cz], [[w.x0, w.z0], [w.x1, w.z1]]), "path under the plaza").toBeGreaterThan(PLAZA.stepsOuter - 0.01);
      const mx = (w.x0 + w.x1) / 2, mz = (w.z0 + w.z1) / 2;
      if (w.bridge && Math.hypot(mx - p.cx, mz - p.cz) < PLAZA.stepsOuter + 5)
        expect(scene.brooks.some((b) => mx > b.x - 0.3 && mx < b.x + b.w + 0.3 && mz > b.z - 0.3 && mz < b.z + b.d + 0.3), "boardwalk over water").toBe(true);
    }
  });
  it("grows no palm or tree on the plaza's disc and steps", async () => {
    const { avenuePlanting } = await import("./models");
    for (const t of avenuePlanting(scene)) expect(Math.hypot(t.x - p.cx, t.z - p.cz)).toBeGreaterThan(PLAZA.stepsOuter + 0.4);
  });
});
