import { fromZoned, parseCron, nextCron, zoned, DEFAULT_TIME_ZONE } from "./cron";
import type { AgentOps, OpRun, OwnedWorkflow } from "./operations";

/**
 * Each agent's day in the city, as a timeline of segments: free time, heading to the office,
 * entering, going to its desk, working, task completed, leaving, free time again.
 *
 * The timeline is worked out from the agent's real runs and schedules (operations.ts) and the wall
 * clock, with seeded randomness for free time. It is pure and deterministic: the same runs, ledger
 * times and clock always give the same day, so a reload, a hidden tab or a closed map picks up exactly
 * where the picture should be, without replaying a completion or restarting work.
 *
 * Movement represents the work and never drives it: nothing here can start, delay or judge a run.
 * A run that starts unexpectedly calls the agent in from wherever it is (it says the run already
 * started); a short run that finishes before the agent arrives ends the walk with "finished before
 * arrival" instead of a fake work session.
 */

/** Where the agent is, in the words the spec uses. */
export type CityActivity = "walking" | "commuting" | "at_desk" | "relaxing" | "riding" | "visiting" | "at_home";
export const ACTIVITY_LABEL: Record<CityActivity, string> = { walking: "Walking", commuting: "Commuting", at_desk: "At desk", relaxing: "Relaxing", riding: "Riding", visiting: "Visiting", at_home: "At home" };

/** The visible workday, in order. */
export type WorkPhase = "heading" | "entering" | "to_desk" | "working" | "completed" | "leaving";
export const PHASE_LABEL: Record<WorkPhase, string> = { heading: "Heading to office", entering: "Entering building", to_desk: "Going to desk", working: "Working", completed: "Task completed", leaving: "Leaving office" };

export type LeisureKind = "office" | "park" | "district" | "train" | "flight" | "yacht" | "wheel" | "arena" | "cafe" | "home";
export const LEISURE_LABEL: Record<LeisureKind, string> = { office: "Outside its own building", park: "Relaxing in the park", district: "Visiting another district", train: "Riding the train", flight: "Flying on the Atlas Gold Jet", yacht: "On a yacht ride", wheel: "Riding the Ferris wheel", arena: "At the arena", cafe: "At the Community Pavilion & Café", home: "At home" };

/** A place the agent can be: a door, a park bench, a platform. The map turns these into coordinates. */
export type SpotId = string;

/** A point on a walk: at a spot, or a share of the way along the walk between two spots. */
export type Anchor = { spot: SpotId } | { from: Anchor; to: SpotId; f: number };

export interface LeisureOption {
  id: string;
  kind: LeisureKind;
  label: string;
  /** Where the agent goes for it (the boarding point for a ride). */
  spot: SpotId;
  /** Where it comes out afterwards (a ride's exit, or the same spot). */
  exit: SpotId;
  /** How long it stays, in seconds: a ride's own length is set by the ride. */
  stay: [number, number];
  /**
   * Seconds it needs to get back out to the spot when its stay is cut short by work (from a seat inside
   * the café to its door). Without it the agent leaves from the spot at once.
   */
  leave?: number;
}

export interface RideTimes {
  /** When it gets on (after queueing for a seat), ms. */
  board: number;
  /** When it is off again at the exit, ms. */
  alight: number;
  /** Seat or cabin, for the panel ("cabin 4"). */
  seat?: string;
}

/** What the map provides: walking times between places, and ride timetables. */
export interface RoutineEnv {
  /** Walking seconds from a place to a spot; Infinity when no route. */
  travel(from: Anchor, to: SpotId): number;
  /** A ride's next boarding at or after `arrive` and when it is back at its exit. Null when it isn't running. */
  ride(option: LeisureOption, arrive: number, personaId: string): RideTimes | null;
  /** The earliest moment after `at` someone aboard can safely get off (the ride's next stop or return). */
  rideExit(option: LeisureOption, times: RideTimes, at: number): number;
  home: SpotId;
  office: SpotId;
  leisure: readonly LeisureOption[];
}

export type Segment =
  | { kind: "walk"; t0: number; t1: number; from: Anchor; to: SpotId; activity: CityActivity; phase: WorkPhase | null; note: string; option?: LeisureOption; /** A walk cut short: it covers this share of the route by t1. */ f1?: number }
  | { kind: "stay"; t0: number; t1: number; at: SpotId; activity: CityActivity; phase: WorkPhase | null; note: string; option?: LeisureOption }
  | { kind: "ride"; t0: number; t1: number; at: SpotId; activity: "riding"; phase: null; note: string; option: LeisureOption; times: RideTimes }
  | { kind: "inside"; t0: number; t1: number; at: SpotId; activity: "at_desk"; phase: WorkPhase; note: string; work: WorkRef };

