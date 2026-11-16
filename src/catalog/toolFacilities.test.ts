import { describe, expect, it } from "vitest";
import { catalog } from ".";
import { OFF_MAP_PROJECTS } from "./projects";
import { facilityById, facilityStatus, SATELLITE_RULES, toolFacilities } from "./toolFacilities";
import { INTEGRATION_CATALOG } from "../product/integrations";
import { buildScene } from "../views/map3d/scene";
import { layoutMap } from "../views/mapLayout";

const facilities = toolFacilities(catalog.projects, catalog.agents, OFF_MAP_PROJECTS);
const byId = new Map(catalog.agents.map((a) => [a.id, a]));

describe("Tool facilities: data", () => {
  it("gives every facility a unique id and key, and a parent building on the map", () => {
    expect(new Set(facilities.map((f) => f.id)).size).toBe(facilities.length);
    expect(new Set(facilities.map((f) => f.key)).size).toBe(facilities.length);
    for (const f of facilities) {
      expect(OFF_MAP_PROJECTS.has(f.projectId)).toBe(false);
      expect(f.parentBuildingId).toBe(`project:${f.projectId}`);
      expect(catalog.projects.some((p) => p.id === f.projectId)).toBe(true);
    }
  });

  it("only stands for tools a current item really names (or, for n8n, links)", () => {
    for (const f of facilities) {
      const users = [...f.associatedAgentIds, ...f.associatedWorkflowIds].map((id) => byId.get(id)!);
      expect(users.length, f.id).toBeGreaterThan(0);
      for (const a of users) {
        expect(a.projectId).toBe(f.projectId);
        expect(a.status).not.toBe("retired");
        const rule = SATELLITE_RULES.find((r) => r.toolId === f.toolId);
        const re = rule?.re ?? new RegExp(`\\b${f.toolId}\\b`, "i");
        const named = (a.registry?.responsibilities?.tools ?? []).some((t) => re.test(t));
        const linked = f.toolId === "n8n" && a.links.some((l) => /n8n/i.test(l.label));
        expect(named || linked, `${a.id} → ${f.id}`).toBe(true);
      }
    }
  });

  it("points at real Integration Center entries, one shared entry per integration", () => {
    const ids = new Set(INTEGRATION_CATALOG.map((d) => d.id));
    for (const f of facilities) if (f.integrationId) expect(ids.has(f.integrationId), f.id).toBe(true);
    // GitHub backs several buildings' facilities through the same single integration.
    expect(facilities.filter((f) => f.integrationId === "github").length).toBeGreaterThan(1);
  });

  it("doesn't count Claude Code (a coding tool someone runs) as the Claude integration", () => {
    const site = facilities.filter((f) => f.projectId === "portfolio-site").map((f) => f.toolId);
    expect(site).toContain("github");
    expect(site).not.toContain("anthropic");
  });

  it("matches every district tool office the map draws, by its existing key", () => {
    const scene = buildScene(layoutMap(catalog, [], "district"));
    const offices = facilities.filter((f) => f.source === "tool-office");
    const keys = new Set(scene.kiosks.map((k) => k.key));
    for (const o of offices) expect(keys.has(o.key), o.key).toBe(true);
    // A satellite never repeats a tool its building already has an office for.
    for (const f of facilities.filter((x) => x.source === "satellite")) expect(offices.some((o) => o.projectId === f.projectId && o.toolId === f.toolId)).toBe(false);
  });

  it("finds a facility by its selection id", () => {
    const f = facilities.find((x) => x.source === "satellite")!;
    expect(facilityById(facilities, `facility:${f.id}`)).toBe(f);
    const o = facilities.find((x) => x.source === "tool-office")!;
    expect(facilityById(facilities, o.id)).toBe(o);
  });

  it("claims connected only after a real check, and never turns 'not set up' into a failure", () => {
    expect(facilityStatus({ status: "connected", verifiedAt: "2026-11-16T00:00:00Z" })).toBe("connected");
    expect(facilityStatus({ status: "connected", verifiedAt: null })).toBe("configured");
    expect(facilityStatus({ status: "degraded", verifiedAt: null })).toBe("degraded");
    expect(facilityStatus({ status: "disconnected", verifiedAt: null })).toBe("disconnected");
    expect(facilityStatus({ status: "unsupported", verifiedAt: null })).toBe("unavailable");
    expect(facilityStatus({ status: "configuration_required", verifiedAt: null })).toBe("unknown");
    expect(facilityStatus(undefined)).toBe("unknown");
  });
});
