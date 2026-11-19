import { useSyncExternalStore } from "react";
import { load, save } from "../lib/storage";
import { isValidTimeZone } from "../lib/timezone";

// Presence schedules: where an agent is drawn (home, outdoors, walking, at work), from the real
// clock in the schedule's own time zone. Presence only. Nothing here starts, stops or reports an
// automation: those keep their own triggers, and their state comes from telemetry (office/model.ts).

export interface PresenceAssignment {
  /** Financial District building id (FINANCIAL_BUILDINGS), such as "circa". */
  home: string;
  /** Catalog project id: the agent works in that project's headquarters. */
  work: string;
  /** Working days, 0 = Sunday to 6 = Saturday, in the schedule's time zone. */
  days: number[];
  /** Wall-clock "HH:MM"; an end at or before the start is an overnight shift. */
  start: string;
  end: string;
  timeZone: string;
}

export type PresencePlace = "home" | "outdoors" | "to-work" | "work" | "to-home";
export interface Presence { place: PresencePlace; /** 0..1 along the walk, for to-work and to-home. */ progress: number }

export const PRESENCE = { commuteMinutes: 20, outdoorMinutes: 60, dayOffOutdoors: [12 * 60, 13 * 60] } as const;
const WEEK = 7 * 1440;
const STORAGE_KEY = "agent-presence";

export const minutesOf = (hhmm: string) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Day of the week and minute of the day on the wall clock in a zone; DST is the zone's business. */
const formats = new Map<string, Intl.DateTimeFormat>();
export function wallClock(now: Date, timeZone: string) {
  let f = formats.get(timeZone);
  if (!f) formats.set(timeZone, (f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })));
  const parts = f.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * Where the schedule puts the agent now. Stateless: it depends only on the clock, so reopening
 * Atlas lands on the right place without replaying missed walks, and a DST jump just moves the clock.
 */
export function presenceAt(a: PresenceAssignment, now: Date): Presence {
  const { day, minute } = wallClock(now, a.timeZone), t = day * 1440 + minute, c = PRESENCE.commuteMinutes;
  const start = minutesOf(a.start), end = minutesOf(a.end), length = ((end - start + 1440 - 1) % 1440) + 1;
  const since = (s: number) => (((t - s) % WEEK) + WEEK) % WEEK;
  let outdoors = false;
  for (const d of a.days) {
    const s = d * 1440 + start, e = s + length;
    if (since(s) < length) return { place: "work", progress: 0 };
    if (since(s - c) < c) return { place: "to-work", progress: since(s - c) / c };
    if (since(e) < c) return { place: "to-home", progress: since(e) / c };
    if (since(e + c) < PRESENCE.outdoorMinutes) outdoors = true;
  }
  const [from, to] = PRESENCE.dayOffOutdoors;
  if (outdoors || (!a.days.includes(day) && minute >= from && minute < to)) return { place: "outdoors", progress: 0 };
  return { place: "home", progress: 0 };
}

export const PRESENCE_LABEL: Record<PresencePlace, string> = { home: "At home", outdoors: "Outdoors near home", "to-work": "Walking to work", work: "At its workplace", "to-home": "Walking home" };

/** Problems with an assignment, in plain words; empty when it can be saved. */
export function validateAssignment(a: PresenceAssignment, homes: string[], works: string[]): string[] {
  const out: string[] = [];
  if (!homes.includes(a.home)) out.push("Choose a home building that is on the map.");
  if (!works.includes(a.work)) out.push("Choose a workplace building that is on the map.");
  if (!a.days.length) out.push("Choose at least one working day.");
  if (Number.isNaN(minutesOf(a.start)) || Number.isNaN(minutesOf(a.end))) out.push("Use start and end times like 09:00.");
  else if (a.start === a.end) out.push("Start and end times must differ.");
  if (!isValidTimeZone(a.timeZone)) out.push("Choose a valid time zone.");
  return out;
}

let saved = load<Record<string, PresenceAssignment>>(STORAGE_KEY, {});
const listeners = new Set<() => void>();
export const getAssignments = () => saved;
/** Saves (or with null, clears) an agent's assignment, keyed by its stable catalog id. */
export function setAssignment(agentId: string, a: PresenceAssignment | null) {
  const rest = { ...saved };
  delete rest[agentId];
  saved = a ? { ...rest, [agentId]: a } : rest;
  save(STORAGE_KEY, saved);
  listeners.forEach((l) => l());
}
export const usePresenceAssignments = () => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), getAssignments);
