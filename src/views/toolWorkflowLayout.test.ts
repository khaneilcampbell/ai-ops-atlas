import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { servicesOf } from "../catalog/roles";
import { orderToolsForWorkflow, workflowToolSpots, toolWorkflowRoads } from "./toolWorkflowLayout";
import { layoutMap } from "./mapLayout";

describe("workflow tool placement", () => {
  it("places research before design before publishing in the commerce workflow", () => {
    const tools = servicesOf(catalog.agents.filter(a => a.projectId === "commerce-pipeline"));
    expect(orderToolsForWorkflow(tools).map(t => t.id)).toEqual(["serper", "canva", "stripe"]);
    expect(orderToolsForWorkflow([...tools].reverse()).map(t => t.id)).toEqual(["serper", "canva", "stripe"]);
  });
  it("keeps every tool in a distinct perimeter slot clear of its project tower", () => {
    const layout = layoutMap(catalog);
    for (const d of layout.districts) for (const k of d.kiosks) {
      expect(k.gx).toBeGreaterThanOrEqual(d.ox);
      expect(k.gy).toBeGreaterThanOrEqual(d.oy);
      expect(k.gx + k.size).toBeLessThanOrEqual(d.ox + d.size);
      expect(k.gy + k.size).toBeLessThanOrEqual(d.oy + d.size);
      expect(k.gx + k.size <= d.hq.gx || k.gx >= d.hq.gx + d.hq.size || k.gy + k.size <= d.hq.gy || k.gy >= d.hq.gy + d.hq.size).toBe(true);
    }
    expect(workflowToolSpots(0, 8)).toEqual([]);
    const points = workflowToolSpots(7, 10);
    expect(new Set(points.map(p => `${p.gx},${p.gy}`)).size).toBe(7);
  });
});

describe("workflow roads", () => {
  it("links every tool entrance in workflow order and returns to headquarters without crossing buildings", () => {
    for (const d of layoutMap(catalog).districts) {
      const roads = toolWorkflowRoads(d.hq, d.kiosks);
      if (!d.kiosks.length) { expect(roads).toEqual([]); continue; }
      const buildings = [d.hq, ...d.kiosks];
      expect(roads).toHaveLength(buildings.length);
      roads.forEach((road, i) => {
        const from=buildings[i], to=buildings[(i+1)%buildings.length];
        expect(road[0]).toEqual({gx:from.gx+from.size/2,gy:from.gy+from.size+0.25});
        expect(road[road.length-1]).toEqual({gx:to.gx+to.size/2,gy:to.gy+to.size+0.25});
        for(let j=1;j<road.length;j++) {
          const a=road[j-1],b=road[j];
          expect(a.gx===b.gx||a.gy===b.gy).toBe(true);
          for(const box of buildings) expect(Math.min(a.gx,b.gx)<box.gx+box.size && Math.max(a.gx,b.gx)>box.gx && Math.min(a.gy,b.gy)<box.gy+box.size && Math.max(a.gy,b.gy)>box.gy).toBe(false);
        }
      });
    }
  });
});
