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

  it("gives office projects a tower and keeps Skyline in its residential district", () => {
    const s = buildScene(layoutMap(catalog));
    expect(s.towers.map((t) => t.projectId).sort()).toEqual(catalog.projects.filter(p => p.id !== "skyline").map((p) => p.id).sort());
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


describe("expanded Skyline layout", () => {
  it("keeps every branded building inside its district without overlapping another", () => {
    const scene=buildScene(layoutMap(catalog));
    const park=scene.parks.find(p=>p.label==="Skyline")!;
    expect(park).toBeDefined();
    const shops=scene.retail.filter(k=>k.projectId===park.id);
    expect(shops.map(k=>k.name)).toEqual(expect.arrayContaining(["Anthropic","OpenAI","Starbucks","Chipotle","Zara","Wells Fargo","Smashburger"]));
    for(const shop of shops) {
      expect(shop.x-shop.size/2).toBeGreaterThan(park.x);
      expect(shop.x+shop.size/2).toBeLessThan(park.x+park.w);
      expect(shop.z-shop.size/2).toBeGreaterThan(park.z);
      expect(shop.z+shop.size/2).toBeLessThan(park.z+park.d);
      const cx=park.x+park.w/2,cz=park.z+park.d/2;
      expect(Math.abs(shop.x-cx)>1.7+shop.size/2||Math.abs(shop.z-cz)>0.475+shop.size/2).toBe(true);
      for(const other of shops) if(other!==shop) {
        expect(Math.abs(shop.x-other.x)>(shop.size+other.size)/2+0.3 || Math.abs(shop.z-other.z)>(shop.size+other.size)/2+0.3).toBe(true);
      }
      expect(scene.walks.some(w=>w.shopEntrance&&Math.abs(w.x1-shop.x)<0.001&&Math.abs(w.z1-shop.z-0.12)<0.001)).toBe(true);
    }
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
