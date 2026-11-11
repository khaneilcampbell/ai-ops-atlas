import { expect, it, vi } from "vitest";
import { MODULE_TYPES } from "./catalog";
import { panelsFor, workspaceScope, workspaceViews } from "./workspaces";
import { WORKSPACE_PANELS } from "../components/ModuleWorkspaceLists";
import { landmarkInstances } from "./instances";
import { MODULE_TYPE_IDS } from "./types";

vi.mock("../intel/state", () => ({ useIntel: () => ({ telemetry: null }) }));

const typeOf = (id: string) => MODULE_TYPES[id as keyof typeof MODULE_TYPES];

it("every workspace panel is the evidence for an available capability of its module", () => {
  for (const [id, panels] of Object.entries(WORKSPACE_PANELS)) {
    const type = typeOf(id);
    expect(type, id).toBeDefined();
    for (const p of panels!) {
      const cap = type.capabilities.find((c) => c.id === p.capability);
      expect(cap, `${id}: ${p.capability}`).toBeDefined();
      expect(cap!.state, `${id}: ${p.capability}`).toBe("available");
    }
  }
});

it("a module's workspace is defined once and shared by every building that houses it", () => {
  const finance = typeOf("finance-analytics-tower");
  const homes = landmarkInstances().filter((b) => b.moduleType === finance.id);
  expect(homes.length).toBeGreaterThan(1);
  const labels = panelsFor(finance, WORKSPACE_PANELS).map((p) => p.label);
  expect(labels).toEqual(["Spend against caps"]);
  // Nothing in the table is keyed by a building id.
  for (const key of Object.keys(WORKSPACE_PANELS)) expect(MODULE_TYPE_IDS).toContain(key);
});

it("hides panels whose capability is only planned", () => {
  const planned = { ...typeOf("growth-marketing-studio"), capabilities: typeOf("growth-marketing-studio").capabilities.map((c) => ({ ...c, state: "planned" as const })) };
  expect(panelsFor(planned, WORKSPACE_PANELS)).toEqual([]);
});

it("never offers the map as a workspace view, and scopes only the directories to a project", () => {
  for (const t of Object.values(MODULE_TYPES)) expect(workspaceViews(t)).not.toContain("map");
  expect(workspaceScope("agents", "ai-ops-atlas")).toEqual({ project: "ai-ops-atlas" });
  expect(workspaceScope("automations", "ai-ops-atlas")).toEqual({ project: "ai-ops-atlas" });
  expect(workspaceScope("overview", "ai-ops-atlas")).toBeNull();
  expect(workspaceScope("agents", null)).toBeNull();
});