/** The work a desk segment is about. */
export interface WorkRef {
  label: string;
  runs: OpRun[];
  scheduledAt: number | null;
  /** True when execution started before the agent was called (an unexpected run). */
  alreadyStarted: boolean;
  /** How it ended, once known. */
  outcome: "succeeded" | "failed" | "cancelled" | "unconfirmed" | "no_run" | "waiting" | null;
}

export interface Routine {
  personaId: string;
  segments: Segment[];
  /** Recompute after this time (ms), or when the agent's runs change. */
  validUntil: number;
  /** Work episodes considered, for the task panel. */
  episodes: Episode[];
  /** True when the routine is held (paused in Atlas or the agent can't work). */
  held: boolean;
}

export interface Episode {
  call: number;
  scheduledAt: number | null;
  /** When the work is known to be over (ms); null while it is still open. */
  end: number | null;
  runs: OpRun[];
  label: string;
  outcome: WorkRef["outcome"];
  alreadyStarted: boolean;
  workflow?: OwnedWorkflow;
}

export const ROUTINE = {
  /** Seconds from the office door to inside the lobby. */
  enter: 4,
  /** Seconds from the lobby to the desk. */
  toDesk: 7,
  /** Seconds sitting back after a task finishes, before getting up. */
  doneHold: 10,
  /** Seconds from the desk back out of the door. */
  leave: 7,
  /** Seconds of margin before a scheduled run. */
  buffer: 40,
  /** Most minutes the commute starts before a scheduled run (a farther agent takes the fallback route). */
  maxLeadMin: 15,
  /** A scheduled run with no report: how long the agent waits at the desk for n8n to report it. */
  dueWaitMin: 12,
  /** The same, for a workflow n8n is set not to keep successful runs for (it never will report one). */
  silentWaitMin: 3,
  /** Approval and n8n Wait steps: the agent waits at the desk this long, then goes on with the day while the panel keeps the wait. */
  approvalHoldMin: 5,
  /** Schedules more often than this don't send the agent to the office each time. */
  minScheduleGapMin: 55,
  /** The day is worked out from this hour (local), when every agent is home asleep, so it's the same whenever it's recomputed. */
  dayStartHour: 3,
  /** How far ahead it is planned. */
  aheadMin: 90,
  /** Share of free-time picks spent outside the agent's own building (the rest are outings). */
  nearOffice: 0.65,
  /** Night at home, in the agent's time zone. */
  night: [23, 7] as [number, number],
} as const;

const S = 1000, MIN = 60 * S;

// ------------------------------------------------------------------------------------- seeded randomness

/** FNV-1a, a small stable string hash. */
export function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** A number in [0, 1) from a seed string. */
export const rand = (seed: string) => hashOf(seed) / 4294967296;

/** Each agent's liking for each kind of outing, 0.2 to 1.2, fixed per agent. */
export function preferences(personaId: string): Record<LeisureKind, number> {
  const kinds: LeisureKind[] = ["park", "district", "train", "flight", "yacht", "wheel", "arena", "cafe", "home"];
  // "office" (outside its own building) is weighted in `free()` against the whole pool instead.
  return { office: 0, ...Object.fromEntries(kinds.map((k) => [k, 0.2 + rand(`${personaId}:likes:${k}`)])) } as Record<LeisureKind, number>;
}

// ------------------------------------------------------------------------------------- episodes

const finished = (r: OpRun) => r.status === "succeeded" || r.status === "failed" || r.status === "cancelled";
const holding = (r: OpRun) => r.status === "running" || r.status === "queued";

function scheduledTimeOf(r: OpRun, w: OwnedWorkflow | undefined): number | null {
  if (!w || !w.schedules.length || r.startedAt === null) return null;
  if (r.mode && r.mode !== "trigger" && r.mode !== "schedule") return null;
  for (const s of w.schedules) {
    const c = parseCron(s.cron);
    const t = c && nextCron(c, w.timeZone, r.startedAt - 3 * MIN, 1, s.everyWeeks ?? 1);
    if (t && Math.abs(t - r.startedAt) <= 3 * MIN) return t;
  }
  return null;
}

