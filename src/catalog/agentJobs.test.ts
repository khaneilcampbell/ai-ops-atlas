import { describe, expect, it } from "vitest";
import { catalog } from "./index";
import { AGENT_RESIDENCE, agentJobs, apartments, clock, ownerOf, SHIFT_BY_TRIGGER } from "./agentJobs";
import { isAiAgent } from "./roles";
import type { Agent } from "./types";

describe("agent jobs", () => {
  const jobs = agentJobs(catalog);
  it("gives every AI agent, and only AI agents, one job card", () => {
    expect(jobs.map((j) => j.agentId)).toEqual(catalog.agents.filter(isAiAgent).map((a) => a.id));
    expect(jobs.length).toBeGreaterThan(10);
  });
  it("gives each agent its own Circa apartment, stable across catalog order", () => {
    const units = jobs.map((j) => `${j.home.label}`);
    expect(new Set(units).size).toBe(jobs.length);
    expect(jobs.every((j) => j.home.building === AGENT_RESIDENCE.id)).toBe(true);
    const reversed = apartments(jobs.map((j) => j.agentId).reverse());
    for (const j of jobs) expect(reversed.get(j.agentId)).toEqual(j.home);
  });
  it("sends agents with a declared workplace there, others to their headquarters", () => {
    const suite = jobs.find((j) => j.agentId === "atlas-system-improvements")!;
    expect(suite.work).toMatchObject({ kind: "workplace", building: "OpenAI" });
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
    const scout = jobs.find((j) => j.agentId === "github-opportunity-scout")!;
    expect(scout.budget.provenance).toBe("declared");
    expect(scout.budget.value).toContain("$1 a month");
    const analyst = jobs.find((j) => j.agentId === "job-analyst")!;
    expect(analyst.budget).toMatchObject({ provenance: "inferred", value: "Not documented" });
    expect(jobs.every((j) => j.shift.provenance === "inferred")).toBe(true);
  });
  it("keeps planned agents home", () => {
    expect(jobs.find((j) => j.agentId === "skyline-inquiry-assistant")!.offDuty).toBe("planned");
  });
  it("reads a person from the credential owner, and falls back to KC otherwise", () => {
    const with_ = (credentialOwner: string) => ({ registry: { governance: { credentialOwner } } }) as unknown as Agent;
    expect(ownerOf(with_("KC (macOS Keychain)"))).toMatchObject({ value: "KC", provenance: "declared" });
    expect(ownerOf(with_("GitHub ephemeral GITHUB_TOKEN, contents read"))).toMatchObject({ value: "KC", provenance: "inferred" });
    expect(ownerOf(with_("None needed (reads local files only)"))).toMatchObject({ value: "KC", provenance: "inferred" });
  });
  it("formats shift hours", () => {
    expect(clock(9.5)).toBe("9:30");
    expect(clock(17)).toBe("17:00");
  });
});
