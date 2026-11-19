import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { agentJobs } from "../../catalog/agentJobs";
import { identities } from "../../registry/identity";
import { CITY_FIGURES } from "../../registry/cityFigures";
import { layoutMap } from "../mapLayout";
import { planAgentCommutes } from "./agentCommutes";
import { figureParts, partMatrix, poseBones, BONES } from "./agentFigures";
import { namedAgentAt, planNamedAgents, SPOT } from "./namedAgentPlan";
import { buildScene } from "./scene";
import * as THREE from "three";

const scene = buildScene(layoutMap(catalog));
const jobs = agentJobs(catalog);
const commutes = planAgentCommutes(scene, jobs);
const plan = planNamedAgents(scene, catalog.agents, jobs, commutes);

describe("named agents in the city", () => {
  it("places one character for each of the 17 identities and skips nobody", () => {
    expect(plan.skipped).toEqual([]);
    const ids = plan.agents.map((a) => a.personaId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(identities(catalog.agents).map((i) => i.personaId).sort());
  });

  it("never adds a character for an automation or skill: they share their persona's", () => {
    const automations = catalog.agents.filter((a) => a.ownedBy && !a.registry?.identity).map((a) => a.id);
    expect(automations.length).toBeGreaterThan(0);
    for (const id of automations) expect(plan.agents.some((a) => a.personaId === id)).toBe(false);
  });

  it("stands each agent in front of its real workplace, apart from the others", () => {
    for (const a of plan.agents) {
      const job = jobs.find((j) => j.agentId === a.personaId)!;
      expect(a.workLabel.length, a.personaId).toBeGreaterThan(0);
      expect(job.work.label.startsWith(a.workLabel), a.personaId).toBe(true);
      if (job.work.kind === "headquarters") {
        const t = scene.towers.find((x) => x.projectId === job.work.projectId)!;
        expect(Math.hypot(a.spot.x - t.x, a.spot.z - t.z), a.personaId).toBeLessThan(t.size / 2 + 2.5);
      } else {
        expect(Math.hypot(a.spot.x - scene.agency!.entry[0], a.spot.z - scene.agency!.entry[1])).toBeLessThan(1.5);
      }
    }
    for (const a of plan.agents) for (const b of plan.agents) if (a !== b) expect(Math.hypot(a.spot.x - b.spot.x, a.spot.z - b.spot.z)).toBeGreaterThan(SPOT.spacing * 0.9);
  });

  it("walks only the agents with a commute, and stands the rest at their building", () => {
    const walkers = plan.agents.filter((a) => a.commute).map((a) => a.personaId);
    expect(walkers.sort()).toEqual(commutes.commutes.map((c) => c.agentId).filter((id) => CITY_FIGURES[id]).sort());
    for (const a of plan.agents.filter((x) => !x.commute)) expect(namedAgentAt(a, 1234)).toEqual({ where: "work", ...a.spot });
    // Over a simulated day a commuter is seen walking, at work, and at home (not drawn).
    const walker = plan.agents.find((a) => a.commute)!, seen = new Set<string>();
    for (let s = 0; s < 720; s += 5) seen.add(namedAgentAt(walker, s).where);
    expect([...seen].sort()).toEqual(["home", "walking", "work"]);
  });
});

describe("figure rig", () => {
  it("builds the same parts every time, on the six bones, within a small budget", () => {
    for (const [id, f] of Object.entries(CITY_FIGURES)) {
      const parts = figureParts(f);
      expect(figureParts(f), id).toEqual(parts);
      expect(parts.length, id).toBeLessThan(48);
      for (const p of parts) expect(Object.values(BONES)).toContain(p.bone);
    }
  });

  it("draws glasses and facial hair only for the agents whose avatar has them", () => {
    const glassesParts = (id: string) => figureParts(CITY_FIGURES[id]).filter((p) => p.c === CITY_FIGURES[id].glasses).length;
    expect(glassesParts("atlas-engineering-review")).toBe(8);
    expect(figureParts(CITY_FIGURES["atlas-release-coordinator"]).some((p) => p.p[2] > 0.03 && p.bone === BONES.head && p.shape === "box")).toBe(false);
  });

  it("stands on the ground with the head on top, facing its yaw", () => {
    const bones = poseBones({ x: 2, y: 1, z: 3, yaw: 0, swing: 0, look: 0, sway: 0, scale: 1.35 }, 1, []);
    const f = CITY_FIGURES["repo-intelligence"], m = new THREE.Matrix4(), v = new THREE.Vector3();
    const ys = figureParts(f).map((p) => v.setFromMatrixPosition(partMatrix(bones, p, m)).y);
    expect(Math.min(...ys)).toBeGreaterThan(1);
    expect(Math.max(...ys)).toBeLessThan(1 + 0.3 * 1.35);
    const eye = figureParts(f).find((p) => p.bone === BONES.head && p.c === "#1d1a18")!;
    expect(v.setFromMatrixPosition(partMatrix(bones, eye, m)).z).toBeGreaterThan(3);
  });
});