/** How often a schedule fires, roughly (minutes between its next two times). */
function gapMin(w: OwnedWorkflow, s: OwnedWorkflow["schedules"][number], from: number): number {
  const c = parseCron(s.cron);
  if (!c) return Infinity;
  const a = nextCron(c, w.timeZone, from, 400, s.everyWeeks ?? 1);
  const b = a && nextCron(c, w.timeZone, a, 400, s.everyWeeks ?? 1);
  return a && b ? (b - a) / MIN : Infinity;
}

/**
 * The work that calls the agent in, oldest first: real runs (dated by when Atlas learned of them, or
 * by their schedule), and upcoming scheduled runs (so the commute starts ahead of time).
 */
export function episodesOf(ops: AgentOps, from: number, until: number, now: number): Episode[] {
  const out: Episode[] = [];
  const wf = new Map(ops.workflows.map((w) => [w.key, w]));
  const claimed = new Set<string>();
  for (const r of ops.runs) {
    const t = r.startedAt ?? r.seenAt;
    const open = !finished(r);
    if (!open && (r.stoppedAt ?? t) < from) continue;
    if (t > now) continue;
    const w = wf.get(r.workflowKey);
    const sched = scheduledTimeOf(r, w);
    if (sched !== null) claimed.add(`${r.workflowKey}@${sched}`);
    const alreadyStarted = sched === null;
    // An unscheduled run calls the agent the moment Atlas learns of it, never earlier.
    const call = sched ?? Math.max(t, r.seenAt);
    let end: number | null;
    if (finished(r)) end = Math.max(r.stoppedAt ?? t, r.statusSeenAt, call);
    else if (holding(r)) end = null;
    // Approval or Wait step: sit for a few minutes, then the day goes on while the panel keeps the wait.
    else end = Math.max(call, r.statusSeenAt) + ROUTINE.approvalHoldMin * MIN;
    const outcome: WorkRef["outcome"] = r.status === "succeeded" ? "succeeded" : r.status === "failed" ? "failed" : r.status === "cancelled" ? "cancelled" : r.status === "waiting" || r.status === "waiting_approval" ? "waiting" : null;
    out.push({ call, scheduledAt: sched, end, runs: [r], label: r.title, outcome, alreadyStarted, ...(w ? { workflow: w } : {}) });
  }
  // Scheduled times with no run reported (yet): upcoming ones bring the agent in early; past ones
  // keep it at the desk while n8n reports, then let it go without claiming a result.
  for (const w of ops.workflows) {
    for (const s of w.schedules) {
      if (gapMin(w, s, from) < ROUTINE.minScheduleGapMin) continue;
      const c = parseCron(s.cron);
      if (!c) continue;
      let t = nextCron(c, w.timeZone, from, 2, s.everyWeeks ?? 1);
      while (t !== null && t <= until) {
        if (!claimed.has(`${w.key}@${t}`)) {
          const wait = (w.savesSuccess ? ROUTINE.dueWaitMin : ROUTINE.silentWaitMin) * MIN;
          const past = t + wait <= now;
          // A run reported near this time (from another source) covers it.
          const covered = ops.runs.some((r) => r.workflowKey === w.key && Math.abs((r.startedAt ?? r.seenAt) - t!) <= 3 * MIN);
          if (!covered) out.push({ call: t, scheduledAt: t, end: t + wait, runs: [], label: `${w.name} (${s.label})`, outcome: past ? (w.savesSuccess ? "no_run" : "unconfirmed") : null, alreadyStarted: false, workflow: w });
        }
        t = nextCron(c, w.timeZone, t, 2, s.everyWeeks ?? 1);
      }
    }
  }
  return out.sort((a, b) => a.call - b.call);
}

// ------------------------------------------------------------------------------------- the day

const atSpot = (a: Anchor): SpotId | null => ("spot" in a ? a.spot : null);

export function isNight(t: number, tz: string): boolean {
  const h = zoned(t, tz).h;
  const [from, to] = ROUTINE.night;
  return h >= from || h < to;
}
/** The next morning hour after `t` in the zone. */
function morningAfter(t: number, tz: string): number {
  for (let k = 0; k < 18 * 4; k++) {
    const u = t + k * 15 * MIN;
    if (!isNight(u, tz)) return u;
  }
  return t + 8 * 60 * MIN;
}

