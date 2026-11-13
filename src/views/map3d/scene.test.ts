import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import type { Catalog } from "../../catalog/types";
import { OFF_MAP_PROJECTS, layoutMap } from "../mapLayout";
import { buildScene } from "./scene";
import { VACANT_LOT_LABEL, openLot } from "./openLot";

function bigCatalog(n: number): Catalog {
  const projects = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Project ${i}`,
    summary: "",
    status: "active" as const,
    repository: `me/repo-${i}`,
    tags: [],
    links: [],
    agentIds: [],
  }));
  const agents = projects.flatMap((p, i) =>
    Array.from({ length: i % 9 }, (_, k) => ({ id: `${p.id}-a${k}`, name: `Agent ${k}`, purpose: "", framework: "CrewAI", status: "idle" as const, lastRun: null, history: [], links: [], projectId: p.id, repository: p.repository })),
  );
  return { projects, agents };
}

describe("buildScene", () => {
  it("connects pedestrian crossings to both project entrances without walking through buildings", () => {
    const scene = buildScene(layoutMap(catalog));
    const journeys = scene.walks.filter(w => w.bridge && w.route?.length);
    expect(journeys.length).toBeGreaterThan(0);
    for (const w of journeys) {
      const route = w.route!;
      expect(route.length).toBeGreaterThanOrEqual(4);
      for (let i=1; i<route.length; i++) {
        const a=route[i-1], b=route[i];
        expect(a.gx===b.gx || a.gy===b.gy).toBe(true);
        for (const tower of [...scene.towers, ...scene.kiosks]) {
          const crosses = Math.min(a.gx,b.gx)<tower.x+tower.size/2-0.01 && Math.max(a.gx,b.gx)>tower.x-tower.size/2+0.01 && Math.min(a.gy,b.gy)<tower.z+tower.size/2-0.01 && Math.max(a.gy,b.gy)>tower.z-tower.size/2+0.01;
          expect(crosses).toBe(false);
        }
      }
    }
  });

  it("gives office projects a tower and off-map projects none (Skyline, Service Desk, Career Applications, Benjaire Dashboard)", () => {
    const s = buildScene(layoutMap(catalog));
    expect(s.towers.map((t) => t.projectId).sort()).toEqual(catalog.projects.filter(p => !OFF_MAP_PROJECTS.has(p.id)).map((p) => p.id).sort());
    expect(s.houses).toEqual([]);
    expect(s.towers.reduce((n, t) => n + t.agents + t.automations, 0)).toBe(catalog.agents.filter((a) => !OFF_MAP_PROJECTS.has(a.projectId)).length);
    // Their land stays as plain lawn, apart from the open lot the Marketplace anchors on.
    expect(s.parks.filter((p) => p.label === VACANT_LOT_LABEL).map((p) => p.id).sort()).toEqual(["park:vacant:career-optimizer", "park:vacant:service-desk"]);
    expect(openLot(s.parks)?.id).toBe("park:all");
    expect(s.clearedLots?.map((t) => t.projectId)).toEqual(["benjaire-ops"]);
    expect(s.terraces.some((t) => t.id === "benjaire-ops")).toBe(false);
  });

  it("keeps kiosks clear of houses, towers and each other", () => {
    const s = buildScene(layoutMap(catalog));
    expect(s.kiosks.length).toBeGreaterThan(0);
    const boxes = [...s.houses.map((h) => ({ k: h.key, x: h.x, z: h.z, w: h.w, d: h.d })), ...s.towers.map((t) => ({ k: t.key, x: t.x, z: t.z, w: t.size, d: t.size })), ...s.kiosks.map((k) => ({ k: k.key, x: k.x, z: k.z, w: k.size, d: k.size }))];
    for (const k of s.kiosks)
      for (const b of boxes) if (b.k !== k.key) expect(Math.abs(k.x - b.x) < (k.size + b.w) / 2 && Math.abs(k.z - b.z) < (k.size + b.d) / 2, `${k.key} hits ${b.k}`).toBe(false);
  });

  it("produces finite geometry and is deterministic", () => {
    const a = buildScene(layoutMap(catalog));
    const nums = [...a.land, ...a.paving, ...a.steps, ...a.brooks].flatMap((r) => [r.x, r.z, r.w, r.d]);
    expect(nums.every(Number.isFinite)).toBe(true);
    expect(nums.length).toBeGreaterThan(0);
    expect(JSON.stringify(buildScene(layoutMap(catalog)))).toBe(JSON.stringify(a));
  });

  it("keeps trees off buildings and paths", () => {
    const s = buildScene(layoutMap(catalog));
    for (const t of s.trees) for (const h of s.houses) expect(Math.abs(t.x - h.x) < h.w / 2 && Math.abs(t.z - h.z) < h.d / 2).toBe(false);
  });

  it("lights every footpath bend and keeps strollers off the steps", () => {
    const s = buildScene(layoutMap(catalog));
    expect(s.bollards.length).toBeGreaterThan(s.houses.length / 2);
    for (const b of s.bollards) for (const h of s.houses) expect(Math.abs(b.x - h.x) < h.w / 2 && Math.abs(b.z - h.z) < h.d / 2).toBe(false);
    for (const w of s.walks) expect(Math.hypot(w.x1 - w.x0, w.z1 - w.z0)).toBeGreaterThan(0);
  });

  it("builds hundreds of repositories quickly", () => {
    const layout = layoutMap(bigCatalog(300), Array.from({ length: 60 }, (_, i) => `me/stray-${i}`));
    // Best of three: a single timing fails when the machine is busy (the whole suite running in
    // parallel, a preview build), which isn't the planners getting slower. About 0.5 s on a Mac.
    // Shared CI runners are about three times slower with the whole suite running (1.51 s best of
    // three was seen on GitHub Actions), so CI gets its own limit; both still catch a real regression.
    const limit = process.env.CI ? 4000 : 1500;
    let best = Infinity;
    let s!: ReturnType<typeof buildScene>;
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      s = buildScene(layout);
      best = Math.min(best, performance.now() - t);
    }
    expect(best).toBeLessThan(limit);
    expect(s.towers).toHaveLength(300);
    expect(s.strays).toHaveLength(60);
  }, 20_000);
});


describe("open lot", () => {
  // KC, 2026-11-08: Skyline was removed to make space. Its land stays as an empty lot in every
  // grouping, so the Marketplace, the airport road and the railway keep their places.
  it("keeps the old Skyline land as one empty lot, with nothing built on it", () => {
    for (const g of ["district", "none", "status", "tag"] as const) {
      const scene = buildScene(layoutMap(catalog, [], g));
      const lot = openLot(scene.parks)!;
      expect(lot, g).toMatchObject({ w: 12, d: 9 });
      expect(scene.terraces.some((t) => t.id === lot.id && t.park)).toBe(true);
      const on = (x: number, z: number) => x > lot.x && x < lot.x + lot.w && z > lot.z && z < lot.z + lot.d;
      for (const b of [...scene.towers, ...scene.kiosks, ...scene.strays]) expect(on(b.x, b.z), `${g} ${b.key}`).toBe(false);
      for (const h of scene.houses) expect(on(h.x, h.z), `${g} ${h.key}`).toBe(false);
      // Atlas Commons' designed planting (drawn by Landscape since Nov 13) may reach into the lot; the lot's own meadow trees stay cleared.
      const c = scene.commons?.rect, inCommons = (x: number, z: number) => !!c && x >= c.x && x <= c.x + c.w && z >= c.z && z <= c.z + c.d;
      expect(scene.trees.filter((t) => on(t.x, t.z) && !inCommons(t.x, t.z)), g).toEqual([]);
      expect(scene.fountains.filter((f) => on(f.x, f.z)), g).toEqual([]);
      expect(scene.ponds.filter((p) => on(p.x, p.z)), g).toEqual([]);
    }
  });
  it("still meets the airport road where the Skyline promenade did", () => {
    const scene = buildScene(layoutMap(catalog));
    const lot = openLot(scene.parks)!;
    expect(scene.airport).toMatchObject({ accessX: lot.x + 0.5, accessZ: lot.z + lot.d * 0.65, west: true });
  });
  it("keeps the entire marina entrance clear of trees across city layouts", () => {
    for(const input of [catalog,bigCatalog(4),bigCatalog(20)]) {
      const scene=buildScene(layoutMap(input));
      const shore=scene.terraces.reduce((a,b)=>b.z+b.d>a.z+a.d?b:a);
      const x=shore.x+shore.w/2,z=shore.z+shore.d;
      expect(scene.trees.some(t=>Math.abs(t.x-x)<0.9&&t.z>=z-1&&t.z<=z+3)).toBe(false);
    }
  });
});
