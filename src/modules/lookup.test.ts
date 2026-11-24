import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { buildingForSelection } from "./lookup";

it("finds the module building behind a map selection by stable id", () => {
  expect(buildingForSelection({ kind: "service", id: "atlas-galleria" }, catalog)?.moduleType).toBe("business-operations-hq");
  expect(buildingForSelection({ kind: "project", id: "intelligence-hub" }, catalog)?.moduleType).toBe("agent-operations-center");
  expect(buildingForSelection({ kind: "service", id: "benjaire-marketing" }, catalog)?.moduleType).toBe("growth-marketing-studio");
  // Grouped with Business Operations HQ: no module of its own, but the HQ still finds it.
  expect(buildingForSelection({ kind: "service", id: "financial:investments" }, catalog)).toBeUndefined();
  expect(buildingForSelection({ kind: "service", id: "financial:investments" }, catalog, { grouped: true })?.moduleType).toBe("integration-exchange");
  expect(buildingForSelection({ kind: "service", id: "atlas-station" }, catalog)?.moduleType).toBe("workflow-automation-plant");
  expect(buildingForSelection({ kind: "project", id: "portfolio-site" }, catalog)?.moduleType).toBe("development-repository-hub");
});

it("returns nothing for selections that are not module buildings", () => {
  expect(buildingForSelection({ kind: "service", id: "financial-park" }, catalog)).toBeUndefined();
  // Buildings whose function no module covers yet house none (product decision pending).
  expect(buildingForSelection({ kind: "service", id: "skyline-stadium" }, catalog)).toBeUndefined();
  expect(buildingForSelection({ kind: "service", id: "financial:budget" }, catalog)).toBeUndefined();
  expect(buildingForSelection({ kind: "service", id: "Benjaire Marketing Agency" }, catalog)).toBeUndefined();
  expect(buildingForSelection({ kind: "agent", id: "benjaire-site" }, catalog)).toBeUndefined();
  expect(buildingForSelection(null, catalog)).toBeUndefined();
});

describe("landmarkModuleStatus", () => {
  it("tells a landmark with real data apart from a planned one, and names what it reads", async () => {
    const { landmarkModuleStatus } = await import("./lookup");
    const ops = landmarkModuleStatus("airport-building:operations");
    expect(ops?.name).toBe("Observability Center");
    expect(ops?.availability).toBe("partial");
    expect(ops?.connectors).toContain("GitHub");
    expect(landmarkModuleStatus("airport-building:cargo")?.availability).toBe("partial");
    expect(landmarkModuleStatus("airport-building:nope")).toBeUndefined();
  });
});
