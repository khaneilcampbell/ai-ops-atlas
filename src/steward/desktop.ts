import { forgetEtags } from "../github/transport";
import { isAlertPath, type StewardRun } from "./check";
import type { StewardSchedule } from "./schedule";
import type { Notice, State, StewardClient } from "./store";

/** What `steward_state` and the other Rust commands return (src-tauri/src/steward/mod.rs). */
export interface DesktopSnapshot {
  paused: boolean;
  history: StewardRun[];
  schedule: StewardSchedule;
  notice: Notice | null;
  running: boolean;
  storageError: string | null;
  storageNote: string | null;
  waiting: string | null;
  error: string | null;
  lastObservedAt: string | null;
  stale: boolean;
}

export interface Bridge {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: (event: string, fn: () => void) => Promise<unknown>;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}

/** The key the browser-view runner saved under, imported once into the desktop runner. */
export const LEGACY_KEY = "atlas:steward:v1";
/** Set after the import. The old copy stays, so rolling back to an earlier build keeps its history. */
export const IMPORTED_KEY = "atlas:steward:imported";

const toState = (s: DesktopSnapshot): State => ({
  ...s,
  storageError: !!s.storageError,
  storageMessage: s.storageError,
  lockSupported: true,
});

const initial: State = {
  paused: false, history: [], schedule: { enabled: false, time: "09:00" }, notice: null, running: false,
  storageError: false, error: null, lockSupported: true, waiting: null,
};

/**
 * A thin client over the Rust runner. Every action returns Rust's new snapshot, and
 * `steward-changed` events cover scheduled runs and other windows.
 */
export function createDesktopStewardStore(bridge?: Bridge): StewardClient & { ready: Promise<void> } {
  const listeners = new Set<() => void>();
  let state = initial;
  const emit = () => listeners.forEach((fn) => fn());
  const take = (s: DesktopSnapshot) => { state = toState(s); emit(); };
  const failed = (message: string) => { state = { ...state, error: message }; emit(); };
  const get = async (): Promise<Bridge> => bridge ?? {
    invoke: (await import("@tauri-apps/api/core")).invoke,
    listen: (await import("@tauri-apps/api/event")).listen,
    storage: typeof localStorage === "undefined" ? null : localStorage,
  };
  const call = async (cmd: string, args?: Record<string, unknown>) => {
    try { take(await (await get()).invoke<DesktopSnapshot>(cmd, args)); } catch (e) { failed(typeof e === "string" ? e : "The desktop Steward did not respond. Restart Atlas and try again."); }
  };
  const refresh = () => call("steward_state");
  const ready = (async () => {
    const b = await get();
    // Earlier builds cached alert bodies in local storage; drop them.
    forgetEtags(isAlertPath);
    const legacy = b.storage?.getItem(LEGACY_KEY);
    if (legacy && !b.storage?.getItem(IMPORTED_KEY)) {
      // Rust imports only into an empty history and validates every run.
      try { await b.invoke<boolean>("steward_import", { legacy }); b.storage?.setItem(IMPORTED_KEY, new Date().toISOString()); } catch { /* retried next launch */ }
    }
    await b.listen("steward-changed", () => void refresh());
    await refresh();
  })().catch(() => failed("The desktop Steward could not start. Restart Atlas and try again."));
  return {
    ready,
    snapshot: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    pause: (paused) => void call("steward_pause", { paused }),
    configure: (enabled, time) => void call("steward_configure", { enabled, time }),
    dismiss: () => void call("steward_dismiss"),
    run: async () => {
      state = { ...state, running: true, error: null };
      emit();
      await call("steward_run");
    },
  };
}
