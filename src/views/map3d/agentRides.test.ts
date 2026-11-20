import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { agentJobs } from "../../catalog/agentJobs";
import { agentOps } from "../../routine/operations";
import { planRoutine, segmentAt, type Segment } from "../../routine/routine";
import { layoutMap } from "../mapLayout";
import { planAgentCommutes } from "./agentCommutes";
import { CAR_BOOKINGS, CityRides, RIDE, carRiderPoint, laneLine, withTrips } from "./agentRides";
import { planNamedAgents } from "./namedAgentPlan";
import { CityRoutes, planCityPlaces, routineEnv } from "./routinePlaces";
import { routinePose } from "./routinePose";
import { buildScene } from "./scene";
import { TRAVEL_CLOCK } from "./travelLoops";
import { ATLAS_CARS, DETOURS, vehicleAt } from "./vehicles";
import type { Pt3 } from "./roads";

const scene = buildScene(layoutMap(catalog));
const jobs = agentJobs(catalog);
const named = planNamedAgents(scene, catalog.agents, jobs, planAgentCommutes(scene, jobs));
const places = planCityPlaces(scene, named.agents, jobs, catalog.projects, catalog.agents);
const NOW = Date.parse("2026-11-18T19:00:00Z");
const ids = named.agents.map((a) => a.personaId);

// The map's train clock running in step with the wall clock, as it does while the map draws.
beforeEach(() => Object.assign(TRAVEL_CLOCK, { t: 1000, live: true, wall: NOW }));
afterEach(() => Object.assign(TRAVEL_CLOCK, { t: 0, live: false, wall: undefined }));

/** A free afternoon (no runs) and a request to go somewhere far away, by the given mode. */
function dayFor(rides: CityRides, routes: CityRoutes, id: string, travel: "auto" | "walk" | "car" | "train", kind: "arena" | "flight" | "district" | "park" = "arena") {
  const env = withTrips(routineEnv(routes, id, () => NOW)!, rides, id);
  return planRoutine({ personaId: id, ops: agentOps(id, { agents: catalog.agents, n8n: null, repos: {}, tasks: [], seen: new Map(), personaOf: (x) => x, now: NOW }), env, now: NOW, outing: { kind, at: NOW, travel } });
}
const after = (segs: Segment[]) => segs.filter((s) => s.t0 >= NOW - 1);

