import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { catalog } from "../../catalog";
import { WORKSPACE, hostOf } from "../../modules/workspace";
import { FINANCE_PLAN } from "../../finance/benjaire";
import { layoutMap } from "../mapLayout";
import { buildScene } from "./scene";
import { financialKey } from "./financialPlan";
import { financialDimensions } from "./financialArchitecture";
import { DEALERSHIP_KEY } from "./dealershipPlan";
import { BOH_KEY, CLEARED_FOR_BOH, SUPPLIER_HUB_KEY, businessHqFootprints, presentBusinessHq } from "./businessHqPlan";

const planned = buildScene(layoutMap(catalog, [], "district"));
const drawn = presentBusinessHq(planned);
type R = { x: number; z: number; w: number; d: number };
const overlaps = (a: R, b: R) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;

describe("Business Operations HQ in the Financial District corner", () => {
  it("clears exactly the Budget & Forecasting, Governance & Compliance and Security & Infrastructure Showroom models", () => {
    expect(CLEARED_FOR_BOH).toEqual([financialKey("budget"), financialKey("records"), DEALERSHIP_KEY]);
    const before = planned.financial!.buildings.map((b) => b.id), after = drawn.financial!.buildings.map((b) => b.id);
    expect(before.filter((id) => !after.includes(id))).toEqual(["budget", "records"]);
    expect(drawn.dealership).toBeUndefined();
    // Airport, Team Residence Towers and every other building stay drawn.
    expect(after).toContain("circa");
    expect(drawn.airport).toBe(planned.airport);
    expect(drawn.towers).toBe(planned.towers);
  });

  it("leaves the planned scene alone, so streets, rail and traffic keep their ground", () => {
    expect(planned.dealership).toBeDefined();
    expect(planned.financial!.buildings.some((b) => b.id === "budget")).toBe(true);
    expect(drawn.transportConnections).toBe(planned.transportConnections);
    expect(drawn.communityRail).toBe(planned.communityRail);
  });

  it("keeps the cleared buildings' records, modules and data, housed in the HQ or the Security & Infrastructure Center", () => {
    expect(hostOf(financialKey("budget"))).toBe(BOH_KEY);
    expect(hostOf(financialKey("records"))).toBe(BOH_KEY);
    expect(hostOf(DEALERSHIP_KEY)).toBe("project:soc-lab");
    expect(hostOf(SUPPLIER_HUB_KEY)).toBe(BOH_KEY);
    for (const id of ["financial:records", "bmw-dealership"]) expect(WORKSPACE.landmarks.some((l) => l.id === id), id).toBe(true);
    expect(Object.keys(FINANCE_PLAN.buildings)).toEqual(expect.arrayContaining([financialKey("budget"), financialKey("records")]));
  });

  it("fits the HQ, forecourt, walkway and annex on the plot without touching the buildings that stay", () => {
    const f = businessHqFootprints(drawn.businessHq!), fd = drawn.financial!;
    for (const b of fd.buildings) {
      const dim = financialDimensions(b.id), r = { x: fd.x + b.x, z: fd.z + b.z, w: dim.w, d: dim.d };
      for (const part of [f.hq, f.annex]) expect(overlaps(part, r), b.id).toBe(false);
    }
    // East of the Investment Operations Center, inside the perimeter railway, north of the district street.
    const rail = Math.max(...planned.communityRail!.loop!.route.map(([x]) => x));
    expect(f.annex.x + f.annex.w / 2).toBeLessThan(rail - 1);
    expect(f.hq.z + f.hq.d / 2).toBeLessThan(fd.street[0][1] - 0.4);
    expect(f.annex.w * f.annex.d).toBeLessThan((f.hq.w * f.hq.d) / 3);
    expect(f.annex.y1).toBeLessThan(f.hq.y1 / 3);
  });

  it("ships a light Blender-built model", () => {
    const glb = "public/models/map/business-operations-hq.glb";
    expect(existsSync(glb)).toBe(true);
    expect(statSync(glb).size).toBeLessThan(300_000);
    expect(existsSync("assets/business-operations-hq/business-operations-hq.blend")).toBe(true);
  });
});
