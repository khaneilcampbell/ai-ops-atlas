import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import type { Catalog } from "../catalog/types";
import { GAP, layoutMap, placeLabels, type Layout } from "./mapLayout";

function rects(layout: Layout) {
  return [...layout.districts.map((d) => ({ id: d.project.id, x: d.ox, y: d.oy, w: d.size, h: d.size })), ...layout.parks.map((p, i) => ({ id: `park${i}`, x: p.ox, y: p.oy, w: p.w, h: p.h }))];
}

function overlaps(layout: Layout, gap = 0) {
  const rs = rects(layout);
  const out: string[] = [];
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap) out.push(`${a.id}/${b.id}`);
    }
  return out;
}

/** A large synthetic catalog, only for exercising the layout. Never shown in the app. */
function bigCatalog(n: number): Catalog {
  const projects = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Project ${i}`,
    summary: "",
    status: (["active", "idle", "paused", "attention", "retired"] as const)[i % 5],
    repository: `me/repo-${i}`,
    tags: i % 3 ? [`t${i % 4}`] : [],
    links: [],
    agentIds: [],
  }));
  const agents = projects.flatMap((p, i) =>
    Array.from({ length: i % 13 }, (_, k) => ({
      id: `${p.id}-a${k}`,
      name: `Agent ${k}`,
      purpose: "",
      framework: "CrewAI",
      status: "idle" as const,
      lastRun: null,
      history: [],
      links: [],
      projectId: p.id,
      repository: p.repository,
    })),
  );
  return { projects, agents };
}

describe("layoutMap", () => {
  it("gives every agent its own lot", () => {
    const layout = layoutMap(catalog);
    const ids = layout.districts.flatMap((d) => d.lots.map((l) => l.agent.id));
    expect(ids.sort()).toEqual(catalog.agents.map((a) => a.id).sort());
  });

  it("puts repositories without a manifest in their own lot", () => {
    const layout = layoutMap(catalog, ["me/a", "me/b", "me/c"]);
    const lot = layout.parks.find((p) => p.strays.length);
    expect(lot?.strays.map((s) => s.name)).toEqual(["me/a", "me/b", "me/c"]);
    expect(overlaps(layout)).toEqual([]);
  });

  it("sizes districts by their own agents instead of the largest project", () => {
    const layout = layoutMap(catalog);
    const sizes = new Set(layout.districts.map((d) => d.size));
    expect(sizes.size).toBeGreaterThan(1);
  });

  it("keeps districts apart for hundreds of repositories, in every grouping", () => {
    const big = bigCatalog(300);
    const extra = Array.from({ length: 120 }, (_, i) => `me/stray-${i}`);
    for (const g of ["none", "status", "tag"] as const) {
      const t = performance.now();
      const layout = layoutMap(big, extra, g);
      expect(performance.now() - t).toBeLessThan(200);
      expect(layout.districts).toHaveLength(300);
      expect(overlaps(layout, GAP - 0.01)).toEqual([]);
      // Packed, not strung out: the map stays roughly as wide as it is deep.
      const w = layout.bounds.maxX - layout.bounds.minX;
      const h = layout.bounds.maxY - layout.bounds.minY;
      expect(w / h).toBeLessThan(4);
    }
  });

  it("groups projects into neighborhoods", () => {
    const layout = layoutMap(bigCatalog(20), [], "status");
    expect(layout.neighborhoods.map((n) => n.label)).toEqual(["Needs attention", "Active", "Idle", "Paused", "Retired"]);
    for (const d of layout.districts) expect(d.group).toBe(`s:${d.project.status}`);
  });

  it("is deterministic", () => {
    expect(layoutMap(catalog, ["me/x"], "tag")).toEqual(layoutMap(catalog, ["me/x"], "tag"));
  });
});

describe("placeLabels", () => {
  it("hides lower-priority labels that would overlap", () => {
    const shown = placeLabels([
      { id: "agent", x: 10, top: 0, bottom: 20, w: 80, priority: 6 },
      { id: "repo", x: 0, top: 0, bottom: 20, w: 80, priority: 3 },
      { id: "far", x: 400, top: 0, bottom: 20, w: 80, priority: 6 },
    ]);
    expect([...shown.keys()].sort()).toEqual(["far", "repo"]);
  });

  it("moves a label to an alternative spot before hiding it", () => {
    const shown = placeLabels([
      { id: "repo", x: 0, top: 0, bottom: 20, w: 80, priority: 3 },
      { id: "agent", x: 10, top: 0, bottom: 20, w: 80, priority: 6, alts: [-10, 40] },
    ]);
    expect(shown.get("agent")).toBe(40);
  });
});

describe("walkways", () => {
  it("connects every island in the default map to the street grid", () => {
    const layout = layoutMap(catalog);
    const linked = new Set(layout.walks.flatMap((w) => [w.from, w.to]));
    for (const d of layout.districts) expect(linked.has(d.project.id)).toBe(true);
    for (const w of layout.walks) expect(w.b.gx - w.a.gx + w.b.gy - w.a.gy).toBeGreaterThan(0);
  });
});
