import type { AgentJob } from "../../catalog/agentJobs";
import { AGENT_RESIDENCE } from "../../catalog/agentJobs";
import { activityText, isNight, segmentAt, type Routine } from "../../routine/routine";
import { circaLevelKind, type CircaTower } from "./circaFloors";
import { LOBBY_STOPS, POOL_STOPS, circaLift, circaPath, podiumLift, unitStops, LIFT_CAR, LIFT_STOP, WALK } from "./circaNav";
import { DayBuilder, liftCycle, rotate, type Day, type Stop } from "./walkNav";

/**
 * Who is home in Ellipse Residences, and what they do there (Khaneil, 2026-11-19: "atlas agents not showing inside
 * the residence, remove these loops and follow agents data about their residence to create loops").
 *
 * Each resident is an AI agent whose home card (agentJobs.ts) names this building. It lives in the apartment the card
 * names, and is drawn inside only while its own day (the routine the city walks, routine.ts) has it at home: in the
 * evening and at night, and on free time it spends at home. While it is out, its apartment says where it is instead.
 * At home its loop is built from its own apartment: its rooms in turn, plus one trip by its tower's lift to the pool
 * deck or the lobby. At night it is in its bedroom. Placement is a visualization, not live activity.
 */

export interface CircaHome {
  level: number;
  tower: CircaTower;
  unit: string;
  layout: "01" | "02" | "03";
}

export interface CircaResident {
  id: string;
  name: string;
  home: CircaHome;
}

/** The apartment a unit number names ("304" is Floor 3, East tower, the 2 bed); null for a unit not drawn inside. */
export function circaHome(unit: string): CircaHome | null {
  const m = /^(\d)0([1-6])$/.exec(unit);
  if (!m) return null;
  const floor = Number(m[1]), k = Number(m[2]);
  if (!(AGENT_RESIDENCE.floors as readonly number[]).includes(floor)) return null;
  const tower: CircaTower = k <= AGENT_RESIDENCE.unitsPerTower ? "west" : "east";
  const layout = `0${((k - 1) % AGENT_RESIDENCE.unitsPerTower) + 1}` as CircaHome["layout"];
  return { level: floor - 1, tower, unit, layout };
}

/** The agents who live here, each in the apartment its home card names. Agents housed elsewhere aren't residents. */
export function circaResidents(jobs: readonly AgentJob[], named: (id: string) => boolean = () => true): CircaResident[] {
  const out: CircaResident[] = [];
  for (const j of jobs) {
    if (j.home.building !== AGENT_RESIDENCE.id || !named(j.agentId)) continue;
    const home = circaHome(j.home.unit);
    if (home) out.push({ id: j.agentId, name: j.title, home });
  }
  return out;
}

/** Home or out, by the agent's own day. */
export type HomeState = { home: true; night: boolean; note: string } | { home: false; note: string };

/**
 * Whether the agent is home at `now`, from the same day the city map draws: home when its day has it staying at its
 * own home spot. With no day worked out yet (the map hasn't planned one), the routine's own rule: home at night.
 */
export function homeStateAt(id: string, routine: Routine | undefined, now: number, tz: string): HomeState {
  const night = isNight(now, tz);
  if (routine) {
    const seg = segmentAt(routine, now);
    if (seg && seg.kind === "stay" && seg.at === `home:${id}`) return { home: true, night: night && seg.activity === "at_home" && /night/i.test(seg.note), note: seg.note };
    if (seg) return { home: false, note: activityText(seg) };
  }
  return night ? { home: true, night: true, note: "At home for the night" } : { home: false, note: "Out for the day" };
}

const linger = (s: Stop) => (s.id === "living" || s.id === "bedroom" || s.id === "master" ? 9 : s.id === "door" ? 0.8 : WALK.dwell + 1.5);

/** Its bedroom: the main bedroom in a 2 bed. */
export const bedroomOf = (home: CircaHome): Stop => unitStops(home.layout).find((s) => s.id === (home.layout === "01" ? "master" : "bedroom"))!;
export const livingOf = (home: CircaHome): Stop => unitStops(home.layout).find((s) => s.id === "living")!;

/**
 * An evening at home, as a loop on the lifts' clock: it starts and ends in its living room, walks through its own
 * rooms, and goes once by its tower's lift to the pool deck or the lobby (which one, and which rooms first, follow
 * from its id). The loop is a whole number of lift cycles, so its rides stay in step with the doors every time round.
 */
export function homeLoop(r: CircaResident, start = 0): Day {
  const { home } = r, seed = [...r.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const apartments = (l: number) => circaLevelKind(l) === "apartments";
  const world = {
    path: (l: number, a: Stop, b: Stop) => circaPath(circaLevelKind(l), a, b),
    lift: circaLift(home.tower),
    landing: (l: number) => (apartments(l) ? { stop: LIFT_STOP, car: LIFT_CAR } : podiumLift(home.tower)),
    frame: (l: number) => (apartments(l) ? home.tower : undefined),
  };
  const plan = unitStops(home.layout), living = livingOf(home), door = plan[0];
  const rooms = rotate(plan.filter((s) => s.id !== "door" && s.id !== "living"), seed % plan.length);
  const half = Math.ceil(rooms.length / 2);
  const outing = seed % 2 ? { level: 1, stops: rotate(POOL_STOPS, seed % POOL_STOPS.length).slice(0, 2) } : { level: 0, stops: rotate(LOBBY_STOPS.filter((s) => s.id !== "entrance"), seed % 7).slice(0, 2) };
  const day = new DayBuilder(world, start, home.level, living);
  day.stay(linger(living)).visit([...rooms.slice(0, half), living], linger);
  day.visit([door], linger).ride(outing.level).visit(outing.stops, linger).ride(home.level).visit([door, ...rooms.slice(half), living], linger);
  // Settle in the living room until the next whole lift cycle, so the loop joins up where it began.
  const cycle = liftCycle(world.lift), period = Math.ceil((day.t - start + 1) / cycle) * cycle;
  day.stay(start + period - day.t, living);
  return { legs: day.legs, start, period };
}

/** Night: mostly in its bedroom, up now and then to its bathroom and kitchen, never leaving its apartment. */
export function nightLoop(r: CircaResident, start = 0): Day {
  const { home } = r, plan = unitStops(home.layout), bed = bedroomOf(home);
  const bath = plan.find((s) => s.id === (home.layout === "01" ? "master-bath" : "bath"))!, kitchen = plan.find((s) => s.id === "kitchen")!;
  const world = { path: (_l: number, a: Stop, b: Stop) => circaPath("apartments", a, b), lift: circaLift(home.tower), landing: () => ({ stop: LIFT_STOP, car: LIFT_CAR }), frame: () => home.tower };
  const day = new DayBuilder(world, start, home.level, bed);
  day.stay(30).visit([bath], () => 4).visit([bed], () => 24).visit([kitchen], () => 5).visit([bed], () => 6);
  return { legs: day.legs, start, period: day.t - start };
}
