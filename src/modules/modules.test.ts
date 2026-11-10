import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { buildCatalog } from "../catalog/parse";
import { CORE_MODULES, MODULE_TYPE_LIST, MODULE_TYPE_SOURCE, MODULE_TYPES, isModuleType, moduleAvailability } from "./catalog";
import { buildingInstances, instancesOf, landmarkInstances, moduleHealth, workspaceBuildings } from "./instances";
import { AGENCY_KEY, AGENCY_NAME } from "../views/map3d/marketingAgencyPlan";
import { MALL_KEY } from "../views/map3d/mallPlan";
import { DEALERSHIP_KEY } from "../views/map3d/dealershipPlan";
import { ATLAS_STATION_KEY } from "../views/map3d/hillsCommunityPlan";
import { LOOP_STATIONS } from "../views/map3d/perimeterRailPlan";
import { GITHUB_TOWER } from "../views/map3d/githubTowerPlan";
import { airportBuilding, airportBuildingKey } from "../views/map3d/airportBuildings";
import { financialBrand } from "../views/map3d/financialBrands";
import { financialKey } from "../views/map3d/financialPlan";
import { LANDMARK_MODULES, WORKSPACE, isEntitled, type AtlasWorkspace } from "./workspace";
import { MODULE_TYPE_IDS } from "./types";

describe("module catalog", () => {
  it("defines each module type exactly once", () => {
    expect(MODULE_TYPE_SOURCE.map((t) => t.id).sort()).toEqual([...MODULE_TYPE_IDS].sort());
    expect(MODULE_TYPE_LIST).toHaveLength(16);
    for (const id of CORE_MODULES) expect(MODULE_TYPES[id]).toBeDefined();
  });

  it("backs every available capability with code that exists", () => {
    for (const t of MODULE_TYPE_LIST) {
      expect(new Set(t.capabilities.map((c) => c.id)).size, t.id).toBe(t.capabilities.length);
      for (const c of t.capabilities.filter((c) => c.state === "available")) {
        const file = c.evidence?.split(" ")[0] ?? "";
        expect(existsSync(file), `${t.id}.${c.id}: ${c.evidence}`).toBe(true);
      }
    }
  });

  it("never names a workspace or business in a platform module", () => {
    expect(JSON.stringify(MODULE_TYPE_LIST)).not.toMatch(/benjaire|khaneil|\bkc\b/i);
  });

  it("gives planned modules no views or actions", () => {
    for (const t of MODULE_TYPE_LIST.filter((t) => moduleAvailability(t) === "planned")) {
      expect(t.views, t.id).toEqual([]);
      expect(t.actions, t.id).toEqual([]);
    }
  });

  it("works out availability from the capabilities", () => {
    expect(moduleAvailability(MODULE_TYPES["agent-operations-center"])).toBe("available");
    expect(moduleAvailability(MODULE_TYPES["workflow-automation-plant"])).toBe("available");
    expect(moduleAvailability(MODULE_TYPES["business-operations-hq"])).toBe("partial");
    expect(moduleAvailability(MODULE_TYPES["observability-center"])).toBe("planned");
    expect(isModuleType("business-operations-hq")).toBe(true);
    expect(isModuleType("Benjaire HQ")).toBe(false);
  });
});

