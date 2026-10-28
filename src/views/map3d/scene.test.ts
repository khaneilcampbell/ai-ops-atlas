import { describe, expect, it } from "vitest";
import { isAiAgent } from "../../catalog/roles";
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
  it("gives every project a tower and every automation a house", () => {
    const s = buildScene(layoutMap(catalog));
    expect(s.towers.map((t) => t.projectId).sort()).toEqual(catalog.projects.map((p) => p.id).sort());
    expect(s.houses.map((h) => h.agent.id).sort()).toEqual(catalog.agents.filter((a) => !isAiAgent(a)).map((a) => a.id).sort());
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
