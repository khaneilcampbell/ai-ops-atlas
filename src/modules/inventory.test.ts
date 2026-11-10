import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { isAiAgent } from "../catalog/roles";
import type { RepoSnapshot, RepoState } from "../github/types";
import { buildConnections } from "../lib/connections";
import type { LiveStatus } from "../live/feed";
import { MODULE_TYPE_LIST } from "./catalog";
import { workspaceBuildings } from "./instances";
import { datasetInventory, moduleInventory, projectDependencies, workflowMap } from "./inventory";

const connections = buildConnections(catalog, {});
const off: LiveStatus = { state: "off", message: null, checkedAt: null, last: null, intelRuns: null, production: [], agentRuns: null };

describe("module inventory", () => {
  it("lists every module type with its buildings and how much is built", () => {
    const rows = moduleInventory(workspaceBuildings(catalog));
    expect(rows.map((r) => r.type)).toEqual(MODULE_TYPE_LIST.map((t) => t.id));
    expect(rows.find((r) => r.type === "atlas-command-center")!.buildings).toContain("Atlas HQ");
    for (const r of rows) expect(r.available).toBeLessThanOrEqual(r.total);
  });
});

describe("declared dependencies", () => {
  it("groups only manifest-declared links by project, each with its evidence", () => {
    const groups = projectDependencies(connections, catalog);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) for (const l of g.links) {
      expect(l.id).toMatch(/^(dep|decl):/);
      expect(l.evidence).toMatch(/^catalog\//);
    }
  });

  it("maps only links that touch an automation, and never marks one failing without a failed run", () => {
    const automations = new Set(catalog.agents.filter((a) => !isAiAgent(a)).map((a) => a.id));
    const links = workflowMap(connections, catalog);
    for (const l of links) {
      const c = connections.find((x) => x.id === l.id)!;
      expect([c.source, c.target].some((e) => e.kind === "agent" && automations.has(e.id))).toBe(true);
      expect(l.failing).toBe(false);
    }
  });
});

describe("dataset inventory", () => {
  it("says nothing is held rather than inventing counts", () => {
    const rows = datasetInventory(catalog, {}, off);
    expect(rows.find((r) => r.id === "github")).toMatchObject({ state: "none", records: "0 of 0 repositories" });
    expect(rows.find((r) => r.id === "agent-runs")).toMatchObject({ state: "none", records: "Not loaded" });
    expect(rows.find((r) => r.id === "live")).toMatchObject({ state: "none", records: "Not set up here" });
    expect(rows.find((r) => r.id === "catalog")!.state).toBe("ok");
  });

  it("marks repository snapshots partial when some reads failed, with the newest fetch time", () => {
    const snap = (fetchedAt: string) => ({ fullName: "x", defaultBranch: "main", runs: [], fetchedAt } as unknown as RepoSnapshot);
    const repos: Record<string, RepoState> = { a: { kind: "ok", data: snap("2026-11-10T10:00:00Z"), stale: false }, b: { kind: "error", message: "403" } };
    expect(datasetInventory(catalog, repos, off).find((r) => r.id === "github")).toMatchObject({ state: "partial", records: "1 of 2 repositories", updated: "2026-11-10T10:00:00Z" });
  });
});
