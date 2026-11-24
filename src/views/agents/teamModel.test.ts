import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { roleDirectory } from "../../catalog/essentialRoles";
import { isAiAgent } from "../../catalog/roles";
import { buildTeam, roleHealth } from "./teamModel";

const none = new Map();
const team = buildTeam(catalog.agents, catalog.projects, none);
const dir = roleDirectory(catalog.agents);

describe("Agents > Team", () => {
  it("draws Yusuf Demir's role as the coordinator and every other role once", () => {
    expect(team.coordinator.id).toBe("agent-operations-lead");
    expect(team.roles.map((r) => r.id)).not.toContain("agent-operations-lead");
    expect(team.roles.length + 1).toBe(dir.counts.roles);
  });

  it("counts every current AI agent and automation exactly as the directory does", () => {
    const roles = [team.coordinator, ...team.roles];
    expect(roles.reduce((n, r) => n + r.automations, 0) + dir.inactive.filter((id) => !isAiAgent(catalog.agents.find((a) => a.id === id)!)).length + dir.unassigned.length).toBe(dir.counts.automations);
    expect(team.lifecycle.active.length + team.lifecycle.inactive.length).toBe(dir.counts.aiAgents);
    expect(team.counts.unassigned).toBe(0);
  });

  it("never invents health: no runs means no verified run", () => {
    for (const r of [team.coordinator, ...team.roles]) expect(r.health.label).toBe("No verified run");
    expect(roleHealth({ verified: 2, failing: 1, unknown: 0, stale: 0, noEvidence: 0 })).toEqual({ tone: "bad", label: "1 failing" });
    expect(roleHealth({ verified: 2, failing: 0, unknown: 0, stale: 0, noEvidence: 0 }).label).toBe("2 verified running");
  });

  it("lists failing entries first, then drafts to publish, then inactive agents", () => {
    const failing = catalog.agents.find((a) => a.ownedBy && a.status === "active")!;
    const t = buildTeam(catalog.agents, catalog.projects, new Map([[failing.id, { operational: "failing" as const, lastVerifiedAt: null }]]));
    expect(t.needs[0]).toMatchObject({ kind: "failing", id: failing.id, agent: failing.ownedBy });
    const kinds = t.needs.map((n) => n.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => ["failing", "draft", "inactive"].indexOf(a) - ["failing", "draft", "inactive"].indexOf(b)));
    for (const n of t.needs.filter((x) => x.kind === "draft")) expect(n.link?.url).toMatch(/n8n/);
  });
});
