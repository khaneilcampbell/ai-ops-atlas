import { useSyncExternalStore } from "react";
import { load, save } from "../lib/storage";
import type { LeisureKind, Segment } from "./routine";

/**
 * "Free time" from Atlas: Khaneil sends an agent that has nothing to do off to something in the city
 * (the Ferris wheel, the yacht, a park bench...). It is a request to the city routine (routine.ts),
 * which works it into the agent's day from that moment, so a reload or another device-free recompute
 * draws the same outing.
 *
 * It only changes the map picture. It never starts, delays or cancels a run, never touches a
 * schedule, a workflow or a permission: a run that comes due still calls the agent back to its desk,
 * straight off the ride or bench.
 */
export type FreeTimeChoice = Exclude<LeisureKind, "office" | "home"> | "any";

/** In the order the picker shows them. */
export const FREE_TIME_CHOICES: { kind: FreeTimeChoice; label: string; going: string }[] = [
  { kind: "any", label: "Surprise me", going: "something it likes" },
  { kind: "wheel", label: "Ferris wheel", going: "the Ferris wheel" },
  { kind: "yacht", label: "Yacht ride", going: "a yacht ride" },
  { kind: "train", label: "Train ride", going: "a train ride" },
  { kind: "flight", label: "Gold Jet flight", going: "a Gold Jet flight" },
  { kind: "park", label: "Park bench", going: "a park bench" },
  { kind: "arena", label: "Arena", going: "the arena" },
  { kind: "district", label: "Visit a district", going: "another district" },
];

export interface FreeTimeRequest {
  kind: FreeTimeChoice;
  /** When it was asked for (ms): the routine sends the agent off from this moment. */
  at: number;
}

/** A request older than this is history: the day has moved on. */
export const FREE_TIME_KEEP_MS = 6 * 60 * 60_000;
const KEY = "routine-free-time";

const valid = (v: unknown): v is FreeTimeRequest => !!v && typeof v === "object" && Number.isFinite((v as FreeTimeRequest).at) && FREE_TIME_CHOICES.some((c) => c.kind === (v as FreeTimeRequest).kind);

/** Drops requests the day has left behind. */
export function freshRequests(all: Record<string, unknown>, now: number): Map<string, FreeTimeRequest> {
  const out = new Map<string, FreeTimeRequest>();
  for (const [id, r] of Object.entries(all ?? {})) if (valid(r) && now - r.at < FREE_TIME_KEEP_MS && r.at <= now + 60_000) out.set(id, r);
  return out;
}

/**
 * Whether the agent can be sent off now, and why not. Only an agent in its free time can go: one at
 * work, heading in, at home for the night, or with its city routine paused stays where it is.
 */
export function freeTimeAvailability(seg: Segment | null, held: boolean): { ok: true } | { ok: false; reason: string } {
  if (held) return { ok: false, reason: "Its city routine is paused in Atlas (Schedule), so it stays home." };
  if (!seg) return { ok: false, reason: "Not placed on the map yet. Switch on the 3D map." };
  if (seg.phase !== null) return { ok: false, reason: "Busy with work right now. Free time comes after the task." };
  if (seg.activity === "at_home") return { ok: false, reason: "At home for the night (11 PM to 7 AM)." };
  return { ok: true };
}

let requests = freshRequests(load<Record<string, unknown>>(KEY, {}), Date.now());
const watchers = new Set<() => void>();

/** Sends these agents off on free time from now. Replaces any earlier request for them. */
export function requestFreeTime(personaIds: readonly string[], kind: FreeTimeChoice, now = Date.now()) {
  const next = freshRequests(Object.fromEntries(requests), now);
  for (const id of personaIds) next.set(id, { kind, at: now });
  requests = next;
  save(KEY, Object.fromEntries(next));
  watchers.forEach((w) => w());
}

/** What Atlas says after sending an agent off. */
export function freeTimeSentNote(name: string, kind: FreeTimeChoice): string {
  const going = FREE_TIME_CHOICES.find((c) => c.kind === kind)?.going ?? "free time";
  return `${name} is off to ${going}. Only the map changes: runs, schedules and permissions stay as they are, and a run that comes due still calls ${name} back.`;
}

export function useFreeTimeRequests(): ReadonlyMap<string, FreeTimeRequest> {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => requests,
    () => requests,
  );
}
