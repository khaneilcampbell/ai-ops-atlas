import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { roleDirectory } from "../../catalog/essentialRoles";
import { buildRegistry } from "../../registry/registry";
import { buildRoster, filterRoster, rosterCounts, sortRoster } from "./rosterModel";

const entries = new Map(buildRegistry(catalog, {}, null).map((e) => [e.profile.id, e]));
const rows = buildRoster(catalog.agents, entries);

describe("Agents > Roster", () => {
  it("has one row per current AI agent", () => {
    expect(rows.length).toBe(roleDirectory(catalog.agents).counts.aiAgents);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("counts each owned automation once, and only real values", () => {
    const owned = catalog.agents.filter((a) => a.ownedBy && a.status !== "retired" && rows.some((r) => r.id === a.ownedBy)).length;
    expect(rows.reduce((n, r) => n + r.automations.live + r.automations.paused + r.automations.manual, 0)).toBe(owned);
    for (const r of rows) {
      if (!entries.get(r.id)?.telemetry.lastVerifiedRun) expect(r.lastVerifiedAt).toBeNull();
      if (entries.get(r.id)?.telemetry.monthSpendUsd == null) expect(r.spendUsd).toBeNull();
    }
  });

  it("keeps the Product Lab steps under Leila Haddad's row whatever the sort", () => {
    const steps = rows.filter((r) => r.parent === "benjaire-product-lab");
    expect(steps).toHaveLength(5);
    for (const by of ["name", "role", "health", "automations", "verified"] as const) {
      const ids = sortRoster(rows, by, by === "name").map((r) => r.id);
      const lead = ids.indexOf("benjaire-product-lab");
      expect(ids.slice(lead + 1, lead + 6).sort()).toEqual(steps.map((s) => s.id).sort());
      expect(ids).toHaveLength(rows.length);
    }
  });

  it("filters add up and Needs you means failing, paused automations or inactive", () => {
    const c = rosterCounts(rows);
    expect(c.verified + c.unverified).toBe(c.all);
    for (const r of filterRoster(rows, "needs")) expect(r.operational === "failing" || r.automations.paused > 0 || r.inactive).toBe(true);
    expect(filterRoster(rows, "all", "yusuf").map((r) => r.id)).toEqual(["agent-operations-lead"]);
  });
});
