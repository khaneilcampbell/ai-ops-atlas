import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { WORKSPACE, hostOf, housedIn, onMapKey, parseWorkspace } from "./workspace";
import { buildingForSelection, landmarkModuleStatus } from "./lookup";
import type { ManifestIssue } from "../catalog/types";
import { financialKey } from "../views/map3d/financialPlan";

// Khaneil, 2026-11-24: eight core buildings hold the modules. The other buildings stay on the map
// but house no module for now (workspace.yaml `merged`); nothing is deleted.
const CORE = ["project:ai-ops-atlas", "project:intelligence-hub", "service:atlas-station", "project:github-profile", "project:portfolio-site", "service:atlas-galleria", "service:benjaire-marketing", "project:soc-lab"];

describe("eight core buildings", () => {
  it("groups every other building with a core building or Atlas Commons, and never a core building itself", () => {
    for (const h of new Set(Object.values(WORKSPACE.merged ?? {}))) expect([...CORE, "service:atlas-commons"]).toContain(h);
    for (const k of [...CORE, "service:atlas-commons", "service:logistics-airport", financialKey("circa")]) expect(hostOf(k), k).toBeUndefined();
    expect(housedIn("service:atlas-galleria")).toEqual(expect.arrayContaining(["project:commerce-pipeline", "project:benjaire-site", financialKey("banks"), financialKey("insurance"), financialKey("budget")]));
    expect(housedIn("project:github-profile")).toEqual([financialKey("financial-planning")]);
    expect(housedIn("service:benjaire-marketing")).toEqual(["service:atlas-marketplace"]);
    expect(housedIn("project:soc-lab")).toEqual(["service:bmw-dealership"]);
    expect(onMapKey("project:benjaire-site")).toBe("service:atlas-galleria");
  });

  it("gives a grouped building no module of its own, while core buildings keep theirs", () => {
    expect(buildingForSelection({ kind: "project", id: "commerce-pipeline" }, catalog)).toBeUndefined();
    expect(buildingForSelection({ kind: "project", id: "benjaire-site" }, catalog)).toBeUndefined();
    expect(landmarkModuleStatus("financial:banks")).toBeUndefined();
    // Khaneil, 2026-11-24: the former Vendor & Supplier Hub is the Business Operations HQ building.
    expect(buildingForSelection({ kind: "service", id: "atlas-galleria" }, catalog)?.moduleType).toBe("business-operations-hq");
    expect(buildingForSelection({ kind: "service", id: "benjaire-marketing" }, catalog)?.moduleType).toBe("growth-marketing-studio");
  });

  it("keeps every grouped building's data: catalog project, agents and module assignment", () => {
    expect(catalog.projects.some((p) => p.id === "commerce-pipeline")).toBe(true);
    expect(catalog.agents.some((a) => a.projectId === "commerce-pipeline")).toBe(true);
    for (const id of ["atlas-marketplace", "atlas-galleria", "bmw-dealership", "financial:banks", "financial:residence"]) expect(WORKSPACE.landmarks.some((l) => l.id === id), id).toBe(true);
  });

  it("rejects a bad merged entry without dropping the rest", () => {
    const issues: ManifestIssue[] = [];
    const ws = parseWorkspace("w.yaml", `schema: atlas/workspace-v1\nworkspace: { id: a, name: A }\nmerged:\n  "service:x": "project:host"\n  "service:y": "service:x"\n  "bad": "project:host"\n  "project:self": "project:self"\n`, issues);
    expect(ws.merged).toEqual({ "service:x": "project:host" });
    expect(issues).toHaveLength(3);
  });
});
