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
  it("gives every project a tower and every agent a house", () => {
    const s = buildScene(layoutMap(catalog));
    expect(s.towers.map((t) => t.projectId).sort()).toEqual(catalog.projects.map((p) => p.id).sort());
    expect(s.houses.map((h) => h.agent.id).sort()).toEqual(catalog.agents.map((a) => a.id).sort());
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

  it("builds hundreds of repositories quickly", () => {
    const layout = layoutMap(bigCatalog(300), Array.from({ length: 60 }, (_, i) => `me/stray-${i}`));
    const t = performance.now();
    const s = buildScene(layout);
    expect(performance.now() - t).toBeLessThan(1500);
    expect(s.towers).toHaveLength(300);
    expect(s.strays).toHaveLength(60);
  });
});
