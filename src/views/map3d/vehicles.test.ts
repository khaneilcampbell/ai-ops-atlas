import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { layoutMap } from "../mapLayout";
import { buildScene, FOUNTAIN_R, TERRACE_H } from "./scene";
import { DECK_W, RISE } from "./roads";
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

  // Each deck, less a wheel's width at the railings.
  const W = DECK_W - 0.12;
  const decks = scene.carBridges.map((br) => {
    const [x0, x1] = [Math.min(br.a[0], br.b[0]), Math.max(br.a[0], br.b[0])];
    const [z0, z1] = [Math.min(br.a[1], br.b[1]), Math.max(br.a[1], br.b[1])];
    return br.axis === "x" ? { x: x0, z: z0 - W / 2, w: x1 - x0, d: W } : { x: x0 - W / 2, z: z0, w: W, d: z1 - z0 };
  });

  it("stays on the paved paths and bridges, clear of every building and kiosk", () => {
    const paths = scene.paving.filter((p) => p.y === TERRACE_H);
    for (const v of plans)
      // Every 0.08s is under 0.03 of travel, finer than any wall's clearance.
      for (let t = 0; t < v.period; t += 0.08) {
        const { x, y, z } = vehicleAt(v, t);
        const onDeck = decks.some((d) => inside(d, x, z, 0.01));
        expect(onDeck || paths.some((p) => inside(p, x, z, 0.01)), `${v.id} off the path at ${x},${z}`).toBe(true);
        // Off a bridge, vehicles keep to the paving; on one, to the deck's rise.
        if (!onDeck) expect(y, `${v.id} in the air at ${x},${z}`).toBeLessThan(1e-6);
        expect(y).toBeLessThanOrEqual(RISE + 1e-6);
        for (const h of scene.houses) expect(inside({ x: h.x - h.w / 2, z: h.z - h.d / 2, w: h.w, d: h.d }, x, z, 0.08), `${v.id} inside ${h.key} at ${x},${z}`).toBe(false);
        // Towers, with their entrance stairs out front.
        for (const w of scene.towers) expect(inside({ x: w.x - w.size / 2, z: w.z - w.size / 2, w: w.size, d: w.size + 0.24 }, x, z, 0.08), `${v.id} inside a tower`).toBe(false);
        for (const k of scene.kiosks) expect(inside({ x: k.x - k.size / 2, z: k.z - k.size / 2, w: k.size, d: k.size }, x, z, 0.08), `${v.id} inside ${k.key}`).toBe(false);
        for (const f of scene.fountains) expect(Math.hypot(x - f.x, z - f.z), `${v.id} in a fountain`).toBeGreaterThan(FOUNTAIN_R * (f.k ?? 1) + 0.08);
      }
  });

  it("keeps fountains clear of the towers", () => {
    for (const f of scene.fountains)
      for (const w of scene.towers) {
        const dx = Math.max(0, Math.abs(f.x - w.x) - w.size / 2);
        const dz = Math.max(0, Math.abs(f.z - w.z) - w.size / 2);
        expect(Math.hypot(dx, dz)).toBeGreaterThan(FOUNTAIN_R * (f.k ?? 1));
      }
  });

  it("builds a road bridge for every pair of neighboring districts", () => {
    const layout = layoutMap(catalog);
    const ids = new Set(layout.districts.map((d) => d.project.id));
    const pairs = layout.walks.filter((w) => ids.has(w.from) && ids.has(w.to));
    expect(scene.carBridges.map((b) => b.ends.join(">")).sort()).toEqual(pairs.map((w) => `${w.from}>${w.to}`).sort());
    // Each bridge's roads start on its districts' plaza lanes and reach the deck's two ends.
    for (const br of scene.carBridges) {
      expect(br.roads[0][br.roads[0].length - 1]).toEqual(br.a);
      expect(br.roads[1][br.roads[1].length - 1]).toEqual(br.b);
    }
  });

  it("crosses the bridges both ways, keeping right", () => {
    const crossings = new Map<string, Set<number>>();
    for (const v of plans)
      for (let t = 0; t < v.period; t += 0.05) {
        const p = vehicleAt(v, t);
        scene.carBridges.forEach((br, i) => {
          const d = decks[i];
          if (!inside(d, p.x, p.z, 0)) return;
          // Heading along the axis, the lane on the right: +z when going +x, -x when going +z.
          const forward = br.axis === "x" ? Math.sign(p.dx) : Math.sign(p.dz);
          const across = br.axis === "x" ? p.z - br.a[1] : br.a[0] - p.x;
          expect(Math.sign(across), `${v.id} on the wrong side of ${br.key}`).toBe(forward);
          crossings.set(br.key, (crossings.get(br.key) ?? new Set()).add(forward));
        });
      }
    expect(crossings.size).toBeGreaterThan(3);
    for (const dirs of crossings.values()) expect(dirs.size).toBe(2);
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
