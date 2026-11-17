import { describe, expect, it } from "vitest";
import { catalog } from "./index";
import { agentJobs } from "./agentJobs";
import { agentPlaces, automationHomes } from "./agentPlaces";

describe("agent places", () => {
  const places = agentPlaces(catalog);

  it("gives every catalog agent a home and a work building", () => {
    for (const a of catalog.agents) {
      const p = places.get(a.id)!;
      expect(p.home.label, a.id).toMatch(/apartment \d+[A-D]$/);
      expect(p.work.label.length, a.id).toBeGreaterThan(0);
    }
  });

  it("keeps AI agents' homes exactly as their job cards give them", () => {
    for (const j of agentJobs(catalog)) expect(places.get(j.agentId)!.home.label).toBe(j.home.label);
  });

  it("never puts two agents in one apartment", () => {
    const homes = [...places.values()].map((p) => p.home.label);
    expect(new Set(homes).size).toBe(homes.length);
  });

  it("marks automations' homes as assigned and their workplace as declared", () => {
    const jobs = new Set(agentJobs(catalog).map((j) => j.agentId));
    const auto = catalog.agents.find((a) => !jobs.has(a.id))!;
    expect(places.get(auto.id)!.home.source).toBe("assigned");
    expect(places.get(auto.id)!.work.source).toBe("declared");
  });

  it("works where workspace.yaml says a landmark agent operates", () => {
    expect(places.get("signal-watch")?.work.label).toBeTruthy();
    expect(places.get("signal-watch")!.work.label).not.toMatch(/Atlas Command Center$/);
  });

  it("assigns automation homes from the top of the East tower, stable by id", () => {
    const a = automationHomes(["b", "a"]);
    expect(a.get("a")).toMatch(/East, apartment 31A$/);
    expect(a.get("b")).toMatch(/East, apartment 31B$/);
  });
});
