import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, createBackup, parseBackup, planRestore, restoreBackup, undoAvailable, undoRestore, UNDO_KEY, type KeyValueStore } from "./backup";

/** An isolated in-memory store: tests never touch a real browser's storage. */
function memStore(init: Record<string, string> = {}, failOn?: string): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (failOn && k === failOn) throw new Error("quota");
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
}

const NOW = new Date("2026-11-16T12:00:00Z");
const tasks = JSON.stringify({ rev: 3, tasks: [{ id: "t1", title: "Ship" }] });

describe("device backup", () => {
  it("saves durable records and leaves caches and other apps' keys out", () => {
    const s = memStore({ "atlas:tasks": tasks, "atlas:settings": '{"a":1}', "atlas:repoCache": '{"big":true}', "atlas:etags": "{}", "other:thing": '"x"' });
    const b = createBackup(s, "web", NOW);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.keys).toEqual(["settings", "tasks"]);
    expect(b.backup).toMatchObject({ format: BACKUP_FORMAT, version: 1, createdAt: NOW.toISOString() });
  });

  it("refuses to write a file holding anything shaped like a credential", () => {
    const s = memStore({ "atlas:settings": JSON.stringify({ note: "ghp_" + "a".repeat(36) }) });
    const b = createBackup(s, "web", NOW);
    expect(b.ok).toBe(false);
  });

  it("round-trips: restore into an empty device gives the same records back", () => {
    const src = memStore({ "atlas:tasks": tasks, "atlas:workflow-exec": '{"rev":1}' });
    const b = createBackup(src, "mac", NOW);
    if (!b.ok) throw new Error(b.error);
    const parsed = parseBackup(b.json);
    if (!parsed.ok) throw new Error(parsed.error);
    const dest = memStore();
    const r = restoreBackup(dest, parsed.backup, NOW);
    expect(r.ok).toBe(true);
    expect(dest.getItem("atlas:tasks")).toBe(tasks);
    expect(dest.getItem("atlas:workflow-exec")).toBe('{"rev":1}');
  });

  it("plans the change, restores, and can undo back to exactly what was there", () => {
    const backup = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: NOW.toISOString(), app: "web", entries: { tasks, settings: '{"a":1}' } }));
    if (!backup.ok) throw new Error(backup.error);
    const s = memStore({ "atlas:tasks": '{"rev":9,"tasks":[]}', "atlas:business": '{"rev":1}', "atlas:settings": '{"a":1}', "atlas:repoCache": '{"keep":1}' });
    expect(planRestore(s, backup.backup)).toEqual({ write: ["tasks"], remove: ["business"], unchanged: ["settings"] });
    expect(restoreBackup(s, backup.backup, NOW).ok).toBe(true);
    expect(s.getItem("atlas:tasks")).toBe(tasks);
    expect(s.getItem("atlas:business")).toBeNull();
    expect(s.getItem("atlas:repoCache")).toBe('{"keep":1}');
    expect(undoAvailable(s)).not.toBeNull();
    expect(undoRestore(s).ok).toBe(true);
    expect(s.getItem("atlas:tasks")).toBe('{"rev":9,"tasks":[]}');
    expect(s.getItem("atlas:business")).toBe('{"rev":1}');
    expect(s.getItem(UNDO_KEY)).toBeNull();
  });

  it("puts the previous records back if a write fails part way", () => {
    const backup = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: NOW.toISOString(), app: "web", entries: { tasks, "workflow-exec": '{"rev":2}' } }));
    if (!backup.ok) throw new Error(backup.error);
    const s = memStore({ "atlas:tasks": '{"rev":1}' }, "atlas:workflow-exec");
    const r = restoreBackup(s, backup.backup, NOW);
    expect(r.ok).toBe(false);
    expect(s.getItem("atlas:tasks")).toBe('{"rev":1}');
  });

  it.each([
    ["not json", "{"],
    ["wrong format", JSON.stringify({ format: "x", version: 1, createdAt: NOW.toISOString(), entries: {} })],
    ["newer version", JSON.stringify({ format: BACKUP_FORMAT, version: 2, createdAt: NOW.toISOString(), entries: {} })],
    ["cache key", JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: NOW.toISOString(), entries: { repoCache: "{}" } })],
    ["damaged entry", JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: NOW.toISOString(), entries: { tasks: "{oops" } })],
    ["odd key", JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: NOW.toISOString(), entries: { "../x": "{}" } })],
    ["credential", JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: NOW.toISOString(), entries: { settings: JSON.stringify({ k: "sk-ant-" + "z".repeat(30) }) } })],
  ])("rejects a bad file before changing anything: %s", (_name, text) => {
    expect(parseBackup(text).ok).toBe(false);
  });
});