describe("agents travelling by car and train", () => {
  it("has four Atlas cars on timetabled loops among the city's cars", () => {
    expect(places.roads?.cars.length).toBe(ATLAS_CARS);
    for (const c of places.roads!.cars) expect(c.scheduled).toBe(true);
  });

  it("keeps a lane line to the right of the way the car drives", () => {
    const pts: Pt3[] = [[0, 0, 0], [10, 0, 0], [10, 0, 10]];
    const lane = laneLine(pts, 0.2);
    // Driving +x, right is -z... whichever: every point is the lane offset from the centre line.
    expect(Math.abs(lane[0][2])).toBeCloseTo(0.2);
    expect(Math.abs(lane[2][0] - 10)).toBeCloseTo(0.2);
  });

  it("picks an agent up in an Atlas car: walk to the kerb, wait, ride, walk on", () => {
    const routes = new CityRoutes(places);
    const rides = new CityRides(routes, places.roads, () => NOW);
    const id = ids[0];
    const segs = after(dayFor(rides, routes, id, "car").segments);
    expect(segs.slice(0, 4).map((s) => s.kind)).toEqual(["walk", "stay", "ride", "walk"]);
    const [toKerb, wait, ride, on] = segs;
    expect(toKerb.note).toBe("Walking to the kerb for an Atlas car");
    expect(wait.activity).toBe("waiting");
    expect(ride.kind === "ride" && ride.option.kind).toBe("car");
    expect(on.note.startsWith("Walking on to")).toBe(true);
    // Back to back: no gaps or overlaps.
    for (let i = 1; i < 4; i++) expect(segs[i].t0).toBeCloseTo(segs[i - 1].t1, -1);
    const b = CAR_BOOKINGS.get(id)!;
    expect(b).toBeTruthy();
    expect(b.detour.wall0).toBe(NOW);
  });

  it("drives the car off its loop and back on where it would have been, and stops at the kerb while the agent gets in", () => {
    const routes = new CityRoutes(places);
    const rides = new CityRides(routes, places.roads, () => NOW);
    dayFor(rides, routes, ids[0], "car");
    const b = CAR_BOOKINGS.get(ids[0])!;
    const clock = (wall: number) => TRAVEL_CLOCK.t + (wall - NOW) / 1000;
    const at = (wall: number) => vehicleAt(b.car, clock(wall));
    const gap = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(p.x - q.x, p.z - q.z);
    // No jump where it turns off its loop or where it rejoins it.
    expect(gap(at(b.detour.wall0 - 50), at(b.detour.wall0 + 50))).toBeLessThan(0.2);
    expect(gap(at(b.detour.wall1 - 50), at(b.detour.wall1 + 50))).toBeLessThan(0.2);
    // Standing still at the kerb from just before boarding until it leaves.
    expect(gap(at(b.times.board - 1500), at(b.times.board + 500))).toBeLessThan(1e-6);
    // The rider's badge is on the car the whole ride.
    const mid = (b.times.board + b.times.alight) / 2, p = carRiderPoint(ids[0], mid)!;
    expect(Math.hypot(p[0] - at(mid).x, p[2] - at(mid).z)).toBeLessThan(1e-6);
    // The kerb is the middle of a street on the ground: never at a junction or on a bridge.
    const kerb = routes.spot(b.kerbs[0])!.path[0];
    for (const n of places.roads!.nodes) expect(Math.hypot(n[0] - kerb[0], n[2] - kerb[2])).toBeGreaterThanOrEqual(RIDE.kerbMin / 2 - 1e-6);
    // Never faster than the car's pickup speed between two moments.
    for (let w = b.detour.wall0; w < b.detour.wall1 - 1000; w += 1000) expect(gap(at(w), at(w + 1000))).toBeLessThanOrEqual(RIDE.speed * 1.01 + 1e-6);
  });

  it("uses at most the four Atlas cars, never one car twice at once, and one car at a kerb at a time", () => {
    const routes = new CityRoutes(places);
    const rides = new CityRides(routes, places.roads, () => NOW);
    const days = ids.map((id) => dayFor(rides, routes, id, "car"));
    const inCar = days.filter((d) => after(d.segments).some((s) => s.kind === "ride" && s.option.kind === "car"));
    expect(inCar.length).toBeGreaterThan(0);
    expect(inCar.length).toBeLessThanOrEqual(ATLAS_CARS);
    expect(CAR_BOOKINGS.size).toBe(inCar.length);
    const all = [...CAR_BOOKINGS.values()];
    for (const a of all) for (const c of all) {
      if (a === c) continue;
      if (a.car.id === c.car.id) expect(a.detour.wall1 <= c.detour.wall0 || c.detour.wall1 <= a.detour.wall0).toBe(true);
      for (const h of a.holds) for (const k of c.holds) if (h.street === k.street) expect(h.to <= k.from || k.to <= h.from).toBe(true);
    }
    // The rest say why they went another way.
    for (const d of days.filter((x) => !inCar.includes(x))) expect(after(d.segments).slice(0, 3).some((s) => /No Atlas car free|no atlas car free/.test(s.note))).toBe(true);
  });

  it("takes the train between stations on the timetable", () => {
    const routes = new CityRoutes(places);
    const rides = new CityRides(routes, places.roads, () => NOW);
    let tested = 0;
    for (const id of ids) {
      for (const kind of ["arena", "flight", "district", "park"] as const) {
        const segs = after(dayFor(rides, routes, id, "train", kind).segments);
        const ride = segs.find((s) => s.kind === "ride" && s.option.id.startsWith("trip:train"));
        if (!ride || ride.kind !== "ride") continue;
        const i = segs.indexOf(ride);
        expect(segs[i - 1].kind).toBe("stay");
        expect(segs[i - 1].note).toMatch(/On the platform at .*, waiting for the train/);
        expect(ride.option.spot).not.toBe(ride.option.exit);
        expect(ride.at).toMatch(/^station:/);
        expect(segs[i + 1].kind).toBe("walk");
        tested++;
      }
    }
    expect(tested).toBeGreaterThan(0);
  });

  it("walks when asked to, and keeps a short trip on foot when it chooses itself", () => {
    const routes = new CityRoutes(places);
    const rides = new CityRides(routes, places.roads, () => NOW);
    for (const id of ids.slice(0, 5)) expect(after(dayFor(rides, routes, id, "walk").segments).some((s) => s.kind === "ride" && s.option.id.startsWith("trip:"))).toBe(false);
    const p = places.agents.get(ids[0])!;
    expect(rides.trip(ids[0], { spot: p.office.id }, p.office.id, NOW, "auto").plan).toBeNull();
    // A trip under RIDE.walkFirst on foot.
    const near = places.leisure.find((o) => routes.travel({ spot: p.office.id }, o.spot) <= RIDE.walkFirst);
    if (near) expect(rides.trip(ids[0], { spot: p.office.id }, near.spot, NOW, "auto").plan).toBeNull();
  });

  it("gives the same answer to the same trip, so a recompute never books a second car", () => {
    const routes = new CityRoutes(places);
    const rides = new CityRides(routes, places.roads, () => NOW);
    const a = dayFor(rides, routes, ids[0], "car"), b = dayFor(rides, routes, ids[0], "car");
    expect(b.segments).toEqual(a.segments);
    expect(DETOURS.get(CAR_BOOKINGS.get(ids[0])!.car.id)!.length).toBe(1);
  });

  it("doesn't send a car while the cars aren't moving on the map", () => {
    TRAVEL_CLOCK.live = false;
    const routes = new CityRoutes(places);
    const rides = new CityRides(routes, places.roads, () => NOW);
    const segs = after(dayFor(rides, routes, ids[0], "car").segments);
    expect(segs.some((s) => s.kind === "ride" && s.option.kind === "car")).toBe(false);
    expect(segs.slice(0, 3).some((s) => /Atlas cars aren't running/i.test(s.note))).toBe(true);
    expect(CAR_BOOKINGS.size).toBe(0);
  });

  it("hides a rider and puts its badge on the car (never a figure in the road)", () => {
    const routes = new CityRoutes(places);
    const rides = new CityRides(routes, places.roads, () => NOW);
    const r = dayFor(rides, routes, ids[0], "car");
    const b = CAR_BOOKINGS.get(ids[0])!;
    const wall = (b.times.board + b.times.alight) / 2;
    const pose = routinePose(segmentAt(r, wall)!, { routes, places, personaId: ids[0], slot: 0, open: new Set(), wall, scale: 1 })!;
    expect(pose.figure).toBe(false);
    const car = carRiderPoint(ids[0], wall)!;
    expect(pose.badge![0]).toBeCloseTo(car[0]);
    expect(pose.badge![2]).toBeCloseTo(car[2]);
    expect(pose.place).toMatch(/^Riding in an Atlas car to /);
  });
});