describe("building instances", () => {
  const instances = buildingInstances(catalog);

  it("keeps every building's id, name and district exactly as the manifest has them", () => {
    expect(instances.map((i) => [i.id, i.name])).toEqual(catalog.projects.map((p) => [p.id, p.name]));
    expect(instances.find((i) => i.id === "ai-ops-atlas")).toMatchObject({ name: "Atlas Command Center", organization: "Atlas", districtId: "ai-operations", moduleType: "atlas-command-center", enabled: true });
  });

  it("separates the workspace's building name from its platform module", () => {
    const hq = instances.find((i) => i.id === "benjaire-site")!;
    expect(hq).toMatchObject({ name: "Business Operations HQ", organization: "Benjaire", moduleType: "business-operations-hq", moduleProvenance: "declared", enabled: true });
    expect(MODULE_TYPES[hq.moduleType!].name).toBe("Business Operations HQ");
  });

  it("leaves buildings without a module as personal buildings, and planned modules switched off", () => {
    expect(instances.find((i) => i.id === "portfolio-site")).toMatchObject({ moduleType: null, moduleProvenance: "none", enabled: false });
    expect(instances.find((i) => i.id === "soc-lab")).toMatchObject({ moduleType: "security-operations-center", enabled: false });
  });

  it("reports health as unknown until telemetry is connected", () => {
    expect(new Set(instances.map((i) => i.health))).toEqual(new Set(["unknown"]));
    expect([moduleHealth("good"), moduleHealth("warn"), moduleHealth("bad"), moduleHealth("unknown"), moduleHealth(undefined)]).toEqual(["healthy", "warning", "critical", "unknown", "unknown"]);
  });

  it("lets another workspace use the same module under its own name, and rejects unknown modules", () => {
    const yaml = (id: string, name: string, module: string) => `schema: atlas/v2\nproject:\n  id: ${id}\n  name: ${name}\n  status: active\n  repository: acme/${id}\n  module: ${module}\n`;
    const { catalog: other, issues } = buildCatalog({ "a.yaml": yaml("acme-hq", "Acme HQ", "business-operations-hq"), "b.yaml": yaml("acme-x", "Acme X", "made-up-module") });
    expect(buildingInstances(other).map((i) => [i.name, i.moduleType])).toEqual([["Acme HQ", "business-operations-hq"], ["Acme X", null]]);
    expect(issues.map((i) => i.message).join()).toMatch(/must be one of/);
  });

  it("houses each module in the building named for it, keeping the map's own ids", () => {
    const all = workspaceBuildings(catalog);
    const home = (t: string) => instancesOf(all, t as never).map((i) => i.name);
    expect(home("atlas-command-center")).toEqual(["Atlas Command Center"]);
    expect(home("business-operations-hq")).toEqual(["Business Operations HQ"]);
    expect(home("agent-operations-center")).toEqual(["Agent Operations Center"]);
    expect(home("commerce-product-marketplace")).toEqual(["Commerce Operations Center", "Product Marketplace"]);
    expect(home("security-operations-center")).toEqual(["Security Operations Center"]);
    expect(home("growth-marketing-studio")).toEqual(["Growth & Marketing Studio"]);
    expect(home("workflow-automation-plant")).toEqual(["Workflow Automation Hub"]);
    expect(home("data-intelligence-center")).toEqual(["Data Intelligence Center"]);
    expect(home("finance-analytics-tower")).toEqual(["Financial Operations Tower", "Corvane Capital"]);
    expect(home("identity-governance-tower")).toEqual(["Governance & Compliance Center"]);
    expect(home("infrastructure-control-tower")).toEqual(["Infrastructure Operations Hub"]);
    expect(home("integration-exchange")).toEqual(["Integration Exchange"]);
    expect(home("observability-center")).toEqual(["Atlas · Operations"]);
    expect(all.find((i) => i.id === GITHUB_TOWER.projectId)?.moduleType).toBe("development-repository-hub");
    expect(home("model-intelligence-lab")).toEqual(["Atlas · Cargo"]);
    expect(home("knowledge-repository")).toEqual(["Knowledge & Research Center"]);
    expect(all.filter((i) => i.districtId === null).map((i) => i.id)).toEqual(LANDMARK_MODULES.map((l) => l.id));
    // Planned modules are placed but switched off until they are built.
    expect(all.find((i) => i.id === "benjaire-marketing")).toMatchObject({ moduleType: "growth-marketing-studio", enabled: false, organization: "Benjaire" });
  });

  it("ties each landmark to the map's own key and name, so a rename on the map fails here", () => {
    const named = Object.fromEntries(LANDMARK_MODULES.map((l) => [`service:${l.id}`, l.name]));
    expect(named[AGENCY_KEY]).toBe(AGENCY_NAME);
    expect(named[MALL_KEY]).toBe("Atlas Marketplace");
    expect(named[DEALERSHIP_KEY]).toBe("Vantor Motors");
    expect(named[ATLAS_STATION_KEY]).toBe(LOOP_STATIONS.find((s) => s.id === ATLAS_STATION_KEY)!.name);
    expect(named[airportBuildingKey("operations")]).toBe(airportBuilding("operations")!.name);
    for (const id of ["banks", "records", "investments", "residence", "business-finance", "financial-planning"]) expect(named[financialKey(id)], id).toBe(financialBrand(id)!.name);
    expect(named[airportBuildingKey("cargo")]).toBe(airportBuilding("cargo")!.name);
  });
});

describe("workspace configuration", () => {
  it("gives every module type at least one building in this workspace (KC, 2026-11-10)", () => {
    const housed = new Set(workspaceBuildings(catalog).map((b) => b.moduleType));
    expect(MODULE_TYPE_LIST.filter((t) => !housed.has(t.id)).map((t) => t.id)).toEqual([]);
  });

  it("keeps this install's landmark names in the workspace, not in the module catalog", () => {
    expect(WORKSPACE.landmarks).toBe(LANDMARK_MODULES);
    expect(WORKSPACE.entitlements).toBe("all");
    expect(workspaceBuildings(catalog).filter((b) => b.enabled).length).toBeGreaterThan(0);
  });

  it("switches off modules a workspace is not entitled to, without renaming or moving buildings", () => {
    const limited: AtlasWorkspace = { ...WORKSPACE, entitlements: ["business-operations-hq"] };
    const all = workspaceBuildings(catalog, limited);
    expect(all.map((b) => [b.id, b.name, b.moduleType])).toEqual(workspaceBuildings(catalog).map((b) => [b.id, b.name, b.moduleType]));
    expect(all.filter((b) => b.enabled).map((b) => b.moduleType)).toEqual(["business-operations-hq"]);
    expect(isEntitled(limited, "atlas-command-center")).toBe(false);
    expect(isEntitled(WORKSPACE, null)).toBe(false);
  });

  it("lets another workspace bring its own landmark names for the same modules", () => {
    const acme: AtlasWorkspace = { id: "acme", name: "Acme", entitlements: "all", landmarks: [{ id: "acme-ops", name: "Acme Ops Floor", moduleType: "agent-operations-center" }] };
    expect(landmarkInstances(acme)).toMatchObject([{ id: "acme-ops", name: "Acme Ops Floor", moduleType: "agent-operations-center", enabled: true }]);
  });
});
