import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { agentJobs, SIM_DAY_SECONDS, SIM_HOUR_SECONDS } from "../../catalog/agentJobs";
import { layoutMap } from "../mapLayout";
import { agentAt, AGENT_COMMUTE, planAgentCommutes, simHour } from "./agentCommutes";
import { buildScene } from "./scene";
import { buildStreetGraph, nearestStreet, streetLines, streetRoute } from "./streetGraph";

const scene = buildScene(layoutMap(catalog, [], "district"));
const jobs = agentJobs(catalog);
const graph = buildStreetGraph(streetLines(scene));
const plan = planAgentCommutes(scene, jobs, graph);

describe("street graph", () => {
  it("joins two streets that meet in a T", () => {
    const g = buildStreetGraph([[[0, 0, 0], [10, 0, 0]], [[5, 0, 0], [5, 0, 5]]]);
    expect(streetRoute(g, [0, 0, 0], [5, 0, 5])?.map((p) => [p[0], p[2]])).toEqual([[0, 0], [5, 0], [5, 5]]);
  });
  it("joins road ends that stop just short of each other, and not ones far apart", () => {
    expect(streetRoute(buildStreetGraph([[[0, 0, 0], [5, 0, 0]], [[5.2, 0, 0], [9, 0, 0]]]), [0, 0, 0], [9, 0, 0])).toBeDefined();
    expect(streetRoute(buildStreetGraph([[[0, 0, 0], [5, 0, 0]], [[7, 0, 0], [9, 0, 0]]]), [0, 0, 0], [9, 0, 0])).toBeUndefined();
  });
  it("connects Circa to every headquarters on the map", () => {
    const circa = scene.financial!.buildings.find((b) => b.id === "circa")!;
    const door = circa.approach[circa.approach.length - 1];
    for (const t of scene.towers) expect(streetRoute(graph, [door[0], 0, door[1]], [t.x, 0, t.z + t.size / 2]), t.projectId).toBeDefined();
  });
});

describe("agent commutes", () => {
  it("gives every working agent a walk, and says why the rest have none", () => {
    expect(plan.commutes.length + plan.skipped.length).toBe(jobs.length);
    // Fixed workflows no longer receive simulated agent commutes.
    expect(plan.commutes.map(c => c.agentId)).toEqual(["repo-intelligence", "atlas-engineering-review", "atlas-production-coordinator", "atlas-release-coordinator", "site-builder", "github-profile-manager"]); // GitHub Profile Manager published 2026-11-17
    // Owning agents that work only through their automations keep their desk and are not drawn walking.
    expect(plan.skipped.filter((s) => s.reason.startsWith("works through its automations")).map((s) => s.agentId).sort()).toEqual(
      jobs.filter((j) => j.deskOnly && !j.offDuty).map((j) => j.agentId).sort(),
    );
    expect(jobs.filter((j) => j.deskOnly)).toHaveLength(10);
    // The Workday tab says workplace agents are not drawn walking; keep the two in step.
    const suites = jobs.filter((j) => j.work.kind === "workplace" && !j.offDuty).map((j) => j.agentId);
    expect(plan.commutes.filter((c) => suites.includes(c.agentId))).toEqual([]);
  });
  it("walks on the streets, between the doorways", () => {
    for (const c of plan.commutes) {
      const pts = c.route.points;
      // Only the first stretch (Circa's own approach to its sidewalk) and the last step to the door leave the street.
      for (const p of pts.slice(3, -1)) expect(nearestStreet(graph, p).d, c.agentId).toBeLessThan(1e-6);
      for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]), `${c.agentId} step ${i}`).toBeLessThan(30);
    }
  });
  it("arrives as its shift starts, leaves as it ends, and fits the day", () => {
    for (const c of plan.commutes) {
      const job = jobs.find((j) => j.agentId === c.agentId)!;
      expect(job.shift.value.start * SIM_HOUR_SECONDS - c.atWork).toBeLessThanOrEqual(0.6 * SIM_HOUR_SECONDS + 1e-9);
      expect(c.atWork - c.leaveHome).toBeLessThanOrEqual(AGENT_COMMUTE.commuteHours * SIM_HOUR_SECONDS + 1e-6);
      expect(c.leaveWork).toBeGreaterThan(c.atWork);
      expect(c.atHome - c.leaveHome).toBeLessThan(SIM_DAY_SECONDS);
    }
  });
  it("goes home, to work, and home again without jumping", () => {
    for (const c of plan.commutes) {
      const seen = new Set<string>();
      // A step is the walk plus at most the lane easing to the centre line at a corner.
      let last: { x: number; z: number } | null = null;
      for (let t = 0; t < SIM_DAY_SECONDS; t += 0.25) {
        const at = agentAt(c, t);
        seen.add(at.where);
        if (at.visible) {
          if (last) expect(Math.hypot(at.x - last.x, at.z - last.z), `${c.agentId} at ${t}`).toBeLessThan(c.pace * 0.25 + 0.12);
          last = at;
        } else last = null;
      }
      expect([...seen].sort()).toEqual(["home", "to-home", "to-work", "work"]);
    }
  });
  it("is at work in the middle of its shift and home at night", () => {
    const c = plan.commutes[0], job = jobs.find((j) => j.agentId === c.agentId)!;
    const at = (hour: number) => agentAt(c, (((hour - AGENT_COMMUTE.openHour) * SIM_HOUR_SECONDS) % SIM_DAY_SECONDS + SIM_DAY_SECONDS) % SIM_DAY_SECONDS);
    expect(at((job.shift.value.start + job.shift.value.end) / 2).where).toBe("work");
    expect(at(2).where).toBe("home");
    expect(simHour(0)).toBe(AGENT_COMMUTE.openHour);
  });
});

describe("presence schedules on the map", () => {
  const desk = jobs.find((j) => j.deskOnly && !j.offDuty)!;
  const schedule = { home: "residence", work: scene.towers[0].projectId, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timeZone: "America/New_York" };
  const scheduled = agentJobs(catalog, { [desk.agentId]: schedule });
  const c = planAgentCommutes(scene, scheduled, graph).commutes.find((x) => x.agentId === desk.agentId)!;
  const at = (iso: string) => agentAt(c, 0, new Date(iso));

  it("walks a scheduled agent from its chosen home on the real clock, whatever the map's own clock says", () => {
    const home = scene.financial!.buildings.find((b) => b.id === "residence")!.approach[0];
    expect(c.route.points[0]).toEqual([home[0], 0, home[1]]);
    expect(at("2026-11-16T13:30:00Z").visible).toBe(false); // 08:30 at home
    const walking = at("2026-11-16T13:50:00Z"); // 08:50 halfway to work
    expect(walking).toMatchObject({ where: "to-work", visible: true });
    expect(agentAt(c, 999, new Date("2026-11-16T13:50:00Z"))).toEqual(walking);
    expect(at("2026-11-16T18:00:00Z")).toEqual({ where: "work", visible: false });
    expect(at("2026-11-16T22:30:00Z")).toMatchObject({ where: "outdoors", visible: true });
  });

  it("skips, with a reason, a schedule whose home is not on the map", () => {
    const lost = planAgentCommutes(scene, agentJobs(catalog, { [desk.agentId]: { ...schedule, home: "demolished" } }), graph);
    expect(lost.skipped.find((s) => s.agentId === desk.agentId)?.reason).toBe("demolished is not on this map layout");
  });
});