/** The latest ROUTINE.dayStartHour:00 in the zone at or before `t`. */
export function dayStart(t: number, tz: string): number {
  const z = zoned(t, tz);
  let s = fromZoned(z.y, z.mo, z.d, ROUTINE.dayStartHour, 0, tz);
  if (s > t) {
    const y = zoned(t - 24 * 60 * MIN, tz);
    s = fromZoned(y.y, y.mo, y.d, ROUTINE.dayStartHour, 0, tz);
  }
  return s;
}

interface Cursor {
  t: number;
  at: Anchor;
}

/** Where on a segment the agent is at time `t` (for an interruption). */
/** How far along its route a walk is at `t` (0 to 1), counting a walk cut short. */
export function walkShare(seg: Extract<Segment, { kind: "walk" }>, t: number): number {
  return Math.min(1, Math.max(0, (t - seg.t0) / Math.max(1, seg.t1 - seg.t0))) * (seg.f1 ?? 1);
}

export function anchorAt(seg: Segment, t: number): Anchor {
  if (seg.kind === "walk") return { from: seg.from, to: seg.to, f: walkShare(seg, t) };
  return { spot: seg.at };
}

export interface RoutineInput {
  personaId: string;
  ops: AgentOps;
  env: RoutineEnv;
  now: number;
  timeZone?: string;
  /** Paused in Atlas: the character stays home (its real work is unaffected). */
  held?: boolean;
  /**
   * Sent off on free time from Atlas (freeTime.ts): from `at`, if the agent is in its free time then,
   * it drops what it's doing (getting safely off a ride first) and goes to this kind of outing.
   * "any" picks one it likes. Only the picture changes: work still calls it in as usual.
   */
  outing?: { kind: LeisureKind | "any"; at: number } | null;
}

/**
 * The agent's day around `now`: from the day's start (ROUTINE.dayStartHour, at home) to ROUTINE.aheadMin
 * ahead. Callers keep it until `validUntil` or until the agent's runs change.
 */
