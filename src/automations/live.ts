import type { ExecutionRecord } from "../registry/types";
import type { RegistryEntry } from "../registry/registry";
import { isDraft, isManual, recentRuns } from "./board";

// The Automations Live tab: what ran today, what failed, and the table sorted so trouble comes
// first. Only runs Atlas already loaded are drawn; nothing is scheduled or guessed from trigger text.

/** Hour of the day (0 to 24, with minutes as a fraction) in `timeZone`. */
export function hourOfDay(at: string | number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") + get("minute") / 60;
}

const dayOf = (at: string | number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

export interface TimelineRow {
  entry: RegistryEntry;
  runs: { hour: number; result: ExecutionRecord["result"]; at: string; url?: string }[];
}

/** One row per automation that ran today (in `timeZone`), earliest first run first. */
export function todayRuns(entries: readonly RegistryEntry[], timeZone: string, now = Date.now()): TimelineRow[] {
  const today = dayOf(now, timeZone);
  return entries
    .map((entry) => ({
      entry,
      runs: entry.telemetry.executions
        .filter((x) => !x.offMainline && dayOf(x.at, timeZone) === today)
        .map((x) => ({ hour: hourOfDay(x.at, timeZone), result: x.result, at: x.at, url: x.url })),
    }))
    .filter((r) => r.runs.length)
    .sort((a, b) => Math.min(...a.runs.map((r) => r.hour)) - Math.min(...b.runs.map((r) => r.hour)) || a.entry.profile.title.localeCompare(b.entry.profile.title));
}

export type LiveState = "failing" | "draft" | "verified" | "unverified";

/** One state per automation, so the ring's counts always add up to the total. */
export function liveState(e: RegistryEntry): LiveState {
  if (e.operational === "failing") return "failing";
  if (isDraft(e)) return "draft";
  if (e.operational === "verified") return "verified";
  return "unverified";
}

export function liveCounts(entries: readonly RegistryEntry[]): Record<LiveState, number> {
  const out: Record<LiveState, number> = { failing: 0, draft: 0, verified: 0, unverified: 0 };
  for (const e of entries) out[liveState(e)]++;
  return out;
}

export const STATE_LABEL: Record<LiveState, string> = { failing: "Latest run failed", draft: "Draft, not published", verified: "Verified running", unverified: "No verified run" };

/** The status shown in the table: what the latest run did, or why there is none. */
export function statusLabel(e: RegistryEntry): string {
  const s = liveState(e);
  if (s === "unverified" && isManual(e)) return "Manual";
  return STATE_LABEL[s];
}

export type LiveSort = "attention" | "recent" | "name";
const RANK: Record<LiveState, number> = { failing: 0, draft: 1, unverified: 2, verified: 3 };

export function sortLive(entries: readonly RegistryEntry[], by: LiveSort): RegistryEntry[] {
  const last = (e: RegistryEntry) => e.telemetry.lastAnyRun?.at ?? "";
  const name = (a: RegistryEntry, b: RegistryEntry) => a.profile.title.localeCompare(b.profile.title);
  return [...entries].sort((a, b) => {
    if (by === "name") return name(a, b);
    if (by === "recent") return last(b).localeCompare(last(a)) || name(a, b);
    return RANK[liveState(a)] - RANK[liveState(b)] || last(b).localeCompare(last(a)) || name(a, b);
  });
}

/** The latest run's label when it failed, which carries the error text the source returned. */
export function lastError(e: RegistryEntry): string | null {
  const latest = recentRuns(e, 1)[0];
  return latest?.result === "failure" ? latest.label : null;
}
