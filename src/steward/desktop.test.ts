import { describe, expect, it, vi } from "vitest";
import { createDesktopStewardStore, IMPORTED_KEY, LEGACY_KEY, type Bridge, type DesktopSnapshot } from "./desktop";

const snap = (over: Partial<DesktopSnapshot> = {}): DesktopSnapshot => ({
  paused: false, history: [], schedule: { enabled: false, time: "09:00" }, notice: null, running: false,
  storageError: null, storageNote: null, waiting: null, error: null, lastObservedAt: null, stale: false, ...over,
});

function bridge(answers: Record<string, unknown>, legacy: string | null = null) {
  const data = new Map<string, string>(legacy ? [[LEGACY_KEY, legacy]] : []);
  let changed: () => void = () => {};
  const invoke = vi.fn(async (cmd: string) => {
    const a = answers[cmd];
    if (a instanceof Error) throw a.message;
    return a ?? snap();
  });
  const b: Bridge = {
    invoke: invoke as Bridge["invoke"],
    listen: async (_e, fn) => { changed = fn; },
    storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } },
  };
  return { b, invoke, data, fire: () => changed() };
}

describe("desktop Steward client", () => {
  it("imports browser history once and keeps the old copy for rollback", async () => {
    const t = bridge({ steward_import: true }, "{\"history\":[]}");
    await createDesktopStewardStore(t.b).ready;
    await createDesktopStewardStore(t.b).ready;
    expect(t.invoke.mock.calls.filter(([c]) => c === "steward_import")).toEqual([["steward_import", { legacy: "{\"history\":[]}" }]]);
    expect(t.data.has(LEGACY_KEY)).toBe(true);
  });

  it("retries next launch when the import fails", async () => {
    const t = bridge({ steward_import: new Error("Unreadable legacy history") }, "{bad");
    await createDesktopStewardStore(t.b).ready;
    expect(t.data.has(IMPORTED_KEY)).toBe(false);
  });

  it("shows Rust's storage problem, staleness and scheduled-run updates", async () => {
    const t = bridge({ steward_state: snap({ storageError: "Steward history could not be saved", stale: true }) });
    const s = createDesktopStewardStore(t.b);
    await s.ready;
    expect(s.snapshot()).toMatchObject({ storageError: true, storageMessage: "Steward history could not be saved", stale: true });
    (t.invoke as ReturnType<typeof vi.fn>).mockImplementation(async () => snap({ waiting: "keys locked" }));
    t.fire();
    await vi.waitFor(() => expect(s.snapshot().waiting).toBe("keys locked"));
  });

  it("passes actions to Rust and surfaces its refusals", async () => {
    const t = bridge({ steward_configure: new Error("Choose a time as HH:MM.") });
    const s = createDesktopStewardStore(t.b);
    await s.ready;
    s.configure(true, "25:00");
    await vi.waitFor(() => expect(s.snapshot().error).toBe("Choose a time as HH:MM."));
    s.pause(true);
    await vi.waitFor(() => expect(t.invoke).toHaveBeenCalledWith("steward_pause", { paused: true }));
  });
});
