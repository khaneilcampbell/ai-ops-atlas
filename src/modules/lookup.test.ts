import { expect, it } from "vitest";
import { catalog } from "../catalog";
import { buildingForSelection } from "./lookup";

it("finds the module building behind a map selection by stable id", () => {
  expect(buildingForSelection({ kind: "project", id: "benjaire-site" }, catalog)?.moduleType).toBe("business-operations-hq");
  expect(buildingForSelection({ kind: "project", id: "intelligence-hub" }, catalog)?.moduleType).toBe("agent-operations-center");
  expect(buildingForSelection({ kind: "service", id: "benjaire-marketing" }, catalog)?.moduleType).toBe("growth-marketing-studio");
  expect(buildingForSelection({ kind: "service", id: "financial:investments" }, catalog)?.moduleType).toBe("integration-exchange");
  expect(buildingForSelection({ kind: "service", id: "atlas-station" }, catalog)?.moduleType).toBe("workflow-automation-plant");
});

it("returns nothing for selections that are not module buildings", () => {
  expect(buildingForSelection({ kind: "project", id: "portfolio-site" }, catalog)).toBeUndefined();
  expect(buildingForSelection({ kind: "service", id: "financial-park" }, catalog)).toBeUndefined();
  // Buildings whose function no module covers yet house none (product decision pending).
  expect(buildingForSelection({ kind: "service", id: "skyline-stadium" }, catalog)).toBeUndefined();
  expect(buildingForSelection({ kind: "service", id: "financial:budget" }, catalog)).toBeUndefined();
  expect(buildingForSelection({ kind: "service", id: "Benjaire Marketing Agency" }, catalog)).toBeUndefined();
  expect(buildingForSelection({ kind: "agent", id: "benjaire-site" }, catalog)).toBeUndefined();
  expect(buildingForSelection(null, catalog)).toBeUndefined();
});
