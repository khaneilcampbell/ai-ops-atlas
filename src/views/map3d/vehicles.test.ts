import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { layoutMap } from "../mapLayout";
import { buildScene, TERRACE_H } from "./scene";
import { MAX_VEHICLES, planVehicles, vehicleAt } from "./vehicles";

const scene = buildScene(layoutMap(catalog));
const plans = planVehicles(scene);
const inside = (r: { x: number; z: number; w: number; d: number }, x: number, z: number, m = 0) => x >= r.x - m && x <= r.x + r.w + m && z >= r.z - m && z <= r.z + r.d + m;

describe("decorative vehicles", () => {
  it("runs a small fleet, one per district", () => {
    expect(plans.length).toBeGreaterThanOrEqual(3);
    expect(plans.length).toBeLessThanOrEqual(MAX_VEHICLES);
    expect(new Set(plans.map((p) => p.id)).size).toBe(plans.length);
  });

  it("stays on the paved paths and clear of every building", () => {
    const paths = scene.paving.filter((p) => p.y === TERRACE_H);
    for (const v of plans)
      for (let t = 0; t < v.period; t += 0.05) {
        const { x, z } = vehicleAt(v, t);
        expect(paths.some((p) => inside(p, x, z, 0.01)), `${v.id} off the path at ${x},${z}`).toBe(true);
        for (const h of scene.houses) expect(inside({ x: h.x - h.w / 2, z: h.z - h.d / 2, w: h.w, d: h.d }, x, z, 0.08), `${v.id} inside ${h.key} at ${x},${z}`).toBe(false);
        // Towers, with their entrance stairs out front.
        for (const w of scene.towers) expect(inside({ x: w.x - w.size / 2, z: w.z - w.size / 2, w: w.size, d: w.size + 0.24 }, x, z, 0.08), `${v.id} inside a tower`).toBe(false);
        for (const f of scene.fountains) expect(Math.hypot(x - f.x, z - f.z), `${v.id} in a fountain`).toBeGreaterThan(0.5);
      }
  });

  it("loops without jumping", () => {
    for (const v of plans) {
      let last = vehicleAt(v, 0);
      for (let t = 0.02; t <= v.period + 0.02; t += 0.02) {
        const p = vehicleAt(v, t);
        expect(Math.hypot(p.x - last.x, p.z - last.z)).toBeLessThan(0.05);
        last = p;
      }
    }
  });
});
