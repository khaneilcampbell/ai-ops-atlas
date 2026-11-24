import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { OFF_MAP_PROJECTS } from "./projects";
import { districtOf } from "./organization";
import { DISTRICTS, DISTRICT_ZONE, ZONES, zoneOf } from "./taxonomy";

describe("compass zones", () => {
  it("gives every district one zone and leaves no side empty", () => {
    for (const d of DISTRICTS) expect(ZONES).toContain(DISTRICT_ZONE[d]);
    const used = new Set([...DISTRICTS.map((d) => DISTRICT_ZONE[d]), "centre"]);
    expect([...used].sort()).toEqual([...ZONES].sort());
  });

  it("puts every building on the map in exactly one zone, with the Command Center in the middle", () => {
    const onMap = catalog.projects.filter((p) => !OFF_MAP_PROJECTS.has(p.id));
    expect(onMap.length).toBeGreaterThan(0);
    for (const p of onMap) expect(ZONES).toContain(zoneOf(p.id, districtOf(p, catalog.agents).value));
    const centre = onMap.filter((p) => zoneOf(p.id, districtOf(p, catalog.agents).value) === "centre").map((p) => p.id);
    expect(centre).toEqual(["ai-ops-atlas"]);
  });
});
