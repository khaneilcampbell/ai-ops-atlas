import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { layoutMap, type GroupBy } from "../mapLayout";
import { buildScene } from "./scene";
import { freightParts } from "./freightParts";
import { highwayLightPositions } from "./highwayDetails";

/**
 * A size budget for the highway. #148 made it ~18,000 boxes (5,600 after #151 and this budget), which on its own pushed the map past
 * what a GPU could draw in a frame and left it blank. Raise the budget only with a measured reason.
 */
const BUDGET = 7_000;

const partsFor = (g: GroupBy) => {
  const plan = buildScene(layoutMap(catalog, [], g)).freight;
  if (!plan) return [];
  return freightParts(plan, highwayLightPositions(plan.highway, [...plan.exits, ...plan.localJunctions]));
};

describe("highway size budget", () => {
  for (const g of ["district", "status", "tag", "none"] as GroupBy[]) {
    it(`stays under ${BUDGET} boxes grouped by ${g}`, () => {
      const n = partsFor(g).length;
      console.log(`freight parts (${g}): ${n}`);
      expect(n).toBeLessThan(BUDGET);
    });
  }
});
