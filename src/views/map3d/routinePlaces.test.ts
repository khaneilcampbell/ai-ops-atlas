import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { agentJobs } from "../../catalog/agentJobs";
import { agentOps } from "../../routine/operations";
import { planRoutine, segmentAt } from "../../routine/routine";
import { layoutMap } from "../mapLayout";
import { planAgentCommutes } from "./agentCommutes";
import { planNamedAgents } from "./namedAgentPlan";
import { cabinAngle, cabinAtBottom, CityRoutes, planCityPlaces, riderPoint, routineEnv, WHEEL_TURN_MS } from "./routinePlaces";
import { buildScene } from "./scene";

const scene = buildScene(layoutMap(catalog));
const jobs = agentJobs(catalog);
const named = planNamedAgents(scene, catalog.agents, jobs, planAgentCommutes(scene, jobs));
const places = planCityPlaces(scene, named.agents, jobs, catalog.projects, catalog.agents);
const routes = new CityRoutes(places);
const NOW = Date.parse("2026-11-18T19:00:00Z");

describe("city places for the routine", () => {
  it("gives every named agent a home, an office and, in a headquarters, its own desk", () => {
    expect(places.agents.size).toBe(named.agents.length);
    const seats = new Set<string>();
    for (const a of named.agents) {
      const p = places.agents.get(a.personaId)!;
      expect(p.home.path.length, a.personaId).toBeGreaterThan(0);
      expect(p.office.path.length, a.personaId).toBeGreaterThan(0);
      const job = jobs.find((j) => j.agentId === a.personaId)!;
      if (job.work.kind === "headquarters" && p.desk) {
        const key = `${p.desk.x.toFixed(3)},${p.desk.z.toFixed(3)}`;
        expect(seats.has(key), `${a.personaId} shares a seat`).toBe(false);
        seats.add(key);
      }
    }
    // Most headquarters agents have a desk in the Inside view's office plan.
    expect(seats.size).toBeGreaterThanOrEqual(10);
  });

  it("offers every listed outing that this layout has", () => {
    const kinds = new Set(places.leisure.map((o) => o.kind));
    for (const k of ["park", "district", "wheel", "train", "flight", "arena"] as const) expect(kinds.has(k), k).toBe(true);
  });

  it("walks home to office on the streets for every agent", () => {
    for (const a of named.agents) {
      const p = places.agents.get(a.personaId)!;
      const secs = routes.travel({ spot: p.home.id }, p.office.id);
      expect(Number.isFinite(secs), a.personaId).toBe(true);
      expect(secs, a.personaId).toBeLessThan(15 * 60);
      expect(secs, a.personaId).toBeGreaterThan(5);
    }
  });

  it("reaches every outing from an office", () => {
    const office = places.agents.get(named.agents[0].personaId)!.office.id;
    for (const o of places.leisure) expect(Number.isFinite(routes.travel({ spot: office }, o.spot)), o.id).toBe(true);
  });

  it("boards a wheel cabin at the bottom and gets off a full turn later", () => {
    const t = cabinAtBottom(3, NOW);
    expect(t).toBeGreaterThanOrEqual(NOW);
    expect(Math.sin(cabinAngle(3, t))).toBeCloseTo(-1, 5);
    const env = routineEnv(routes, named.agents[0].personaId, () => NOW)!;
    const wheel = places.leisure.find((o) => o.kind === "wheel")!;
    const r = env.ride(wheel, NOW, named.agents[0].personaId)!;
    expect(r.alight - r.board).toBeCloseTo(WHEEL_TURN_MS, 0);
    // Never off mid-turn when work calls.
    expect(env.rideExit(wheel, r, r.board + 1000)).toBe(r.alight);
    const at = riderPoint(places, "wheel", named.agents[0].personaId, r.board)!;
    expect(at[1]).toBeLessThan(places.wheel!.hubY - places.wheel!.radius + 0.01);
  });

  it("plans a full day for every agent without gaps or impossible positions", () => {
    for (const a of named.agents) {
      const env = routineEnv(routes, a.personaId, () => NOW)!;
      const ops = agentOps(a.personaId, { agents: catalog.agents, n8n: null, repos: {}, tasks: [], seen: new Map(), personaOf: (id) => id, now: NOW });
      const r = planRoutine({ personaId: a.personaId, ops, env, now: NOW });
      expect(segmentAt(r, NOW), a.personaId).not.toBeNull();
      for (let i = 1; i < r.segments.length; i++) expect(r.segments[i].t0, `${a.personaId} #${i}`).toBeCloseTo(r.segments[i - 1].t1, -1);
      for (const s of r.segments) {
        if (s.kind !== "walk") continue;
        const p = routes.point({ from: s.from, to: s.to, f: 0.5 });
        expect(p && p.every(Number.isFinite), `${a.personaId} ${s.note}`).toBe(true);
      }
    }
  });
});
