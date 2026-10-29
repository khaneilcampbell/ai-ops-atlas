import { checkSteward, type StewardRun } from "./check";
import { isHostedWeb, isTauri } from "../lib/env";
import { createDesktopStewardStore } from "./desktop";
import { changedChecks, DEFAULT_SCHEDULE, due, localDay, validTime, type StewardSchedule } from "./schedule";

export const STEWARD_STORAGE_KEY = "atlas:steward:v1";
const LOCK = "atlas:github-steward:run";
export interface Notice { runId: string; message: string }
interface Saved { paused: boolean; history: StewardRun[]; schedule: StewardSchedule; notice: Notice | null }
export interface State extends Saved {
  running: boolean; storageError: boolean; error: string | null; lockSupported: boolean; waiting: string | null;
  /** Desktop runner only: what went wrong with storage, a one-time recovery note, and staleness. */
  storageMessage?: string | null; storageNote?: string | null; lastObservedAt?: string | null; stale?: boolean;
}
/** The panel's view of the Steward, whether it runs in the web view or in the desktop app's Rust side. */
export interface StewardClient {
  snapshot: () => State;
  subscribe: (fn: () => void) => () => void;
  pause: (paused: boolean) => void;
  configure: (enabled: boolean, time: string) => void;
  dismiss: () => void;
  run: () => Promise<void>;
}
interface Dependencies {
  storage: Pick<Storage, "getItem" | "setItem">;
  lock: ((work: () => Promise<void>) => Promise<boolean>) | null;
  collect: typeof checkSteward;
  now: () => Date;
  /** Why this run may not start yet, checked before the daily claim. Null lets it proceed. */
  blocked?: (trigger: "manual" | "schedule") => Promise<string | null>;
}
const empty = (): Saved => ({ paused: false, history: [], schedule: { ...DEFAULT_SCHEDULE }, notice: null });
function decode(raw: string | null): Saved {
  const data = JSON.parse(raw ?? "null");
  const history: StewardRun[] = Array.isArray(data?.history) ? data.history.filter((r: StewardRun) => r && typeof r.id === "string" && typeof r.finishedAt === "string" && Array.isArray(r.checks) && r.checks.every((c) => c && typeof c.label === "string" && typeof c.detail === "string" && typeof c.url === "string" && c.url.startsWith("https://github.com/") && ["clear", "attention", "unknown"].includes(c.state))).slice(0, 30) : [];
  const schedule = data?.schedule;
  return {
    paused: data?.paused === true, history,
    schedule: schedule && validTime(schedule.time) ? { enabled: schedule.enabled === true, time: schedule.time, lastAttemptDay: typeof schedule.lastAttemptDay === "string" ? schedule.lastAttemptDay : undefined } : { ...DEFAULT_SCHEDULE },
    notice: typeof data?.notice?.message === "string" && typeof data.notice.runId === "string" ? data.notice : null,
  };
}

