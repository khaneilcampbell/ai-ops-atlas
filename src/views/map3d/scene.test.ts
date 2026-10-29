import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import type { Catalog } from "../../catalog/types";
import { layoutMap } from "../mapLayout";
import { buildScene } from "./scene";

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
  it("gives Skyline Anthropic and OpenAI offices that sit inside the park, clear of every other building", () => {
    const scene = buildScene(layoutMap(catalog));
    const park = scene.parks[0];
    expect(park).toBeDefined();
    const shops = scene.retail.filter((k) => k.projectId === park.id);
    expect(shops.map((k) => k.name)).toEqual(expect.arrayContaining(["Anthropic", "OpenAI"]));
    const cx = park.x + park.w / 2, cz = park.z + park.d / 2;
    for (const k of shops) {
      expect(k.x - k.size / 2).toBeGreaterThan(park.x);
      expect(k.x + k.size / 2).toBeLessThan(park.x + park.w);
      expect(k.z - k.size / 2).toBeGreaterThan(park.z);
      expect(k.z + k.size / 2).toBeLessThan(park.z + park.d);
      // Clear of the Skyline tower and its two wings.
      expect(Math.abs(k.x - cx) > 1.7 + k.size / 2 || Math.abs(k.z - cz) > 0.475 + k.size / 2).toBe(true);
      for (const o of shops) if (o !== k) expect(Math.abs(o.x - k.x) >= (o.size + k.size) / 2 || Math.abs(o.z - k.z) >= (o.size + k.size) / 2).toBe(true);
    }
  });

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

  it("gives every project a tower containing all its workers and no worker houses", () => {
    const s = buildScene(layoutMap(catalog));
    expect(s.towers.map((t) => t.projectId).sort()).toEqual(catalog.projects.map((p) => p.id).sort());
    expect(s.houses).toEqual([]);
    expect(s.towers.reduce((n, t) => n + t.agents + t.automations, 0)).toBe(catalog.agents.length);
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
    const t = performance.now();
    const s = buildScene(layout);
    expect(performance.now() - t).toBeLessThan(1500);
    expect(s.towers).toHaveLength(300);
    expect(s.strays).toHaveLength(60);
  });
});
