import { describe, expect, it } from "vitest";
import { DESK_CELL, INTERIOR_K, OFFICE_FURNITURE } from "../../buildings/buildingDefinition";
import { CITY_FIGURES } from "../../registry/cityFigures";
import { AGENT_BODY, SEAT_HEIGHT, passWidth, seatedClearHeight, seatedOrigin, standingClearHeight } from "./agentBody";
import { FIGURE_SCALE, RIG } from "./agentFigures";
import { COMMONS_BENCH } from "./commonsPlan";
import { GITHUB_TOWER } from "./githubTowerPlan";
import { fitDoor } from "./models";
import { CABIN_DROP, WHEEL, WHEEL_CABIN } from "./stationPlazaPlan";

const tallest = Math.max(...Object.values(CITY_FIGURES).map((f) => f.build.height));

describe("the agents' body (the reference every space is fitted to)", () => {
  it("is measured from the rig at the tallest agent's size, the portrait badge left out", () => {
    expect(AGENT_BODY.standingHeight).toBeCloseTo(RIG.top * FIGURE_SCALE * tallest, 6);
    expect(AGENT_BODY.seatedHeight + AGENT_BODY.hipHeight).toBeCloseTo(AGENT_BODY.standingHeight, 6);
    expect(AGENT_BODY.shoulderWidth).toBeGreaterThan(AGENT_BODY.depth);
  });

  it("sits with its hips on the seat surface, scaled once", () => {
    const scale = FIGURE_SCALE * tallest;
    expect(seatedOrigin(1, scale) + RIG.leg.h * scale).toBeCloseTo(1, 9);
  });
});

describe("spaces fit a seated or standing agent", () => {
  it("Ferris wheel cabins: seated agent under the roof, bench at hip height, clear of the plinth at the bottom", () => {
    const clear = WHEEL_CABIN.roof - WHEEL_CABIN.roofT / 2 - WHEEL_CABIN.seatY;
    expect(clear).toBeGreaterThanOrEqual(seatedClearHeight - 1e-9);
    expect(WHEEL_CABIN.seatY - WHEEL_CABIN.floor).toBeCloseTo(SEAT_HEIGHT, 9);
    expect(WHEEL_CABIN.w).toBeGreaterThanOrEqual(passWidth);
    // Seated depth (back of the torso to the feet) inside the glass, seated a little back of centre.
    expect(AGENT_BODY.seatedDepth - WHEEL_CABIN.seatZ).toBeLessThan(WHEEL_CABIN.d / 2 + AGENT_BODY.depth / 2);
    // The bottom cabin still clears the wheel's plinth (0.1 tall) as it passes.
    expect(WHEEL.hub - WHEEL.radius - CABIN_DROP).toBeGreaterThan(0.1);
    // Neighbouring cabins never touch where they hang one above the other (3 and 9 o'clock).
    const spacing = 2 * WHEEL.radius * Math.sin(Math.PI / 12);
    expect(spacing).toBeGreaterThan(CABIN_DROP + WHEEL_CABIN.rod);
  });

  it("headquarters doors: an agent's height plus clearance, one pass width", () => {
    const door = fitDoor({ p: [0, 0, 0], s: [0.1, 0.2, 0.025] });
    expect(door.s[1]).toBeGreaterThanOrEqual(standingClearHeight);
    expect(door.s[0]).toBeGreaterThanOrEqual(passWidth);
    // A bigger door keeps its own size.
    expect(fitDoor({ p: [0, 0, 0], s: [1, 1, 0.025] }).s).toEqual([1, 1, 0.025]);
    // GitHub's door is in its lower podium tier, which stands tall enough to hold it.
    expect(GITHUB_TOWER.podium[0].h).toBeGreaterThan(standingClearHeight);
  });

  it("offices: the aisle behind the chairs is one pass width, the chair seat at hip height", () => {
    const aisle = (DESK_CELL.d - OFFICE_FURNITURE.backZ - OFFICE_FURNITURE.deskHalfD) * INTERIOR_K;
    expect(aisle).toBeCloseTo(passWidth, 6);
    expect(Math.abs(OFFICE_FURNITURE.seatTop * INTERIOR_K - SEAT_HEIGHT)).toBeLessThan(0.01);
  });

  it("Commons benches seat three side by side", () => {
    expect(COMMONS_BENCH.length / 3).toBeGreaterThanOrEqual(AGENT_BODY.shoulderWidth);
  });
});
