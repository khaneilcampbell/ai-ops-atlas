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
const poseAt = (r: Routine, id: string, i: number, t: number, open: ReadonlyMap<string, number> = new Map()): DrawnPose | null => {
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

  it("walks in, sits at its own desk and types while a run works, on its floor in the open building", () => {
    expect(withDesk.length).toBeGreaterThanOrEqual(10);
    for (const a of withDesk) {
      const i = named.agents.indexOf(a), desk = places.agents.get(a.personaId)!.desk!;
      const r = planRoutine({ personaId: a.personaId, ops: running(a.personaId, NOW - 10 * MIN), env: routineEnv(routes, a.personaId, () => NOW)!, now: NOW });
      const work = r.segments.find((s) => s.kind === "inside" && s.phase === "working")!;
      expect(work, a.personaId).toBeTruthy();
      const t = (work.t0 + Math.min(work.t1, NOW + 30 * MIN)) / 2;
      const seated = poseAt(r, a.personaId, i, t, new Map([[desk.towerKey, desk.level]]))!;
      expect(seated).toMatchObject({ figure: true, sit: 1, typing: true, officeScale: null, inside: { key: desk.towerKey, level: desk.level, seated: true } });
      expect(Math.hypot(seated.x - desk.x, seated.z - desk.z)).toBeLessThan(1e-6);
      // Hips on the chair: the same figure scale as in the street, sitting just above its floor.
      expect(seated.y).toBeGreaterThan(desk.y - 0.02);
      expect(seated.y).toBeLessThan(desk.y + 0.05);
      // Building closed: the figure stays at its desk behind the walls, the badge shows on the street façade at its floor.
      const closed = poseAt(r, a.personaId, i, t)!;
      expect(closed.figure, a.personaId).toBe(true);
      expect(closed.badge![1]).toBeGreaterThan(desk.y);
      expect(closed.badge![1]).toBeLessThan(desk.y + desk.building.floorH);
      expect(closed.badge![2]).toBeGreaterThanOrEqual(desk.building.z + desk.building.size / 2);
      // Another floor open below its own: not drawn floating over the cut.
      const below = poseAt(r, a.personaId, i, t, new Map([[desk.towerKey, 0]]))!;
      expect(below.figure).toBe(false);
      // The walk to the desk ends in the chair.
      const toDesk = r.segments.find((s) => s.kind === "inside" && s.phase === "to_desk")!;
      const end = poseAt(r, a.personaId, i, toDesk.t1 - 1, new Map([[desk.towerKey, desk.level]]))!;
      expect(Math.hypot(end.x - desk.x, end.z - desk.z)).toBeLessThan(0.05);
    }
  });

  it("goes from the sidewalk to the chair and back out without a jump, at one scale", () => {
    for (const a of withDesk) {
      const i = named.agents.indexOf(a), desk = places.agents.get(a.personaId)!.desk!;
      // A run that finished, so the visit has every phase: in, working, completed, leaving, and out.
      const start = NOW - 20 * MIN;
      const run: OpRun = { key: `n8n:t:${a.personaId}`, workflowKey: "n8n:t", workflowName: "T", agentId: a.personaId, source: "n8n", status: "succeeded", startedAt: start, stoppedAt: NOW - 18 * MIN, seenAt: start, statusSeenAt: NOW - 18 * MIN, mode: "webhook", retry: false, url: null, title: "T" };
      const ops = { ...quiet(a.personaId), runs: [run], open: [], lastResult: run, state: "succeeded" as const };
      const r = planRoutine({ personaId: a.personaId, ops, env: routineEnv(routes, a.personaId, () => NOW)!, now: NOW });
      const ins = r.segments.filter((s) => s.kind === "inside");
      if (!ins.length) continue;
      const t0 = ins[0].t0 - 3000, t1 = ins[ins.length - 1].t1 + 3000;
      const open = new Map([[desk.towerKey, desk.level]]);
      let prev: DrawnPose | null = null;
      const floors = new Set<number | null>();
      for (let t = t0; t <= t1; t += 100) {
        const p = poseAt(r, a.personaId, i, t, open);
        expect(p, `${a.personaId} at ${t - t0}`).toBeTruthy();
        expect(p!.officeScale).toBeNull();
        if (prev) expect(Math.hypot(p!.x - prev.x, p!.y - prev.y, p!.z - prev.z), `${a.personaId} jumped at ${t - t0} ms (${p!.place})`).toBeLessThan(0.2);
        if (p!.inside) floors.add(p!.inside.level);
        prev = p;
      }
      // Through the lobby and up to its own floor.
      expect(floors.has(0), a.personaId).toBe(true);
      expect(floors.has(desk.level), a.personaId).toBe(true);
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