export function planRoutine(input: RoutineInput): Routine {
  const { personaId, ops, env, now } = input;
  const tz = input.timeZone ?? DEFAULT_TIME_ZONE;
  const from = dayStart(now, tz);
  const until = now + ROUTINE.aheadMin * MIN;
  const segments: Segment[] = [];
  if (input.held) {
    segments.push({ kind: "stay", t0: from, t1: until + 24 * 60 * MIN, at: env.home, activity: "at_home", phase: null, note: "City routine paused in Atlas (its real work is unaffected)" });
    return { personaId, segments, validUntil: until, episodes: [], held: true };
  }
  const episodes = episodesOf(ops, from, until, now);
  const likes = preferences(personaId);
  const cur: Cursor = { t: from, at: { spot: env.home } };
  const push = (s: Segment) => {
    if (s.t1 > s.t0) segments.push(s);
  };
  const walkTo = (to: SpotId, activity: CityActivity, phase: WorkPhase | null, note: string, option?: LeisureOption): boolean => {
    const here = atSpot(cur.at);
    if (here === to) return true;
    const secs = env.travel(cur.at, to);
    // No route: a discreet fallback, the agent is simply there a moment later (hidden while it "travels").
    const d = Number.isFinite(secs) ? secs * S : 20 * S;
    push({ kind: "walk", t0: cur.t, t1: cur.t + d, from: cur.at, to, activity, phase, note: Number.isFinite(secs) ? note : `${note} (no walking route: shown arriving)`, ...(option ? { option } : {}) });
    cur.t += d;
    cur.at = { spot: to };
    return Number.isFinite(secs);
  };
  /** Seconds from a place to the desk, door to chair included. */
  const leadFrom = (a: Anchor) => {
    const secs = env.travel(a, env.office);
    return Math.min(ROUTINE.maxLeadMin * 60, (Number.isFinite(secs) ? secs : 20) + ROUTINE.enter + ROUTINE.toDesk + ROUTINE.buffer) * S;
  };

  /**
   * Free time from the cursor until `stopAt` (ms): seeded outings that fit before the next known
   * scheduled run. `scheduled` is that run's time, when known, so the last outing ends early enough
   * to commute in. Returns the segments' end (== stopAt, or the scheduled commute start).
   */
  const outing = input.outing && !isNight(input.outing.at, tz) ? input.outing : null;
  let outingDone = false;
  const free = (stopAt: number, scheduled: number | null) => {
    if (outing && !outingDone && outing.at >= cur.t && outing.at < stopAt) {
      outingDone = true;
      // Still free at that moment (not already set to head in for a scheduled run): go.
      if (!freeLoop(outing.at, scheduled)) {
        interrupt(outing.at);
        goOuting(outing.kind, scheduled);
      }
    }
    freeLoop(stopAt, scheduled);
  };
  /** The outing asked for from Atlas, chosen among the places of that kind (nearest that fits first). */
  const goOuting = (kind: LeisureKind | "any", scheduled: number | null) => {
    const limit = scheduled !== null ? scheduled - leadFrom(cur.at) : Infinity;
    const left = limit - cur.t;
    const reach = env.leisure.filter((o) => (kind === "any" ? o.kind !== "office" && o.kind !== "home" : o.kind === kind) && Number.isFinite(env.travel(cur.at, o.spot)));
    const fits = reach.filter((o) => {
      const back = env.travel({ spot: o.exit }, env.office);
      return (env.travel(cur.at, o.spot) + o.stay[0] + (Number.isFinite(back) ? back : 0)) * S < left;
    });
    const seed = `${personaId}:asked:${Math.floor(cur.t / MIN)}`;
    let pick: LeisureOption | null = null;
    if (kind === "any" && fits.length) {
      const total = fits.reduce((s, o) => s + likes[o.kind], 0);
      let r = rand(seed) * total;
      pick = fits.find((o) => (r -= likes[o.kind]) <= 0) ?? fits[fits.length - 1];
    } else if (fits.length) {
      pick = [...fits].sort((a, b) => env.travel(cur.at, a.spot) - env.travel(cur.at, b.spot))[0];
    }
    if (!pick) {
      const why = reach.length ? "the next scheduled run is too close" : "there isn't one on the map";
      const t1 = cur.t + Math.max(0, Math.min(left, 2 * MIN));
      push({ kind: "stay", t0: cur.t, t1, at: atSpot(cur.at) ?? env.office, activity: "relaxing", phase: null, note: `Sent on free time from Atlas, but ${why}: taking a short break nearby` });
      if (!atSpot(cur.at)) cur.at = { spot: env.office };
      cur.t = Math.max(cur.t, t1);
      return;
    }
    doOuting(pick, seed, scheduled, "Off on free time from Atlas: walking to");
  };
  /** Walk to an outing and spend it: a ride (queue, ride, off at its exit) or a stay. */
  const doOuting = (pick: LeisureOption, seed: string, scheduled: number | null, walking = "Walking to") => {
    walkTo(pick.spot, "walking", null, `${walking} ${pick.label.toLowerCase()}`, pick);
    const room = scheduled !== null ? scheduled - cur.t - leadFrom({ spot: pick.exit }) : Infinity;
    if (pick.kind === "train" || pick.kind === "flight" || pick.kind === "yacht" || pick.kind === "wheel") {
      const times = env.ride(pick, cur.t, personaId);
      if (times && times.alight - cur.t <= Math.max(room, 0)) {
        push({ kind: "stay", t0: cur.t, t1: times.board, at: pick.spot, activity: "relaxing", phase: null, note: `In the queue for ${pick.label.toLowerCase()}`, option: pick });
        push({ kind: "ride", t0: times.board, t1: times.alight, at: pick.spot, activity: "riding", phase: null, note: pick.label, option: pick, times });
        cur.t = Math.max(cur.t, times.alight);
        cur.at = { spot: pick.exit };
        return;
      }
      // The ride doesn't fit before work (or isn't running): watch it a while instead.
      const t1 = cur.t + Math.min(Math.max(room, 30 * S), 4 * MIN);
      push({ kind: "stay", t0: cur.t, t1, at: pick.spot, activity: "relaxing", phase: null, note: `Watching ${pick.label.replace(/^(Riding|On) (the |a )?/i, "the ").toLowerCase()} (not enough time for a ride)`, option: pick });
      cur.t = t1;
      return;
    }
    const lo = pick.stay[0], hi = pick.stay[1];
    const stay = Math.min((lo + rand(`${seed}:stay`) * (hi - lo)) * S, Math.max(room, 30 * S));
    const activity: CityActivity = pick.kind === "home" ? "at_home" : pick.kind === "park" || pick.kind === "office" || pick.kind === "cafe" ? "relaxing" : "visiting";
    push({ kind: "stay", t0: cur.t, t1: cur.t + stay, at: pick.spot, activity, phase: null, note: pick.label, option: pick });
    cur.t += stay;
    cur.at = { spot: pick.exit };
  };
  /** Returns true when it stopped because the next scheduled run is near (the commute is next). */
  const freeLoop = (stopAt: number, scheduled: number | null): boolean => {
    let guard = 0;
    while (cur.t < stopAt && guard++ < 400) {
      // Choices depend only on the next scheduled run, never on when an unexpected one cuts in,
      // so the free time before an interruption is the same as it would have been without it.
      const limit = scheduled !== null ? scheduled - leadFrom(cur.at) : Infinity;
      const left = limit - cur.t;
      if (left <= 30 * S) {
        // Not enough time for anything: wait where it is.
        if (limit > cur.t) push({ kind: "stay", t0: cur.t, t1: limit, at: atSpot(cur.at) ?? env.office, activity: "relaxing", phase: null, note: "Waiting nearby for the next scheduled run" });
        cur.t = Math.max(cur.t, limit);
        return true;
      }
      // Night: home until morning.
      if (isNight(cur.t, tz)) {
        walkTo(env.home, "walking", null, "Walking home for the night");
        const t1 = Math.min(morningAfter(cur.t, tz), scheduled !== null ? scheduled - leadFrom(cur.at) : Infinity);
        push({ kind: "stay", t0: cur.t, t1, at: env.home, activity: "at_home", phase: null, note: "At home for the night" });
        cur.t = Math.max(cur.t, t1);
        continue;
      }
      const seed = `${personaId}:${Math.floor(cur.t / MIN)}`;
      // Choose an outing that fits: the walk there, the stay or ride, and the walk on to the office.
      const fits = env.leisure.filter((o) => {
        const go = env.travel(cur.at, o.spot);
        if (!Number.isFinite(go)) return false;
        const back = env.travel({ spot: o.exit }, env.office);
        const need = (go + o.stay[0] + (Number.isFinite(back) ? back : 0)) * S;
        return need < left;
      });
      const pool = fits.length ? fits : [];
      let pick: LeisureOption | null = null;
      if (pool.length) {
        // Weighted by the agent's likes; the same seed always gives the same pick. Most free time is
        // spent outside its own building (ROUTINE.nearOffice of the picks), so a building's agents are
        // found there or at their desks, with an outing now and then.
        const others = pool.reduce((s, o) => s + (o.kind === "office" ? 0 : likes[o.kind]), 0);
        const near = others > 0 ? (others * ROUTINE.nearOffice) / (1 - ROUTINE.nearOffice) : 1;
        const weight = (o: LeisureOption) => (o.kind === "office" ? near : likes[o.kind]);
        const total = pool.reduce((s, o) => s + weight(o), 0);
        let r = rand(seed) * total;
        for (const o of pool) {
          r -= weight(o);
          if (r <= 0) {
            pick = o;
            break;
          }
        }
        pick ??= pool[pool.length - 1];
      }
      if (!pick) {
        push({ kind: "stay", t0: cur.t, t1: cur.t + Math.min(left, 3 * MIN), at: atSpot(cur.at) ?? env.office, activity: "relaxing", phase: null, note: "Taking a short break nearby" });
        if (!atSpot(cur.at)) cur.at = { spot: env.office };
        cur.t += Math.min(left, 3 * MIN);
        continue;
      }
      doOuting(pick, seed, scheduled);
    }
    return false;
  };

  /** Cut the free time at `t` (an unexpected run): where the agent is then, after getting safely off any ride. */
  const interrupt = (t: number) => {
    while (segments.length && segments[segments.length - 1].t0 >= t) segments.pop();
    const last = segments[segments.length - 1];
    if (!last || last.t1 <= t) {
      cur.t = Math.max(cur.t, t);
      return;
    }
    if (last.kind === "ride") {
      const off = Math.max(t, env.rideExit(last.option, last.times, t));
      last.t1 = off;
      last.note = `${last.option.label}: getting off to head to the office`;
      cur.t = off;
      cur.at = { spot: last.option.exit };
      return;
    }
    // A stay inside a place (the café) ends with time to get back out to its door, then the walk to work.
    if (last.kind === "stay" && last.option?.leave) {
      const out = Math.min(last.t1, t + last.option.leave * S);
      last.t1 = out;
      last.note = `${last.note}: leaving for the office`;
      cur.t = out;
      cur.at = { spot: last.at };
      return;
    }
    cur.at = anchorAt(last, t);
    // A walk cut short keeps its route and pace: it just ends part of the way along.
    if (last.kind === "walk") last.f1 = walkShare(last, t);
    last.t1 = t;
    cur.t = t;
    if (last.t1 <= last.t0) segments.pop();
  };

  // Merge episodes that overlap (the agent is still at the desk when the next one calls).
  const merged: Episode[] = [];
  for (const e of episodes) {
    const prev = merged[merged.length - 1];
    const officeLead = (ROUTINE.enter + ROUTINE.toDesk + ROUTINE.buffer) * S;
    const prevRelease = prev ? (prev.end === null ? Infinity : prev.end + (ROUTINE.doneHold + ROUTINE.leave) * S) : -Infinity;
    const start = e.scheduledAt !== null && e.runs.length === 0 ? e.scheduledAt - officeLead : e.call;
    if (prev && start <= prevRelease) {
      prev.end = prev.end === null || e.end === null ? null : Math.max(prev.end, e.end);
      prev.runs = [...prev.runs, ...e.runs];
      prev.label = prev.runs.length > 1 ? `${prev.runs.length} runs` : prev.label;
      prev.outcome = e.outcome ?? prev.outcome;
      continue;
    }
    merged.push({ ...e, runs: [...e.runs] });
  }

  for (const e of merged) {
    if (e.end !== null && e.end < from) continue;
    // 1. Free time up to the call: planned ahead for a scheduled run, cut short for an unexpected one.
    if (e.scheduledAt !== null) {
      free(e.scheduledAt, e.scheduledAt);
      const startCommute = Math.max(cur.t, e.scheduledAt - leadFrom(cur.at));
      if (startCommute > cur.t) {
        push({ kind: "stay", t0: cur.t, t1: startCommute, at: atSpot(cur.at) ?? env.office, activity: "relaxing", phase: null, note: "Finishing up before work" });
        cur.t = startCommute;
      }
    } else {
      free(e.call, nextScheduledAfter(merged, e.call));
      interrupt(e.call);
    }
    if (cur.t >= until) break;
    const work: WorkRef = { label: e.label, runs: e.runs, scheduledAt: e.scheduledAt, alreadyStarted: e.alreadyStarted, outcome: e.outcome };
    const callNote = e.alreadyStarted ? `Heading to the office: ${e.label} already started` : `Heading to the office for ${e.label}${e.scheduledAt ? ` at ${clock(e.scheduledAt, tz)}` : ""}`;
    // 2. Heading in. If the work ends before arrival, stop there: no pretend work session.
    const walkStart = cur.t;
    walkTo(env.office, "commuting", "heading", callNote);
    if (e.end !== null && e.end <= cur.t && e.end >= walkStart && e.runs.length) {
      // Finished before arrival: cut the walk where the agent was when it learned.
      const walk = segments[segments.length - 1];
      if (walk && walk.kind === "walk" && walk.phase === "heading" && e.end < walk.t1) {
        cur.at = anchorAt(walk, e.end);
        walk.t1 = e.end;
      }
      cur.t = Math.max(walkStart, e.end);
      push({ kind: "stay", t0: cur.t, t1: cur.t + 8 * S, at: atSpot(cur.at) ?? env.office, activity: "walking", phase: "completed", note: `${e.label} finished before arrival (${outcomeWord(e.outcome)})` });
      if (!atSpot(cur.at)) {
        // Standing on the street where it stopped; free time picks up from the nearest place: the office.
        cur.at = { spot: env.office };
      }
      cur.t += 8 * S;
      continue;
    }
    // 3. Entering, to the desk, working.
    const inside = (phase: WorkPhase, t1: number, note: string) => {
      push({ kind: "inside", t0: cur.t, t1, at: env.office, activity: "at_desk", phase, note, work });
      cur.t = Math.max(cur.t, t1);
    };
    inside("entering", cur.t + ROUTINE.enter * S, "Entering the building");
    inside("to_desk", cur.t + ROUTINE.toDesk * S, "Going to the desk");
    const workEnd = e.end ?? Infinity;
    if (workEnd > cur.t) {
      // Seated ahead of a scheduled run: ready until its time, then waiting for n8n's report or working.
      if (e.scheduledAt !== null && e.scheduledAt > cur.t) inside("working", Math.min(e.scheduledAt, workEnd), `Ready at the desk for ${e.label} at ${clock(e.scheduledAt, tz)}`);
      const note = e.runs.length === 0 ? `${e.label} is due: waiting for n8n to report the run` : workNote(e);
      // Open-ended work holds until the plan is recomputed (the run list changes).
      if (workEnd > cur.t) inside("working", Math.min(workEnd, until + 24 * 60 * MIN), note);
      if (workEnd === Infinity) break;
    }
    if (cur.t >= until) break;
    inside("completed", cur.t + ROUTINE.doneHold * S, completedNote(e));
    inside("leaving", cur.t + ROUTINE.leave * S, "Leaving the office");
    cur.at = { spot: env.office };
  }
  if (cur.t < until) free(until, nextScheduledAfter(merged, cur.t));
  const nextEp = merged.find((e) => e.call > now);
  return { personaId, segments, validUntil: Math.min(until - 10 * MIN, nextEp ? nextEp.call : Infinity), episodes: merged, held: false };
}

