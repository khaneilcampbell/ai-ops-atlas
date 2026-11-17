import { describe, expect, it } from "vitest";
import { catalog } from "./index";
import { ESSENTIAL_ROLES, isInactive, memberKind, placement, roleActivity, roleDirectory, roleOf } from "./essentialRoles";
import { isAiAgent } from "./roles";
import { buildRegistry, filterEntries, EMPTY_FILTER } from "../registry/registry";

const dir = roleDirectory(catalog.agents);
const byId = new Map(catalog.agents.map((a) => [a.id, a]));

describe("essential roles directory", () => {
  it("places every catalog entry exactly once and loses none", () => {
    const placed = [...[...dir.members.values()].flat(), ...dir.inactive, ...dir.archived, ...dir.unassigned];
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.sort()).toEqual(catalog.agents.map((a) => a.id).sort());
    expect(dir.unassigned).toEqual([]);
  });

  it("anchors each role on an existing agent and claims each agent once", () => {
    const claimed = ESSENTIAL_ROLES.flatMap((r) => r.agents);
    expect(new Set(claimed).size).toBe(claimed.length);
    for (const r of ESSENTIAL_ROLES) {
      expect(r.agents[0]).toBe(r.id);
      for (const id of r.agents) expect(byId.get(id) && isAiAgent(byId.get(id)!), id).toBe(true);
    }
  });

  it("gives every current automation one owner, in its owner's role, without moving its project", () => {
    const roles = roleOf(catalog.agents);
    for (const a of catalog.agents.filter((x) => !isAiAgent(x) && x.status !== "retired")) {
      expect(a.ownedBy, a.id).toBeTruthy();
      expect(roles.get(a.id), a.id).toBe(roles.get(a.ownedBy!));
    }
    const lab = buildRegistry(catalog, {}, null).find((e) => e.profile.id === "benjaire-product-lab-scoring")!;
    expect([roles.get(lab.profile.id), lab.profile.project.id]).toEqual(["benjaire-product-lab", byId.get("benjaire-product-lab-scoring")!.projectId]);
  });

  it("collapses Product Lab's specialists under Product Research Lead, keeping their ids", () => {
    expect(dir.members.get("benjaire-product-lab")).toEqual(expect.arrayContaining(["benjaire-product-lab-research", "benjaire-product-lab-competitors", "benjaire-product-lab-customers", "benjaire-product-lab-scoring", "benjaire-product-lab-brief"]));
  });

  it("keeps retired entries in Archived and paused or draft entries in Inactive", () => {
    expect(dir.archived).toEqual(catalog.agents.filter((a) => a.status === "retired").map((a) => a.id));
    expect(dir.inactive).toEqual(expect.arrayContaining(["github-profile-manager"]));
    // Data Inventory was published in n8n on 2026-11-13, so it works in its role, not Inactive.
    expect(dir.inactive).not.toContain("atlas-data-inventory");
    expect(isInactive({ id: "x", status: "active", trigger: "None until it is published" })).toBe(true);
    expect([...dir.members.values()].flat().some((id) => byId.get(id)!.status === "retired" || byId.get(id)!.status === "paused")).toBe(false);
  });

  it("finds an entry by original name, id, project and automation name", () => {
    const entries = buildRegistry(catalog, {}, null);
    const find = (query: string) => filterEntries(entries, { ...EMPTY_FILTER, query }).map((e) => e.profile.id);
    expect(find("Claude Site Assistant")).toContain("site-builder");
    expect(find("benjaire-flow-digest")).toContain("benjaire-flow-digest");
    expect(find("Flow Monday Digest")).toContain("benjaire-flow-digest");
    expect(find("Splunk")).toContain("soc-detection-lead");
  });

  it("labels deterministic workflows Automation and owning agents as coordinators", () => {
    expect(memberKind(byId.get("atlas-ci")!)).toBe("Automation");
    expect(memberKind(byId.get("atlas-release-manager")!)).toBe("Coordinates automations");
    expect(memberKind(byId.get("repo-intelligence")!)).toBe("AI runtime");
  });

  it("derives activity from observed runs, never from an enabled schedule", () => {
    const now = Date.parse("2026-11-17T00:00:00Z");
    expect(roleActivity([{ operational: "configured", lastVerifiedAt: null }, { operational: "failing", lastVerifiedAt: null }, { operational: "unknown", lastVerifiedAt: null }, { operational: "verified", lastVerifiedAt: "2026-11-16T00:00:00Z" }, { operational: "verified", lastVerifiedAt: "2026-09-01T00:00:00Z" }], now)).toEqual({ verified: 1, failing: 1, unknown: 1, stale: 1, noEvidence: 1 });
  });

  it("shows every entry's building and module from the catalog; every building houses a module", () => {
    const noModule = new Set<string>();
    for (const a of catalog.agents) {
      const p = placement(a, catalog.projects);
      expect(p.building, a.id).toBeTruthy();
      if (!p.module) noModule.add(a.projectId);
    }
    expect([...noModule]).toEqual([]);
    expect(placement(byId.get("benjaire-product-lab-brief")!, catalog.projects)).toEqual({ building: "Business Operations HQ", module: "Business Operations HQ" });
  });

  it("counts roles, automations and archived entries separately", () => {
    expect(dir.counts.roles).toBe(8);
    expect(dir.counts.aiAgents + dir.counts.automations + dir.counts.archived).toBe(catalog.agents.length);
    console.log("role directory counts", dir.counts, Object.fromEntries([...dir.members].map(([k, v]) => [k, v.length])), "inactive", dir.inactive);
  });
});
