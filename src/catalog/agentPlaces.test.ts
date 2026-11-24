import { describe, expect, it } from "vitest";
import { catalog } from "./index";
import { agentJobs } from "./agentJobs";
import { agentPlaces, automationHomes } from "./agentPlaces";

// Landmark residents (workspace.yaml `residents`) share their building as a home, not an apartment.
const RESIDENT_HOMES = new Set(["Investment Operations Center"]);

describe("agent places", () => {
  const places = agentPlaces(catalog);

  it("gives every catalog agent a home and a work building", () => {
    for (const a of catalog.agents) {
      const p = places.get(a.id)!;
      // Working agents: an apartment drawn inside (301 to 606). Automations: their own numbering. Off duty: none.
      expect(p.home.label, a.id).toMatch(/apartment ([3-6]0[1-6]|\d+[A-D])$|suite [1-4]0[1-4]$|no apartment while (planned|paused|retired)$|^Investment Operations Center$/);
      expect(p.work.label.length, a.id).toBeGreaterThan(0);
    }
  });

  it("keeps AI agents' homes exactly as their job cards give them", () => {
    for (const j of agentJobs(catalog)) expect(places.get(j.agentId)!.home.label).toBe(j.home.label);
  });

  it("never puts two agents in one apartment", () => {
    const homes = [...places.values()].map((p) => p.home.label).filter((l) => !l.includes("no apartment") && !RESIDENT_HOMES.has(l));
    expect(new Set(homes).size).toBe(homes.length);
  });

  it("marks automations' homes as assigned and their workplace as declared", () => {
    const jobs = new Set(agentJobs(catalog).map((j) => j.agentId));
    const auto = catalog.agents.find((a) => !jobs.has(a.id))!;
    expect(places.get(auto.id)!.home.source).toBe("assigned");
    expect(places.get(auto.id)!.work.source).toBe("declared");
  });

  it("works where workspace.yaml says a landmark agent operates", () => {
    expect(places.get("dataset-census")?.work.label).toBeTruthy();
    expect(places.get("dataset-census")!.work.label).not.toMatch(/Atlas Command Center$/);
  });

  it("assigns automation homes from the top of the East tower, stable by id", () => {
    const a = automationHomes(["b", "a"]);
    expect(a.get("a")).toMatch(/East, apartment 31A$/);
    expect(a.get("b")).toMatch(/East, apartment 31B$/);
  });
});