/** Named Web Lock + persisted daily claim coordinate same-origin windows; no cross-device guarantee. */
export function createStewardStore(deps: Dependencies): StewardClient & { sync: () => void; tick: () => Promise<void>; run: (trigger?: "manual" | "schedule") => Promise<void> } {
  const listeners = new Set<() => void>();
  let state: State = { ...empty(), running: false, storageError: false, error: null, lockSupported: !!deps.lock, waiting: null };
  let cached: string | null | undefined;
  let cancelled = false;
  let activeTrigger: "manual" | "schedule" | null = null;
  const emit = () => listeners.forEach((fn) => fn());
  const sync = () => {
    try {
      const raw = deps.storage.getItem(STEWARD_STORAGE_KEY);
      if (raw !== cached) {
        const saved = decode(raw);
        if (saved.paused || (activeTrigger === "schedule" && !saved.schedule.enabled)) cancelled = true;
        cached = raw;
        state = { ...state, ...saved, storageError: false };
        emit();
      }
    } catch { state = { ...state, storageError: true }; cancelled = true; emit(); }
  };
  const save = (patch: Partial<Saved>): boolean => {
    sync();
    state = { ...state, ...patch };
    const { paused, history, schedule, notice } = state;
    try {
      const raw = JSON.stringify({ paused, history, schedule, notice });
      deps.storage.setItem(STEWARD_STORAGE_KEY, raw);
      cached = raw;
      state = { ...state, storageError: false };
      emit();
      return true;
    } catch { state = { ...state, storageError: true }; emit(); return false; }
  };
  sync();
  const run = async (trigger: "manual" | "schedule" = "manual") => {
    sync();
    if (state.running || state.paused) return;
    if (trigger === "schedule" && (state.storageError || !due(state.schedule, deps.now()))) return;
    if (!deps.lock) { state = { ...state, error: "This environment cannot coordinate safe checks across windows. Monitoring is blocked." }; emit(); return; }
    // A blocked scheduled run leaves the day unclaimed, so it runs once the cause clears.
    const waiting = (await deps.blocked?.(trigger).catch(() => "Atlas could not confirm its credentials, so the check did not start.")) ?? null;
    if (waiting !== state.waiting) { state = { ...state, waiting }; emit(); }
    if (waiting) return;
    state = { ...state, running: true, error: null };
    emit();
    try {
      const acquired = await deps.lock(async () => {
        sync();
        if (state.paused || state.storageError) return;
        if (trigger === "schedule") {
          if (!due(state.schedule, deps.now())) return;
          // Claim before network access. A crash or interruption never causes an automatic same-day retry.
          if (!save({ schedule: { ...state.schedule, lastAttemptDay: localDay(deps.now()) } })) return;
        }
        cancelled = false;
        activeTrigger = trigger;
        let result: StewardRun;
        try {
          result = await deps.collect({ stopped: () => { sync(); return cancelled || state.paused || state.storageError; } });
        } catch {
          const at = deps.now().toISOString();
          result = { id: `${deps.now().getTime()}`, startedAt: at, finishedAt: at, status: "failed", checks: [], requests: 0 };
        }
        sync();
        const previous = state.history.find((r) => r.status === "completed" || r.status === "partial");
        const changed = changedChecks(previous, result);
        if (state.history[0]?.status === "failed" && result.status !== "failed" && result.status !== "paused") changed.unshift("Check execution recovered");
        const notice = result.status === "failed" && state.history[0]?.status !== "failed" ? { runId: result.id, message: "GitHub Steward could not finish its check. Review run history." } : changed.length ? { runId: result.id, message: `${previous ? "GitHub Steward changed" : "GitHub Steward baseline needs review"}: ${changed.join(", ")}.` } : state.notice;
        save({ history: [{ ...result, trigger, changes: changed }, ...state.history].slice(0, 30), notice });
      });
      if (!acquired) state = { ...state, error: trigger === "manual" ? "Another Atlas window is checking. Try again after it finishes." : null };
    } catch { state = { ...state, error: "The check could not start safely. Check browser permissions and local storage." }; }
    finally { activeTrigger = null; state = { ...state, running: false }; emit(); }
  };
  return {
    snapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    sync,
    pause: (paused: boolean) => { if (paused) cancelled = true; save({ paused }); },
    configure: (enabled: boolean, time: string) => {
      if (!validTime(time)) return;
      sync();
      if (!enabled && activeTrigger === "schedule") cancelled = true;
      save({ schedule: { ...state.schedule, enabled, time } });
    },
    dismiss: () => { save({ notice: null }); },
    run,
    tick: () => run("schedule"),
  };
}

const browserLock = typeof navigator !== "undefined" && navigator.locks
  ? (work: () => Promise<void>) => navigator.locks.request(LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => { if (!lock) return false; await work(); return true; })
  : null;
export const HOSTED_WEB_REASON = "GitHub Steward runs in the desktop app. The website's read-only proxy does not serve security alerts or repository files, so checks here could only be partial.";
/** The hosted site never runs checks. (The desktop app's runner holds scheduled runs while its keys are locked.) */
async function stewardBlocked(): Promise<string | null> {
  return isHostedWeb() ? HOSTED_WEB_REASON : null;
}
const browserStore = isTauri() ? null : createStewardStore({
  storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  lock: browserLock, collect: checkSteward, now: () => new Date(), blocked: stewardBlocked,
});
/** Desktop: the Rust runner (src-tauri/src/steward). Browser preview: the web-view runner above. */
export const stewardStore: StewardClient = browserStore ?? createDesktopStewardStore();

/** Mount inside the unlocked app, independent of the selected view. Timers resume on focus/wake. */
export function startStewardScheduler() {
  // The desktop app schedules in Rust; the hosted site never runs checks.
  if (!browserStore || isHostedWeb()) return;
  const stewardStore = browserStore;
  const tick = () => { void stewardStore.tick(); };
  const storage = (event: StorageEvent) => { if (event.key === STEWARD_STORAGE_KEY || event.key === null) stewardStore.sync(); };
  const timer = setInterval(tick, 60_000);
  window.addEventListener("storage", storage);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  tick();
  return () => {
    clearInterval(timer);
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", tick);
    document.removeEventListener("visibilitychange", tick);
  };
}
