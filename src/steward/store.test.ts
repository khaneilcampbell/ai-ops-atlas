import { describe, expect, it, vi } from "vitest";
import { createStewardStore, STEWARD_STORAGE_KEY } from "./store";
import type { StewardRun } from "./check";

const result = (state: "clear" | "unknown" = "clear"): StewardRun => ({ id: "r1", startedAt: "2026-10-28T09:00:00Z", finishedAt: "2026-10-28T09:00:01Z", status: state === "unknown" ? "partial" : "completed", requests: 1, checks: [{ id: "ci", label: "CI", state, detail: state, url: "https://github.com/khaneilcampbell/ai-ops-atlas/actions" }] });
function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  let busy = false;
  const lock = async (work: () => Promise<void>) => { if (busy) return false; busy = true; try { await work(); return true; } finally { busy = false; } };
  let date = new Date(2026, 9, 28, 10);
  const collect = vi.fn(async () => result());
  const deps = { storage, lock, collect, now: () => date };
  return { data, storage, deps, collect, nextDay: () => { date = new Date(2026, 9, 29, 10); } };
}

describe("Steward scheduling and persistence", () => {
  it("defaults to off and saves an enabled schedule and daily claim before collection", async () => {
    const f = fixture(); const store = createStewardStore(f.deps);
    await store.tick(); expect(f.collect).not.toHaveBeenCalled();
    store.configure(true, "09:00");
    f.collect.mockImplementation(async () => {
      expect(JSON.parse(f.storage.getItem(STEWARD_STORAGE_KEY)!).schedule.lastAttemptDay).toBe("2026-10-28");
      return result();
    });
    await store.tick(); await store.tick();
    const reloaded = createStewardStore(f.deps); await reloaded.tick();
    expect(f.collect).toHaveBeenCalledTimes(1);
    expect(reloaded.snapshot().history[0].trigger).toBe("schedule");
    f.nextDay(); await reloaded.tick(); expect(f.collect).toHaveBeenCalledTimes(2);
  });
  it("coordinates different windows, preventing both overlapping and duplicate daily runs", async () => {
    const f = fixture(); const first = createStewardStore(f.deps); const second = createStewardStore(f.deps);
    first.configure(true, "09:00");
    let release!: () => void;
    f.collect.mockImplementation(() => new Promise((resolve) => { release = () => resolve(result()); }));
    const pending = first.tick(); await second.tick();
    expect(f.collect).toHaveBeenCalledTimes(1);
    release(); await pending; await second.tick();
    expect(f.collect).toHaveBeenCalledTimes(1);
    expect(second.snapshot().history).toHaveLength(1);
  });
  it("blocks network calls when a shared lock or persistent storage is unavailable", async () => {
    const f = fixture(); const noLock = createStewardStore({ ...f.deps, lock: null });
    await noLock.run(); expect(f.collect).not.toHaveBeenCalled();
    const broken = createStewardStore({ ...f.deps, storage: { ...f.storage, setItem: () => { throw new Error("quota"); } } });
    broken.configure(true, "09:00"); await broken.tick();
    expect(f.collect).not.toHaveBeenCalled(); expect(broken.snapshot().storageError).toBe(true);
  });
  it("latches a cross-window pause for the in-flight run even when resumed before its next read", async () => {
    const f = fixture();
    const second = createStewardStore(f.deps);
    const first = createStewardStore({ ...f.deps, collect: async (options) => {
      second.pause(true); first.sync(); second.pause(false); first.sync();
      expect(options?.stopped?.()).toBe(true);
      return { ...result(), status: "paused" };
    } });
    await first.run();
    expect(first.snapshot().history[0].status).toBe("paused");
  });

  it("saves failed attempts, makes no scheduled retries, and reports execution recovery", async () => {
    const f = fixture(); const store = createStewardStore(f.deps); store.configure(true, "09:00");
    f.collect.mockRejectedValue(new Error("unexpected"));
    await store.tick(); await store.tick();
    expect(f.collect).toHaveBeenCalledTimes(1); expect(store.snapshot().history[0].status).toBe("failed");
    store.dismiss(); await store.run(); expect(store.snapshot().notice).toBeNull();
    f.collect.mockResolvedValue(result()); await store.run();
    expect(store.snapshot().notice?.message).toContain("recovered");
  });
  it("does not repeat dismissed notices for unchanged partial results and notifies on recovery", async () => {
    const f = fixture(); f.collect.mockResolvedValue(result("unknown"));
    const store = createStewardStore(f.deps); await store.run();
    expect(store.snapshot().notice?.message).toContain("baseline");
    store.dismiss(); await store.run(); expect(store.snapshot().notice).toBeNull();
    f.collect.mockResolvedValue(result()); await store.run();
    expect(store.snapshot().notice?.message).toContain("changed");
  });
  it("bounds history and preserves schedule and Pause through reload", async () => {
    const f = fixture(); const store = createStewardStore(f.deps);
    store.configure(true, "11:30");
    for (let i = 0; i < 35; i++) await store.run();
    store.pause(true);
    const reloaded = createStewardStore(f.deps);
    expect(reloaded.snapshot().history).toHaveLength(30);
    expect(reloaded.snapshot().paused).toBe(true);
    expect(reloaded.snapshot().schedule).toMatchObject({ enabled: true, time: "11:30" });
    await reloaded.tick(); expect(f.collect).toHaveBeenCalledTimes(35);
  });
  it("waits without claiming the day while blocked, then runs once the cause clears", async () => {
    const f = fixture();
    let reason: string | null = "keys locked";
    const blocked = vi.fn(async () => reason);
    const store = createStewardStore({ ...f.deps, blocked });
    store.configure(true, "09:00");
    await store.tick(); await store.tick();
    expect(f.collect).not.toHaveBeenCalled();
    expect(store.snapshot().waiting).toBe("keys locked");
    expect(JSON.parse(f.storage.getItem(STEWARD_STORAGE_KEY)!).schedule.lastAttemptDay).toBeUndefined();
    reason = null; await store.tick(); await store.tick();
    expect(f.collect).toHaveBeenCalledTimes(1);
    expect(store.snapshot().waiting).toBeNull();
  });
  it("fails closed when the credential check itself fails", async () => {
    const f = fixture();
    const store = createStewardStore({ ...f.deps, blocked: async () => { throw new Error("ipc"); } });
    store.configure(true, "09:00"); await store.tick(); await store.run();
    expect(f.collect).not.toHaveBeenCalled();
    expect(store.snapshot().waiting).toContain("did not start");
  });
});
