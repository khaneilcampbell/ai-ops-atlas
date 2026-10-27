import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { layoutMap } from "./mapLayout";

describe("layoutMap", () => {
  it("gives every agent its own lot", () => {
    const layout = layoutMap(catalog);
    const ids = layout.districts.flatMap((d) => d.lots.map((l) => l.agent.id));
    expect(ids.sort()).toEqual(catalog.agents.map((a) => a.id).sort());
  });

  it("puts repositories without a manifest in a separate lot", () => {
    const layout = layoutMap(catalog, ["me/a", "me/b", "me/c"]);
    expect(layout.parks[0].strays.map((s) => s.name)).toEqual(["me/a", "me/b", "me/c"]);
    const districtCells = new Set(layout.districts.map((d) => `${d.ox},${d.oy}`));
    expect(districtCells.has(`${layout.parks[0].ox},${layout.parks[0].oy}`)).toBe(false);
  });
});
