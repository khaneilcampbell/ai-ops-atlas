import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { layoutMap } from "../mapLayout";
import { buildScene, TERRACE_H } from "./scene";
import { PLAZA, PLAZA_LOT, planPlaza } from "./plazaPlan";
import { streetHitTest } from "./streetAlign";
import { ROAD_W } from "./roads";

const scene = buildScene(layoutMap(catalog, [], "district"));
const p = scene.plaza!;

describe("Atlas Automation Plaza", () => {
  it("sits on the Career Applications vacant lot, which stays where it was", () => {
    expect(p).toBeDefined();
    expect(scene.parks.find((l) => l.id === PLAZA_LOT)).toMatchObject({ x: 9.75, z: 22, w: 5, d: 5 });
    // Centred on the lot's lawn, slid east off the middle avenue that runs over the lot's west edge.
    expect(p.cz).toBe(24.5);
    expect(p.cx).toBeGreaterThan(12.25);
    expect(p.cx).toBeLessThan(14);
  });

  it("moves no building, and keeps clear of every building, road and brook", () => {
    // Every tower is where the plan without the plaza puts it (the plaza only reads the scene).
    const again = planPlaza({ parks: scene.parks, towers: scene.towers, roads: scene.transportConnections.map((c) => c.road) });
    expect(again?.cx).toBe(p.cx);
    const clear = (x: number, z: number, r: number) => {
      for (const t of [...scene.towers, ...scene.kiosks]) expect(Math.abs(t.x - x) > t.size / 2 + r || Math.abs(t.z - z) > t.size / 2 + r, `clear of ${t.key}`).toBe(true);
      for (const b of scene.brooks) expect(x + r < b.x || x - r > b.x + b.w || z + r < b.z || z - r > b.z + b.d, "clear of a brook").toBe(true);
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

  it("keeps the sculpture well below the surrounding towers", () => {
    const top = PLAZA.rise + PLAZA.enclosureHeight + 0.05;
    const near = scene.towers.filter((t) => Math.hypot(t.x - p.cx, t.z - p.cz) < 15);
    expect(near.length).toBeGreaterThan(2);
    for (const t of near) expect(top).toBeLessThan((t.height - TERRACE_H) * 0.35);
  });

  it("leads gold paths only to real nearby buildings, each through its own entrance", () => {
    expect(p.paths.map((q) => q.projectId).sort()).toEqual(["commerce-pipeline", "github-profile", "portfolio-site", "soc-lab"]);
    for (const q of p.paths) {
      expect(scene.towers.some((t) => t.key === q.key)).toBe(true);
      expect(Math.hypot(q.from[0] - p.cx, q.from[1] - p.cz)).toBeCloseTo(PLAZA.radius);
      expect(p.entrances.some((e) => Math.abs(e - q.angle) < 1e-9)).toBe(true);
    }
    // Beds never cover an entrance.
    for (const e of p.entrances) for (const [a, b] of p.beds) for (const k of [-1, 0, 1]) expect(e + k * Math.PI * 2 > a && e + k * Math.PI * 2 < b).toBe(false);
  });

  it("puts every bench, lamp and bed shrub on the plaza and its trees on open lawn", () => {
    for (const b of p.benches) expect(Math.hypot(b.x - p.cx, b.z - p.cz)).toBeLessThan(PLAZA.bedInner);
    for (const [x, z] of p.lamps) expect(Math.hypot(x - p.cx, z - p.cz)).toBeLessThan(PLAZA.radius);
    const trees = scene.trees.filter((t) => Math.hypot(t.x - p.cx, t.z - p.cz) < PLAZA.stepsOuter + 1.1);
    for (const t of trees) expect(Math.hypot(t.x - p.cx, t.z - p.cz)).toBeGreaterThan(PLAZA.stepsOuter);
  });
});
