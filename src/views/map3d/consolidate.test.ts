import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { WORKSPACE, hostOf, housedIn, onMapKey, parseWorkspace } from "../../modules/workspace";
import type { ManifestIssue } from "../../catalog/types";
import { layoutMap } from "../mapLayout";
import { presentScene } from "./consolidate";
import { financialKey } from "./financialPlan";
import { buildScene } from "./scene";

// Khaneil, 2026-11-24: the map shows eight core buildings plus Atlas Airport, Team Residence Towers and
// Atlas Commons. Everything else is folded into one of them (workspace.yaml `merged`), never deleted.
const CORE = ["project:ai-ops-atlas", "project:intelligence-hub", "service:atlas-station", "project:github-profile", "project:portfolio-site", "project:benjaire-site", "service:benjaire-marketing", "project:soc-lab"];

describe("eight core buildings", () => {
  const planned = buildScene(layoutMap(catalog, [], "district")), drawn = presentScene(planned);

  it("folds every merged building into a core building or Atlas Commons, and never a core building itself", () => {
    const hosts = new Set(Object.values(WORKSPACE.merged ?? {}));
    for (const h of hosts) expect([...CORE, "service:atlas-commons"]).toContain(h);
    for (const k of [...CORE, "service:atlas-commons", "service:logistics-airport", financialKey("circa")]) expect(hostOf(k), k).toBeUndefined();
    expect(housedIn("project:benjaire-site")).toEqual(expect.arrayContaining(["project:commerce-pipeline", "service:atlas-galleria", financialKey("banks"), financialKey("insurance"), financialKey("budget")]));
    expect(housedIn("project:github-profile")).toEqual([financialKey("financial-planning")]);
    expect(housedIn("service:benjaire-marketing")).toEqual(["service:atlas-marketplace"]);
    expect(housedIn("project:soc-lab")).toEqual(["service:bmw-dealership"]);
    expect(onMapKey("service:atlas-galleria")).toBe("project:benjaire-site");
    expect(onMapKey("project:ai-ops-atlas")).toBe("project:ai-ops-atlas");
  });

  it("draws only the core towers, the Residence Towers and the airport; folded buildings are not drawn", () => {
    expect(drawn.towers.map((t) => t.key).sort()).toEqual(CORE.filter((k) => k.startsWith("project:")).sort());
    expect(drawn.financial?.buildings.map((b) => b.id)).toEqual(["circa"]);
    expect([drawn.dealership, drawn.mall, drawn.galleria, drawn.plaza, drawn.stadium, drawn.stadiumSite]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(drawn.agency && drawn.commons && drawn.airport).toBeTruthy();
  });

  it("keeps the planned city exactly as it was, so streets, rail and traffic don't move", () => {
    expect(planned.towers.some((t) => t.key === "project:commerce-pipeline")).toBe(true);
    expect(planned.financial!.buildings.length).toBeGreaterThan(1);
    expect(drawn.land).toBe(planned.land);
    expect(drawn.communityRail).toBe(planned.communityRail);
    expect(drawn.transportConnections).toBe(planned.transportConnections);
  });

  it("keeps every folded building's data: catalog project, agents and module assignment", () => {
    expect(catalog.projects.some((p) => p.id === "commerce-pipeline")).toBe(true);
    expect(catalog.agents.some((a) => a.projectId === "commerce-pipeline")).toBe(true);
    for (const id of ["atlas-marketplace", "atlas-galleria", "bmw-dealership", "financial:banks", "financial:residence"]) expect(WORKSPACE.landmarks.some((l) => l.id === id), id).toBe(true);
  });

  it("rejects a bad merged entry without dropping the rest", () => {
    const issues: ManifestIssue[] = [];
    const ws = parseWorkspace("w.yaml", `schema: atlas/workspace-v1\nworkspace: { id: a, name: A }\nmerged:\n  "service:x": "project:host"\n  "service:y": "service:x"\n  "bad": "project:host"\n  "project:self": "project:self"\n`, issues);
    expect(ws.merged).toEqual({ "service:x": "project:host" });
    expect(issues.map((i) => i.message.split(":")[0] + ":" + i.message.split(":")[1])).toHaveLength(3);
  });
});
