import { describe, expect, it } from "vitest";
import { catalog } from "./index";
import { AGENT_RESIDENCE, OVERFLOW_RESIDENCE, agentJobs, apartments, clock, ownerOf, SHIFT_BY_TRIGGER } from "./agentJobs";
import { isAiAgent } from "./roles";
import type { Agent } from "./types";
import { WORKSPACE } from "../modules/workspace";

describe("agent jobs", () => {
  const jobs = agentJobs(catalog);
  it("gives every AI agent, and only AI agents, one job card", () => {
    expect(jobs.map((j) => j.agentId)).toEqual(catalog.agents.filter(isAiAgent).map((a) => a.id));
    expect(jobs.length).toBeGreaterThan(10);
  });
  it("gives each working agent its own Circa apartment, stable across catalog order", () => {
    // Residents of a landmark (workspace.yaml `residents`) live in that building instead.
    const resident = new Set(WORKSPACE.landmarks.flatMap((l) => l.residents ?? []));
    for (const j of jobs.filter((j) => resident.has(j.agentId))) expect(j.home).toMatchObject({ building: "investments", label: "Investment Operations Center" });
    const rest = jobs.filter((j) => !resident.has(j.agentId));
    const working = rest.filter((j) => !j.offDuty);
    expect(new Set(working.map((j) => j.home.label)).size).toBe(working.length);
    // Off duty agents hold no apartment, so they never take one a working agent needs.
    for (const j of rest.filter((j) => j.offDuty)) expect(j.home).toMatchObject({ unit: "", label: expect.stringContaining(`no apartment while ${j.offDuty}`) });
    expect(rest.every((j) => j.home.building === AGENT_RESIDENCE.id)).toBe(true);
    const named = new Set(catalog.agents.filter((a) => a.registry?.identity).map((a) => a.id));
    const reversed = apartments(rest.map((j) => j.agentId).reverse(), new Map(rest.flatMap((j) => (j.offDuty ? [[j.agentId, j.offDuty] as const] : []))), named);
    for (const j of rest) expect(reversed.get(j.agentId)).toEqual(j.home);
  });
  it("moves the city's named agents into Team Residence Towers first, then Client Success Center once it's full", () => {
    // Every named agent has its own apartment in the residence today.
    const named = jobs.filter((j) => catalog.agents.find((a) => a.id === j.agentId)?.registry?.identity && !j.offDuty);
    expect(named.length).toBe(17);
    for (const j of named) expect(j.home.building, j.agentId).toBe(AGENT_RESIDENCE.id);
    // 24 apartments, then Client Success Center's suites; named agents are never the ones moved out.
    const ids = Array.from({ length: 30 }, (_, i) => `agent-${String(i).padStart(2, "0")}`);
    const first = new Set(ids.slice(20));
    const homes = apartments(ids, new Map(), first);
    for (const id of first) expect(homes.get(id)!.building).toBe(AGENT_RESIDENCE.id);
    const overflow = ids.filter((id) => homes.get(id)!.building === OVERFLOW_RESIDENCE.id);
    expect(overflow).toEqual(ids.slice(14, 20));
    expect(homes.get(overflow[0])).toMatchObject({ unit: "101", label: expect.stringMatching(/suite 101$/) });
    expect(new Set([...homes.values()].map((h) => h.label)).size).toBe(30);
  });
  it("sends agents with a declared workplace there, others to their headquarters", () => {
    // Exercise declared-workplace mapping independently of the real workflow's classification.
    const original = catalog.agents.find(a => a.id === "atlas-production-coordinator")!;
    const fixture = { ...original, workplace: { building: "Atlas Marketplace" as const, floor: 1, room: "108" }, registry: { ...original.registry, classification: { type: "A" as const, confidence: "verified" as const } } };
    const suite = agentJobs({ ...catalog, agents: [fixture] })[0];
    expect(suite.work).toMatchObject({ kind: "workplace", building: "Atlas Marketplace" });
    const hq = jobs.find((j) => j.agentId === "niche-scout")!;
    expect(hq.work).toMatchObject({ kind: "headquarters", projectId: "commerce-pipeline" });
  });
  it("keeps every shift inside the day and within an hour of its trigger's default", () => {
    for (const j of jobs) {
      const a = catalog.agents.find((x) => x.id === j.agentId)!;
      const [start, end] = SHIFT_BY_TRIGGER[a.registry?.execution?.triggerType ?? "unknown"];
      expect(Math.abs(j.shift.value.start - start)).toBeLessThanOrEqual(1);
      expect(j.shift.value.end - j.shift.value.start).toBe(end - start);
      expect(j.shift.value.start).toBeGreaterThan(0);
      expect(j.shift.value.end).toBeLessThan(24);
    }
  });
  it("labels what the manifest says and what Atlas worked out", () => {
    const declared = jobs.find(j => j.agentId === "repo-intelligence")!;
    expect(declared.budget.provenance).toBe("declared");
    expect(declared.budget.value).toContain("limits");
    const inferred = jobs.find(j => j.agentId === "niche-scout")!;
    expect(inferred.budget).toMatchObject({ provenance: "inferred", value: "Not documented" });
    expect(jobs.every((j) => j.shift.provenance === "inferred")).toBe(true);
  });
  it("keeps planned agents home", () => {
    const base = catalog.agents.find((a) => a.id === "repo-intelligence")!;
    const planned: Agent = { ...base, id: "planned-agent", registry: { ...base.registry, classification: { type: "F", confidence: "verified" } } };
    expect(agentJobs({ ...catalog, agents: [planned] })[0].offDuty).toBe("planned");
  });
  it("reads a person from the credential owner, and falls back to Khaneil otherwise", () => {
    const with_ = (credentialOwner: string) => ({ registry: { governance: { credentialOwner } } }) as unknown as Agent;
    expect(ownerOf(with_("Khaneil (macOS Keychain)"))).toMatchObject({ value: "Khaneil", provenance: "declared" });
    expect(ownerOf(with_("GitHub ephemeral GITHUB_TOKEN, contents read"))).toMatchObject({ value: "Khaneil", provenance: "inferred" });
    expect(ownerOf(with_("None needed (reads local files only)"))).toMatchObject({ value: "Khaneil", provenance: "inferred" });
  });
  it("formats shift hours", () => {
    expect(clock(9.5)).toBe("9:30");
    expect(clock(17)).toBe("17:00");
  });
});
