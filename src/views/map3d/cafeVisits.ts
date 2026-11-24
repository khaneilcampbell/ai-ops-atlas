import { useSyncExternalStore } from "react";
import { rand, type Routine, type Segment } from "../../routine/routine";
import type { Pt3 } from "./roads";
import { CAFE, type CafePlan, type CafeSeat, type SeatArea } from "./cafePlan";

/**
 * Visits to the Community Pavilion & Café (cafePlan.ts), worked out from every agent's routine at once
 * (routine/routine.ts plans each agent's day on its own; this is the one place that sees them all).
 *
 * A visit is the routine's café stay: in through the door, a short stop at the counter, a seat, then back
 * out. Seats and counter places are handed out first come, first served (by arrival, then by name), and a
 * seat stays reserved for the whole visit, so no two agents are ever given the same chair, and nobody
 * stands in the doorway: every standing and seated place is off the walk in. With more seats than
 * agents a seat is always free; if one ever weren't, that agent would take its drink standing at the
 * counter instead.
 *
 * Pure and deterministic, like the routine: the same routines always give the same seats. Visits are a
 * picture of free time only. No order, payment, message or request of any kind exists for them.
 */
export interface CafeVisit {
  personaId: string;
  t0: number;
  t1: number;
  /** Index into plan.seats, or null when every seat was taken (stands at the counter for the visit). */
  seat: number | null;
  /** 0..2: at the counter; 3..5: in line behind it; -1: waiting just inside the door. */
  counter: number;
  /** Seconds at the counter before taking the seat. */
  hold: number;
}

/** Walking pace (routinePlaces.ts PACE). */
const PACE = 0.45;
const S = 1000;
const len = (p: readonly Pt3[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1], q[2] - p[i][2]), 0);

/** The café stays in a routine. */
export function cafeStays(r: Routine): Extract<Segment, { kind: "stay" }>[] {
  return r.segments.filter((s): s is Extract<Segment, { kind: "stay" }> => s.kind === "stay" && s.option?.kind === "cafe");
}

/** Where the agent stands at the counter (or in line, or just inside the door). */
export function counterPoint(plan: CafePlan, counter: number): Pt3 {
  const F = CAFE.floor;
  if (counter >= 0 && counter < 3) return [plan.counterSpots[counter].x, F, plan.counterSpots[counter].z];
  if (counter >= 3 && counter < 6) return [plan.counterSpots[counter - 3].queue[0], F, plan.counterSpots[counter - 3].queue[1]];
  return [plan.lobby[0] + 0.12, F, plan.lobby[2] - 0.12];
}

/** The walk from the counter to a seat: straight across the room indoors, back out through the door for the terrace and benches. */
export function seatPath(plan: CafePlan, seat: CafeSeat, from: Pt3): Pt3[] {
  return seat.area === "indoor" ? [from, ...seat.route.slice(1)] : [from, plan.lobby, ...seat.route.slice(1)];
}

/** Seconds from the lobby to the counter place, the hold, the walk to the seat and back out. */
function timings(plan: CafePlan, v: Pick<CafeVisit, "counter" | "seat" | "hold">) {
  const at = counterPoint(plan, v.counter);
  const enter = len([plan.lobby, at]) / PACE;
  const seat = v.seat === null ? null : plan.seats[v.seat];
  const toSeat = seat ? len(seatPath(plan, seat, at)) / PACE : 0;
  const out = seat ? len(seat.route) / PACE : enter;
  return { at, enter, toSeat, out, seat };
}

/**
 * Seats and counter places for every café visit in these routines. Visits are taken in order of arrival
 * (then name): each gets the first free counter place, and the first free seat in its own seeded order of
 * preference, so agents spread over the room and terrace instead of all taking seat one.
 */
export function cafeVisits(routines: ReadonlyMap<string, Routine>, plan: CafePlan): Map<string, CafeVisit[]> {
  const all = [...routines.entries()].flatMap(([id, r]) => cafeStays(r).map((s) => ({ id, t0: s.t0, t1: s.t1 })));
  all.sort((a, b) => a.t0 - b.t0 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seatFree = plan.seats.map(() => -Infinity);
  const counterFree = [0, 1, 2, 3, 4, 5].map(() => -Infinity);
  const out = new Map<string, CafeVisit[]>();
  for (const v of all) {
    const order = plan.seats.map((_, i) => i).sort((a, b) => rand(`${v.id}:${v.t0}:seat:${a}`) - rand(`${v.id}:${v.t0}:seat:${b}`));
    const seat = order.find((i) => seatFree[i] <= v.t0) ?? null;
    if (seat !== null) seatFree[seat] = v.t1;
    const hold = CAFE.counterHold[0] + rand(`${v.id}:${v.t0}:hold`) * (CAFE.counterHold[1] - CAFE.counterHold[0]);
    const counter = counterFree.findIndex((t) => t <= v.t0);
    const visit: CafeVisit = { personaId: v.id, t0: v.t0, t1: v.t1, seat, counter, hold };
    if (counter >= 0) {
      const t = timings(plan, visit);
      // Held while it walks up, waits and steps away; for the whole visit when it has no seat.
      counterFree[counter] = seat === null ? v.t1 : Math.min(v.t1, v.t0 + (t.enter + hold + 2) * S);
    }
    out.set(v.id, [...(out.get(v.id) ?? []), visit]);
  }
  return out;
}

export type CafePhase = "arriving" | "counter" | "to_seat" | "seated" | "leaving";
export const CAFE_PHASE_LABEL: Record<CafePhase, string> = { arriving: "Arriving", counter: "At the counter", to_seat: "Taking a seat", seated: "Seated", leaving: "Leaving" };
export interface CafeMoment {
  phase: CafePhase;
  x: number;
  y: number;
  z: number;
  yaw: number;
  walking: boolean;
  /** Seated: the seat surface (world height). The pose puts the hips on it. */
  seatY: number | null;
  /** "Terrace table 2", "At the counter". */
  where: string;
}

function along(path: readonly Pt3[], share: number): { x: number; y: number; z: number; yaw: number } {
  const legs = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1], p[2] - path[i][2]));
  const total = legs.reduce((a, b) => a + b, 0);
  let left = Math.max(0, Math.min(1, share)) * total, yaw = 0;
  for (let i = 0; i < legs.length; i++) {
    const a = path[i], b = path[i + 1];
    if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 1e-6) yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
    if (left <= legs[i] || i === legs.length - 1) {
      const t = legs[i] > 0 ? Math.min(1, left / legs[i]) : 1;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, yaw };
    }
    left -= legs[i];
  }
  const p = path[path.length - 1];
  return { x: p[0], y: p[1], z: p[2], yaw };
}

