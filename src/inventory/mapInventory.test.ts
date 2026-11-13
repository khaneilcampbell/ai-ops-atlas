import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { OFF_MAP_PROJECTS } from "../catalog/projects";
import { anchorsOf } from "../views/map3d/Map3D";
import { buildScene } from "../views/map3d/scene";
import { layoutMap } from "../views/mapLayout";
import { INVENTORY_SCHEMA, mapInventory } from "./mapInventory";

const inv = mapInventory(catalog);

describe("Atlas map inventory", () => {
  it("lists every clickable building on the map, once", () => {
    const layout = layoutMap(catalog, [], "district");
    const onMap = [...anchorsOf(buildScene(layout), layout).keys()].filter((k) => !k.startsWith("agent:"));
    const ids = inv.buildings.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of onMap) expect(ids, `missing ${k}`).toContain(k);
  });

  it("keeps removed buildings as Retired or Vacant lot rows", () => {
    for (const id of OFF_MAP_PROJECTS) expect(inv.buildings.find((b) => b.id === `project:${id}`)?.status).toMatch(/^(Retired|Vacant lot)$/);
  });

  it("places every catalog agent exactly once and never invents a building", () => {
    expect(inv.agents.map((a) => a.id).sort()).toEqual(catalog.agents.map((a) => a.id).sort());
    const ids = new Set(inv.buildings.map((b) => b.id));
    for (const a of inv.agents) expect(a.building_id === "" || ids.has(a.building_id)).toBe(true);
    const total = inv.buildings.reduce((n, b) => n + b.agent_ids.length, 0);
    expect(total).toBe(inv.agents.filter((a) => a.building_id).length);
  });

  it("puts landmark operators in the building they operate", () => {
    const census = inv.agents.find((a) => a.id === "dataset-census");
    if (census) expect(census.building_id).toBe("service:financial:residence");
  });

  it("counts moving objects from the map's own plans", () => {
    const kinds = new Set(inv.objects.map((o) => o.category));
    for (const c of ["Road vehicles", "Aircraft", "Boats", "Trains", "People"]) expect(kinds, c).toContain(c);
    for (const o of inv.objects) expect(o.count).toBeGreaterThan(0);
  });

  it("uses plain names, never the old initials", () => {
    expect(JSON.stringify(inv)).not.toMatch(/\bKC\b/);
  });
});

// `npm run inventory` writes the file the Atlas Data Inventory n8n workflow reads.
const out = process.env.ATLAS_INVENTORY_OUT;
if (out) {
  it("writes the inventory file", () => {
    writeFileSync(out, JSON.stringify({ ...inv, schema: INVENTORY_SCHEMA, generated_at: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? "" }, null, 1) + "\n");
  });
}
