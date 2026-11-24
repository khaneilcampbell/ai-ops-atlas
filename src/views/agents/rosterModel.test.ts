import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { roleDirectory } from "../../catalog/essentialRoles";
import { buildRegistry } from "../../registry/registry";
import { buildRoster, filterRoster, rosterCounts, sortRoster } from "./rosterModel";

const entries = new Map(buildRegistry(catalog, {}, null).map((e) => [e.profile.id, e]));
const rows = buildRoster(catalog.agents, entries);

describe("Agents > Roster", () => {
  it("has one row per current AI agent, with skills folded into the agent that runs them", () => {
    const skills = rows.reduce((n, r) => n + r.skills.length, 0);
    expect(rows.length).toBe(roleDirectory(catalog.agents).counts.aiAgents);
    expect(skills).toBe(roleDirectory(catalog.agents).counts.skills);
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

  it("lists the Product Lab steps as Leila Haddad's skills, not as rows of their own", () => {
    const lab = rows.find((r) => r.id === "benjaire-product-lab")!;
    expect(lab.person).toBe("Leila Haddad");
    expect(lab.skills).toHaveLength(5);
    expect(rows.some((r) => r.id.startsWith("benjaire-product-lab-"))).toBe(false);
    expect(filterRoster(rows, "all", "competitor").map((r) => r.id)).toEqual(["benjaire-product-lab"]);
    for (const by of ["name", "role", "health", "automations", "verified"] as const) expect(sortRoster(rows, by)).toHaveLength(rows.length);
  });

  it("filters add up and Needs you means failing, paused automations or inactive", () => {
    const c = rosterCounts(rows);
    expect(c.verified + c.unverified).toBe(c.all);
    for (const r of filterRoster(rows, "needs")) expect(r.operational === "failing" || r.automations.paused > 0 || r.inactive).toBe(true);
    expect(filterRoster(rows, "all", "yusuf").map((r) => r.id)).toEqual(["agent-operations-lead"]);
  });
});
