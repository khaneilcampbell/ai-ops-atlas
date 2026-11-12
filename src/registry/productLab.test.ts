import { expect, it } from "vitest";
import { catalog } from "../catalog";
import { toProfile } from "./profile";
import { OPERATIONAL_LABEL, operationalState, telemetryFor } from "./telemetry";

const IDS = ["benjaire-product-lab", "benjaire-product-lab-research", "benjaire-product-lab-competitors", "benjaire-product-lab-customers", "benjaire-product-lab-scoring", "benjaire-product-lab-brief"];

it("shows Benjaire Product Lab as configured, not verified, until Atlas sees a run", () => {
  for (const id of IDS) {
    const agent = catalog.agents.find((a) => a.id === id)!;
    expect(agent, id).toBeDefined();
    expect(agent.observe).toBeUndefined();
    const project = catalog.projects.find((p) => p.id === agent.projectId);
    const profile = toProfile(agent, project);
    expect(profile.classification).toBe("A");
    expect(profile.governance.autonomy).toBe(1);
    const state = operationalState(profile, telemetryFor(agent, undefined, null));
    expect(OPERATIONAL_LABEL[state]).toBe("Configured, not verified");
  }
});

it("lists exactly the Gmail-to-Khaneil, Notion and web search permissions on the lead agent", () => {
  const lead = catalog.agents.find((a) => a.id === "benjaire-product-lab")!;
  expect(lead.permissions).toHaveLength(3);
  expect(lead.permissions.join(" ")).toContain("sends only to benjaireco@gmail.com");
  expect(lead.permissions.join(" ")).toContain("Notion");
});
