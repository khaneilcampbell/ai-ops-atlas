import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { buildCatalog } from "../catalog/parse";
import { CORE_MODULES, MODULE_TYPE_LIST, MODULE_TYPE_SOURCE, MODULE_TYPES, isModuleType, moduleAvailability } from "./catalog";
import { buildingInstances, moduleHealth } from "./instances";
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
    expect(moduleAvailability(MODULE_TYPES["workflow-automation-plant"])).toBe("partial");
    expect(moduleAvailability(MODULE_TYPES["observability-center"])).toBe("planned");
    expect(isModuleType("business-operations-hq")).toBe(true);
    expect(isModuleType("Benjaire HQ")).toBe(false);
  });
});

describe("building instances", () => {
  const instances = buildingInstances(catalog);

  it("keeps every building's id, name and district exactly as the manifest has them", () => {
    expect(instances.map((i) => [i.id, i.name])).toEqual(catalog.projects.map((p) => [p.id, p.name]));
    expect(instances.find((i) => i.id === "ai-ops-atlas")).toMatchObject({ name: "Atlas HQ", districtId: "ai-operations", moduleType: "atlas-command-center", enabled: true });
  });

  it("separates the workspace's building name from its platform module", () => {
    const hq = instances.find((i) => i.id === "benjaire-site")!;
    expect(hq).toMatchObject({ name: "Benjaire HQ", moduleType: "business-operations-hq", moduleProvenance: "declared", enabled: true });
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
});
