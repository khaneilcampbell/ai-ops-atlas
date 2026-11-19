import { load, save } from "../lib/storage";

/**
 * When Atlas first saw each run, and each run in each state, kept across reloads. The city routine
 * anchors on these times, so a reload draws the same picture instead of replaying a completion or
 * restarting work. Holds ids and times only. Bounded: entries older than a week are dropped.
 */
export const LEDGER_KEY = "routine-ledger";
const KEEP_MS = 7 * 86_400_000;
const MAX = 800;
/** A run already finished this long before Atlas first sees it is history: it is dated by its stop time, not "now". */
export const HISTORY_MS = 10 * 60_000;

export interface Sighting {
  /** Run key (operations.ts), e.g. "n8n:<workflow>:<execution>". */
  key: string;
  status: string;
  finished: boolean;
  stoppedAt: number | null;
  startedAt: number | null;
}

export type Ledger = Map<string, number>;

export function loadLedger(): Ledger {
  const raw = load<[string, number][]>(LEDGER_KEY, []);
  return new Map(Array.isArray(raw) ? raw.filter((e) => Array.isArray(e) && typeof e[0] === "string" && Number.isFinite(e[1])) : []);
}

export function saveLedger(l: Ledger) {
  save(LEDGER_KEY, [...l.entries()]);
}

/**
 * Records first sightings of runs and of their current state. Returns true when anything was added.
 * A run first seen long after it stopped is dated by its own times, so loading Atlas after a quiet
 * night doesn't play the night's work as if it just happened.
 */
export function observe(l: Ledger, seen: readonly Sighting[], now: number): boolean {
  let changed = false;
  for (const s of seen) {
    const historic = s.finished && s.stoppedAt !== null && now - s.stoppedAt > HISTORY_MS;
    const first = historic ? (s.startedAt ?? s.stoppedAt!) : now;
    if (!l.has(s.key)) {
      l.set(s.key, first);
      changed = true;
    }
    const k = `${s.key}:${s.status}`;
    if (!l.has(k)) {
      l.set(k, historic ? s.stoppedAt! : now);
      changed = true;
    }
  }
  if (changed) prune(l, now);
  return changed;
}

export function prune(l: Ledger, now: number) {
  for (const [k, t] of l) if (now - t > KEEP_MS) l.delete(k);
  if (l.size > MAX) [...l.entries()].sort((a, b) => a[1] - b[1]).slice(0, l.size - MAX).forEach(([k]) => l.delete(k));
}