function nextScheduledAfter(eps: Episode[], t: number): number | null {
  return eps.find((e) => e.scheduledAt !== null && e.scheduledAt > t)?.scheduledAt ?? null;
}

function outcomeWord(o: WorkRef["outcome"]): string {
  switch (o) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "waiting":
      return "waiting";
    case "unconfirmed":
      return "not confirmed";
    case "no_run":
      return "no run reported";
    default:
      return "result pending";
  }
}

function workNote(e: Episode): string {
  const open = e.runs.filter((r) => !finished(r));
  const approval = open.find((r) => r.status === "waiting_approval");
  if (approval) return `Waiting for approval: ${approval.title}`;
  const waiting = open.find((r) => r.status === "waiting");
  if (waiting) return `Waiting in n8n: ${waiting.title}`;
  const queued = open.filter((r) => r.status === "queued").length;
  const running = open.filter((r) => r.status === "running");
  if (running.length > 1) return `Working on ${running.length} runs at once`;
  if (running.length) return `Working: ${running[0].title}${running[0].retry ? " (retry)" : ""}${queued ? ` · ${queued} queued` : ""}`;
  if (queued) return `${queued} queued, waiting to start`;
  return `Working: ${e.label}`;
}

function completedNote(e: Episode): string {
  if (e.runs.length === 0) return e.outcome === "unconfirmed" ? `${e.label}: n8n keeps no record of successful runs, so the result isn't confirmed` : `${e.label}: no run reported for this schedule`;
  const failed = e.runs.find((r) => r.status === "failed");
  if (failed) return `${failed.title} failed`;
  if (e.runs.some((r) => r.status === "cancelled")) return `${e.label} was cancelled`;
  if (e.runs.some((r) => r.status === "waiting" || r.status === "waiting_approval")) return `${e.label}: still waiting, back to the day`;
  return `${e.label} succeeded`;
}

