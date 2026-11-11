import { describe, expect, it } from "vitest";
import type { ManifestIssue } from "../catalog/types";
import { AGENCY_KEY } from "../views/map3d/marketingAgencyPlan";
import { MALL_KEY } from "../views/map3d/mallPlan";
import { DEALERSHIP_KEY } from "../views/map3d/dealershipPlan";
import { FINANCIAL_BUILDINGS, financialKey } from "../views/map3d/financialPlan";
import { LOOP_STATIONS } from "../views/map3d/perimeterRailPlan";
import { AIRPORT_BUILDINGS, airportBuildingKey } from "../views/map3d/airportBuildings";
import { LANDMARK_MODULES, WORKSPACE, WORKSPACE_SCHEMA, parseWorkspace, workspaceIssues } from "./workspace";

/** Every landmark id the map draws itself and that workspace.yaml may give a module. */
const MAP_KEYS = new Set([AGENCY_KEY, MALL_KEY, DEALERSHIP_KEY, ...FINANCIAL_BUILDINGS.map((b) => financialKey(b.id)), ...LOOP_STATIONS.map((s) => s.id), ...AIRPORT_BUILDINGS.map((b) => airportBuildingKey(b.id))]);

const parse = (text: string) => {
  const issues: ManifestIssue[] = [];
  const ws = parseWorkspace("test.yaml", text, issues);
  return { ws, issues: issues.map((i) => i.message) };
};

describe("workspace file", () => {
  it("loads this install's workspace from catalog/workspace/workspace.yaml without problems", () => {
    expect(workspaceIssues).toEqual([]);
    expect(WORKSPACE).toMatchObject({ id: "benjaire", name: "Benjaire", entitlements: "all" });
    expect(WORKSPACE.landmarks).toBe(LANDMARK_MODULES);
    expect(LANDMARK_MODULES.length).toBeGreaterThanOrEqual(12);
    for (const l of LANDMARK_MODULES) expect(MAP_KEYS.has(`service:${l.id}`), l.id).toBe(true);
    expect(new Set(LANDMARK_MODULES.map((l) => l.id)).size).toBe(LANDMARK_MODULES.length);
  });

  it("sets up another workspace from a file alone, with its own entitlements", () => {
    const { ws, issues } = parse(`schema: ${WORKSPACE_SCHEMA}\nworkspace:\n  id: acme\n  name: Acme\n  entitlements: [business-operations-hq, finance-analytics-tower]\nlandmarks:\n  "service:financial:banks":\n    map_name: Bayvale Bank\n    module: finance-analytics-tower\n`);
    expect(issues).toEqual([]);
    expect(ws).toEqual({ id: "acme", name: "Acme", entitlements: ["business-operations-hq", "finance-analytics-tower"], landmarks: [{ id: "financial:banks", name: "Bayvale Bank", moduleType: "finance-analytics-tower" }] });
  });

  it("reports each problem and keeps the good landmarks, never throwing", () => {
    const { ws, issues } = parse(`schema: atlas/other\nworkspace:\n  id: Bad Id\n  entitlements: [not-a-module]\nlandmarks:\n  "project:atlas":\n    map_name: X\n    module: atlas-command-center\n  "service:financial:banks":\n    module: nope\n  "service:atlas-marketplace":\n    module: commerce-product-marketplace\n  "service:bmw-dealership":\n    map_name: Vantor Motors\n    module: infrastructure-control-tower\n`);
    expect(issues).toEqual([
      `schema: must be "${WORKSPACE_SCHEMA}"`,
      "workspace.id: is required (lower-case letters, digits and dashes)",
      "workspace.name: is required",
      'workspace.entitlements: "not-a-module" is not a module type',
      'landmarks.project:atlas: use a landmark id such as "service:atlas-marketplace"',
      "landmarks.service:financial:banks.map_name: is required (the map's own name for the building)",
      "landmarks.service:atlas-marketplace.map_name: is required (the map's own name for the building)",
    ]);
    expect(ws.entitlements).toEqual([]);
    expect(ws.landmarks).toEqual([{ id: "bmw-dealership", name: "Vantor Motors", moduleType: "infrastructure-control-tower" }]);
    expect(parse("- [").issues[0]).toMatch(/invalid YAML/);
    expect(parse("- [").ws.landmarks).toEqual([]);
  });

  it("treats a bad module id on a landmark as a problem, not a planned module", () => {
    const { ws, issues } = parse(`schema: ${WORKSPACE_SCHEMA}\nworkspace: { id: a, name: A }\nlandmarks:\n  "service:financial:banks": { map_name: Bayvale Bank, module: finance-tower }\n`);
    expect(issues).toEqual(['landmarks.service:financial:banks.module: "finance-tower" is not a module type']);
    expect(ws.landmarks).toEqual([]);
  });
});
