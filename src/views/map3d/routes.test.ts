import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { layoutMap } from "../mapLayout";
import { makeRouter } from "./routes";
import { buildScene, TERRACE_H } from "./scene";

describe("makeRouter", () => {
  const scene = buildScene(layoutMap(catalog));
  const { route } = makeRouter(scene);
  const tower = (id: string) => scene.towers.find((t) => t.projectId === id)!;

  it("routes between every headquarters and the Atlas landmark over land, climbing only by steps", () => {
    const t0 = performance.now();
    const atlas = tower("ai-ops-atlas");
    for (const t of scene.towers) {
      if (t === atlas) continue;
      const r = route(t, atlas);
      expect(r, t.projectId).not.toBeNull();
      for (let i = 1; i < r!.length; i++) expect(Math.abs(r![i].y - r![i - 1].y)).toBeLessThan(0.25);
    }
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it("keeps routes off buildings", () => {
    const soc = tower("soc-lab");
    const houses = scene.houses.filter((h) => h.projectId === "soc-lab");
    const r = route(houses[0], houses[1])!;
    expect(r.length).toBeGreaterThan(2);
    for (const p of r) {
      expect(Math.abs(p.x - soc.x) < soc.size / 2 && Math.abs(p.z - soc.z) < soc.size / 2).toBe(false);
      expect(p.y).toBeCloseTo(TERRACE_H);
    }
  });
});