/** A desk segment where a run is really working (not ready ahead of it, waiting for a report, or waiting on approval). */
export function runWorking(seg: Segment): boolean {
  return seg.kind === "inside" && seg.phase === "working" && seg.work.runs.some((r) => r.status === "running" || r.status === "queued");
}

/** Seated at its own desk (not walking in, up to it, or out): the office inside draws it in its chair. */
export function seatedAtDesk(seg: Segment | null): boolean {
  return !!seg && seg.kind === "inside" && seg.phase !== "entering" && seg.phase !== "to_desk" && seg.phase !== "leaving";
}

/** What the card says the agent is doing in the city: "Working" only while a run is really running. */
export function activityText(seg: Segment): string {
  if (seg.kind === "inside" && seg.phase === "working" && !runWorking(seg)) return seg.work.runs.some((r) => r.status === "waiting_approval") ? "At desk, waiting for approval" : "At desk";
  return seg.phase ? PHASE_LABEL[seg.phase] : ACTIVITY_LABEL[seg.activity];
}

/** "1:05 PM" in the zone. */
export function clock(t: number, tz: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(t));
}

/** The segment at `t`, or the last one before it. */
export function segmentAt(r: Routine, t: number): Segment | null {
  let best: Segment | null = null;
  for (const s of r.segments) {
    if (s.t0 <= t && t < s.t1) return s;
    if (s.t1 <= t) best = s;
  }
  return best;
}
