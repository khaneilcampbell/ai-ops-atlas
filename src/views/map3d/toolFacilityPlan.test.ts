import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { OFF_MAP_PROJECTS } from "../../catalog/projects";
import { FACILITY_SCALE, toolFacilities } from "../../catalog/toolFacilities";
import { layoutMap } from "../mapLayout";
import { buildScene } from "./scene";
import { clearPlanting, facilityGround } from "./ToolFacilities";
import { blockedBy, facilityObstacles, MIN_SHRINK, parentHeight, planToolFacilities, plazaHalf } from "./toolFacilityPlan";

const layout = layoutMap(catalog, [], "district");
const scene = buildScene(layout);
const before = JSON.stringify(scene);
const facilities = toolFacilities(catalog.projects, catalog.agents, OFF_MAP_PROJECTS);
const plan = planToolFacilities(scene, facilities);

describe("Tool facilities: placement", () => {
  it("places or explains every satellite, and leaves tool offices where the layout put them", () => {
    const satellites = facilities.filter((f) => f.source === "satellite");
    expect(plan.placed.length + plan.unplaced.length).toBe(satellites.length);
    expect(plan.placed.length).toBeGreaterThan(0);
    for (const u of plan.unplaced) expect(u.reason.length).toBeGreaterThan(20);
    expect(plan.placed.every((p) => p.facility.source === "satellite")).toBe(true);
  });

  it("never moves or changes anything already on the map", () => {
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("is deterministic: the same city always gives the same spots", () => {
    const again = planToolFacilities(buildScene(layoutMap(catalog, [], "district")), facilities);
    expect(again.placed.map((p) => [p.facility.id, p.x, p.z, p.size])).toEqual(plan.placed.map((p) => [p.facility.id, p.x, p.z, p.size]));
  });

  it("keeps each facility at half its parent's size or smaller, and visibly smaller than it", () => {
    for (const p of plan.placed) {
      const parent = scene.towers.find((t) => t.projectId === p.facility.projectId)!;
      expect(p.size).toBeLessThanOrEqual(parent.size * FACILITY_SCALE + 1e-9);
      expect(p.size).toBeGreaterThanOrEqual(parent.size * FACILITY_SCALE * MIN_SHRINK - 1e-9);
      expect(p.height).toBeLessThanOrEqual(parentHeight(parent) * FACILITY_SCALE + 1e-9);
      expect(p.height / p.size).toBeCloseTo(parentHeight(parent) / parent.size, 6);
    }
  });

  it("stays on its own district's terrace, off the parent's plaza and entrance", () => {
    for (const p of plan.placed) {
      const half = p.size / 2;
      const ground = scene.terraces.filter((t) => t.id === p.facility.projectId);
      expect(ground.some((g) => p.x - half >= g.x && p.x + half <= g.x + g.w && p.z - half >= g.z && p.z + half <= g.z + g.d), p.facility.id).toBe(true);
      const parent = scene.towers.find((t) => t.projectId === p.facility.projectId)!;
      const gap = Math.max(Math.abs(p.x - parent.x), Math.abs(p.z - parent.z)) - half;
      expect(gap, p.facility.id).toBeGreaterThan(plazaHalf(parent));
    }
  });

  it("overlaps no building, plaza, paving, street, footpath, railway or other facility", () => {
    const o = facilityObstacles(scene);
    for (const p of plan.placed) expect(blockedBy(o, p.x, p.z, p.size), p.facility.id).toBeNull();
    for (const a of plan.placed)
      for (const b of plan.placed) if (a !== b) expect(Math.abs(a.x - b.x) >= (a.size + b.size) / 2 || Math.abs(a.z - b.z) >= (a.size + b.size) / 2).toBe(true);
  });

  it("clears planting only from under the facilities", () => {
    const cleared = clearPlanting(scene, facilityGround(plan.placed));
    const removed = scene.trees.filter((t) => !cleared.trees.includes(t));
    for (const t of removed) expect(plan.placed.some((p) => Math.abs(t.x - p.x) <= p.size / 2 + 0.15 && Math.abs(t.z - p.z) <= p.size / 2 + 0.15)).toBe(true);
    expect(clearPlanting(scene, [])).toBe(scene);
  });

  it("runs quickly enough to compute once per layout", () => {
    const t0 = performance.now();
    planToolFacilities(scene, facilities);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
