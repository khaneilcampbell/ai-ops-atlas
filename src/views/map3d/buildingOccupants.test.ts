import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { AGENT_RESIDENCE, agentJobs } from "../../catalog/agentJobs";
import { WORKSPACE } from "../../modules/workspace";
import { buildingOccupants, occupantCount } from "./buildingOccupants";
import { financialKey } from "./financialPlan";
import { AGENCY_KEY } from "./marketingAgencyPlan";

describe("building occupants", () => {
  const jobs = agentJobs(catalog);
  const occ = buildingOccupants(catalog.agents, jobs);
  const residence = occ.get(financialKey(AGENT_RESIDENCE.id))!;

  it("shows every named agent with an apartment in Team Residence Towers, once each", () => {
    const named = jobs.filter((j) => !j.offDuty && catalog.agents.find((a) => a.id === j.agentId)?.registry?.identity);
    expect(named.length).toBe(17);
    const faces = residence.lives.people.map((p) => p.personaId).sort();
    expect(faces).toEqual(named.map((j) => j.agentId).sort());
    expect(new Set(faces).size).toBe(faces.length);
    // Helpers who live there under a lead's face are counted, not shown as that lead.
    const living = jobs.filter((j) => !j.offDuty && j.home.building === AGENT_RESIDENCE.id).length;
    expect(residence.lives.people.length + residence.lives.others).toBe(living);
  });

  it("puts each working AI agent's face at its workplace, keyed like the map's nameplates", () => {
    for (const j of jobs.filter((j) => !j.offDuty && j.work.kind === "headquarters")) {
      const at = occ.get(`project:${j.work.projectId}`);
      expect(at, j.agentId).toBeDefined();
      expect(occupantCount(at)).toBeGreaterThan(0);
    }
    // The Marketing Agency's declared workplace agents appear on its landmark nameplate.
    const agency = occ.get(AGENCY_KEY);
    if (jobs.some((j) => !j.offDuty && j.work.building === "Benjaire Marketing Agency")) expect(occupantCount(agency)).toBeGreaterThan(0);
  });

  it("lists the agents a landmark names in workspace.yaml as working there", () => {
    for (const l of WORKSPACE.landmarks.filter((l) => l.agents?.length)) expect(occupantCount(occ.get(`service:${l.id}`)), l.id).toBeGreaterThan(0);
  });

  it("never lists retired or off-duty agents, and never repeats a face in a row", () => {
    for (const o of occ.values()) {
      for (const g of [o.works, o.lives]) {
        expect(g.people.every((p) => !p.identity.retired)).toBe(true);
        expect(new Set(g.people.map((p) => p.personaId)).size).toBe(g.people.length);
      }
    }
    const offDuty = new Set(jobs.filter((j) => j.offDuty).map((j) => j.agentId));
    for (const o of occ.values()) for (const p of o.lives.people) expect(offDuty.has(p.identity.agentId)).toBe(false);
  });
});