/**
 * Where a visiting agent is at `wall`: walking in from the door to the counter, standing at it, walking
 * to its seat, seated, or walking back to the door at the end. A visit cut short by work (the routine ends
 * the stay early, with time to get out) shortens the seated part; one too short for a seat stops at the
 * counter and goes.
 */
export function cafeMoment(plan: CafePlan, v: CafeVisit, wall: number): CafeMoment {
  const t = timings(plan, v);
  const T = (v.t1 - v.t0) / S, u = (wall - v.t0) / S;
  const walk = (path: Pt3[], share: number, phase: CafePhase, where: string): CafeMoment => {
    const q = along(path, share);
    return { phase, ...q, walking: share > 0 && share < 1, seatY: null, where };
  };
  const counterYaw = v.counter >= 0 && v.counter < 6 ? Math.PI : Math.PI / 2;
  const stand = (phase: CafePhase, where: string): CafeMoment => ({ phase, x: t.at[0], y: t.at[1], z: t.at[2], yaw: counterYaw, walking: false, seatY: null, where });
  const counterWhere = v.counter >= 3 ? "In line at the counter" : "At the counter";
  const seated = t.seat && T >= t.enter + v.hold + t.toSeat + 20 + t.out;
  if (!seated) {
    // Counter only: in, a drink standing, back out (the whole visit, when every seat was taken).
    const back = t.enter;
    if (u < t.enter) return walk([plan.lobby, t.at], u / t.enter, "arriving", "Arriving");
    if (u < T - back) return stand("counter", t.seat === null ? "Standing at the counter (every seat taken)" : counterWhere);
    return walk([t.at, plan.lobby], (u - (T - back)) / back, "leaving", "Leaving");
  }
  const seat = t.seat!;
  const path = seatPath(plan, seat, t.at);
  if (u < t.enter) return walk([plan.lobby, t.at], u / t.enter, "arriving", "Arriving");
  if (u < t.enter + v.hold) return stand("counter", counterWhere);
  if (u < t.enter + v.hold + t.toSeat) return walk(path, (u - t.enter - v.hold) / t.toSeat, "to_seat", seat.label);
  if (u < T - t.out) return { phase: "seated", x: seat.x, y: seat.y, z: seat.z, yaw: seat.yaw, walking: false, seatY: seat.y, where: seat.label };
  return walk([...seat.route].reverse(), (u - (T - t.out)) / t.out, "leaving", "Leaving");
}

/** Who is at the café now and which seats are free, from the same visits the map draws. */
export interface CafeNow {
  visitors: { personaId: string; phase: CafePhase; where: string; until: number }[];
  /** Seats free now (not reserved by a visit in progress), by area, and the totals. */
  free: Record<SeatArea, number>;
  total: Record<SeatArea, number>;
  /** Agents on their way there now (walking to the café). */
  arriving: string[];
}
export function cafeNow(routines: ReadonlyMap<string, Routine>, plan: CafePlan, now: number): CafeNow {
  const visits = cafeVisits(routines, plan);
  const total: Record<SeatArea, number> = { indoor: 0, terrace: 0, bench: 0 };
  for (const s of plan.seats) total[s.area]++;
  const free = { ...total };
  const visitors: CafeNow["visitors"] = [];
  for (const list of visits.values())
    for (const v of list) {
      if (now < v.t0 || now >= v.t1) continue;
      const m = cafeMoment(plan, v, now);
      visitors.push({ personaId: v.personaId, phase: m.phase, where: m.where, until: v.t1 });
      if (v.seat !== null) free[plan.seats[v.seat].area]--;
    }
  const arriving: string[] = [];
  for (const [id, r] of routines) {
    const seg = r.segments.find((s) => s.t0 <= now && now < s.t1);
    if (seg?.kind === "walk" && seg.to === "cafe") arriving.push(id);
  }
  visitors.sort((a, b) => (a.personaId < b.personaId ? -1 : 1));
  return { visitors, free, total, arriving };
}

// ------------------------------------------------------------------------------------- the plan, for panels

let planNow: CafePlan | null = null;
const watchers = new Set<() => void>();
/** The map publishes the café it draws, so its panel (outside the 3D canvas) can count seats. */
export function publishCafePlan(p: CafePlan | null) {
  if (planNow === p) return;
  planNow = p;
  watchers.forEach((w) => w());
}
export function useCafePlan(): CafePlan | null {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => planNow,
    () => planNow,
  );
}
