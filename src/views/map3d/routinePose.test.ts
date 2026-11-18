import { pickFloor } from "../../buildings/insideFloors";
import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { agentJobs } from "../../catalog/agentJobs";
import { agentOps, type AgentOps, type OpRun } from "../../routine/operations";
import { planRoutine, segmentAt, type Routine } from "../../routine/routine";
import { layoutMap } from "../mapLayout";
import { FIGURE_SCALE } from "./agentFigures";
import { planAgentCommutes } from "./agentCommutes";
import { planNamedAgents } from "./namedAgentPlan";
import { CityRoutes, planCityPlaces, routineEnv } from "./routinePlaces";
import { routinePose, type DrawnPose } from "./routinePose";
import { buildScene } from "./scene";

const scene = buildScene(layoutMap(catalog));
const jobs = agentJobs(catalog);
const named = planNamedAgents(scene, catalog.agents, jobs, planAgentCommutes(scene, jobs));
const places = planCityPlaces(scene, named.agents, jobs, catalog.projects, catalog.agents);
const routes = new CityRoutes(places);
const NOW = Date.parse("2026-11-18T19:00:00Z"); // 2pm in New York
const MIN = 60_000;

const quiet = (id: string): AgentOps => agentOps(id, { agents: catalog.agents, n8n: null, repos: {}, tasks: [], seen: new Map(), personaOf: (x) => x, now: NOW });
function running(id: string, startedAt: number): AgentOps {
  const run: OpRun = { key: `n8n:test:${id}`, workflowKey: "n8n:test", workflowName: "Test workflow", agentId: id, source: "n8n", status: "running", startedAt, stoppedAt: null, seenAt: startedAt, statusSeenAt: startedAt, mode: "trigger", retry: false, url: null, title: "Test workflow" };
  return { ...quiet(id), runs: [run], open: [run], state: "running" };
}
const poseAt = (r: Routine, id: string, i: number, t: number, open: ReadonlySet<string> = new Set()): DrawnPose | null => {
  const seg = segmentAt(r, t);
  return seg && routinePose(seg, { routes, places, personaId: id, slot: i, open, wall: t, scale: FIGURE_SCALE });
};
const withDesk = named.agents.filter((a) => places.agents.get(a.personaId)?.desk);

describe("drawing the routine", () => {
  it("places every agent somewhere real all day, hidden only at home", () => {
    named.agents.forEach((a, i) => {
      const r = planRoutine({ personaId: a.personaId, ops: quiet(a.personaId), env: routineEnv(routes, a.personaId, () => NOW)!, now: NOW });
      for (let t = r.segments[0].t0; t < NOW + 60 * MIN; t += 45_000) {
        const p = poseAt(r, a.personaId, i, t);
        const seg = segmentAt(r, t)!;
        if (!p?.badge) {
          expect("at" in seg ? seg.at : seg.to, `${a.personaId} hidden at ${new Date(t).toISOString()} (${seg.note})`).toBe(places.agents.get(a.personaId)!.home.id);
          continue;
        }
        expect([p.x, p.y, p.z, ...p.badge].every(Number.isFinite), `${a.personaId} ${seg.note}`).toBe(true);
      }
    });
  });

  it("walks in, sits at its own desk and types while a run works, with the office open", () => {
    expect(withDesk.length).toBeGreaterThanOrEqual(10);
    for (const a of withDesk) {
      const i = named.agents.indexOf(a), desk = places.agents.get(a.personaId)!.desk!;
      const r = planRoutine({ personaId: a.personaId, ops: running(a.personaId, NOW - 10 * MIN), env: routineEnv(routes, a.personaId, () => NOW)!, now: NOW });
      const work = r.segments.find((s) => s.kind === "inside" && s.phase === "working")!;
      expect(work, a.personaId).toBeTruthy();
      const t = (work.t0 + Math.min(work.t1, NOW + 30 * MIN)) / 2;
      // Its own floor open (buildings/insideFloors.ts): seated and typing.
      pickFloor(desk.towerKey, desk.floor);
      const seated = poseAt(r, a.personaId, i, t, new Set([desk.towerKey]))!;
      expect(seated).toMatchObject({ figure: true, sit: 1, typing: true });
      // Another floor open: it waits as a badge on the facade at its own floor, never drawn on the wrong floor.
      pickFloor(desk.towerKey, desk.floor === 1 ? 2 : desk.floor - 1);
      expect(poseAt(r, a.personaId, i, t, new Set([desk.towerKey]))!).toMatchObject({ figure: false, badge: desk.marker });
      pickFloor(desk.towerKey, desk.floor);
      expect(Math.hypot(seated.x - desk.x, seated.z - desk.z)).toBeLessThan(1e-6);
      // Office closed: no body, the badge waits above the door.
      const closed = poseAt(r, a.personaId, i, t)!;
      expect(closed.figure).toBe(false);
      expect(closed.badge).toEqual(places.agents.get(a.personaId)!.doorBadge);
      // The walk to the desk starts at the door and ends at the chair.
      const toDesk = r.segments.find((s) => s.kind === "inside" && s.phase === "to_desk")!;
      const end = poseAt(r, a.personaId, i, toDesk.t1 - 1, new Set([desk.towerKey]))!;
      expect(Math.hypot(end.x - desk.x, end.z - desk.z)).toBeLessThan(0.05);
      // It came in through the door, the lobby and the lift (buildingDefinition journeyTo).
      const enter = r.segments.find((s) => s.kind === "inside" && s.phase === "entering")!;
      const start = poseAt(r, a.personaId, i, enter.t0 + 1, new Set([desk.towerKey]))!;
      expect(Math.hypot(start.x - desk.entry[0][0], start.z - desk.entry[0][2])).toBeLessThan(0.05);
      pickFloor(desk.towerKey, null);
    }
  });

  it("never stacks two agents on one standing spot", () => {
    const rs = named.agents.map((a) => planRoutine({ personaId: a.personaId, ops: quiet(a.personaId), env: routineEnv(routes, a.personaId, () => NOW)!, now: NOW }));
    for (let t = NOW - 6 * 60 * MIN; t < NOW + 60 * MIN; t += 60_000) {
      const standing = named.agents
        .map((a, i) => ({ id: a.personaId, p: poseAt(rs[i], a.personaId, i, t), seg: segmentAt(rs[i], t) }))
        .filter((x) => x.p?.figure && !x.p.walking && x.seg?.kind === "stay");
      for (let j = 0; j < standing.length; j++)
        for (let k = j + 1; k < standing.length; k++) {
          const a = standing[j].p!, b = standing[k].p!;
          expect(Math.hypot(a.x - b.x, a.z - b.z), `${standing[j].id} and ${standing[k].id} at ${new Date(t).toISOString()}`).toBeGreaterThan(0.05);
        }
    }
  });

  it("gives archived agents no character and so no routine", () => {
    for (const a of named.agents) expect(catalog.agents.find((x) => x.id === a.personaId)?.status, a.personaId).not.toBe("retired");
    const retired = catalog.agents.filter((a) => a.status === "retired").map((a) => a.id);
    for (const id of retired) expect(places.agents.has(id), id).toBe(false);
  });

  it("plans the whole team quickly enough to redo every tick", () => {
    const t0 = performance.now();
    for (const a of named.agents) planRoutine({ personaId: a.personaId, ops: quiet(a.personaId), env: routineEnv(routes, a.personaId, () => NOW)!, now: NOW + 20_000 });
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
