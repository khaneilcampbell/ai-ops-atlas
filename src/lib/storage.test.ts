import { beforeEach, describe, expect, it, vi } from "vitest";

// A local storage that refuses writes past a size limit, like the Mac app's (about 5 MB).
const data = new Map<string, string>();
let limit = 1000;
const used = () => [...data.values()].reduce((n, v) => n + v.length, 0);
vi.stubGlobal("localStorage", {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    const without = used() - (data.get(key)?.length ?? 0);
    if (without + value.length > limit) throw new DOMException("full", "QuotaExceededError");
    data.set(key, value);
  },
  removeItem: (key: string) => void data.delete(key),
  clear: () => data.clear(),
});

const { save, load, writeWithRoom } = await import("./storage");
const { trimEtags } = await import("../github/transport");

describe("local storage when it is full", () => {
  beforeEach(() => {
    data.clear();
    limit = 1000;
  });

  it("drops the GitHub caches so a workflow run can still be saved", () => {
    data.set("atlas:etags", "x".repeat(600));
    data.set("atlas:repoCache", "y".repeat(300));
    data.set("atlas:settings", "{}");
    writeWithRoom("atlas:workflow-runs", "r".repeat(500));
    expect(data.get("atlas:workflow-runs")).toHaveLength(500);
    expect(data.has("atlas:etags")).toBe(false);
    expect(data.has("atlas:repoCache")).toBe(false);
    expect(data.get("atlas:settings")).toBe("{}");
  });

  it("still throws when there is nothing left to drop, so the page can say so", () => {
    data.set("atlas:tasks", "t".repeat(900));
    expect(() => writeWithRoom("atlas:workflow-runs", "r".repeat(500))).toThrow();
    expect(data.get("atlas:tasks")).toHaveLength(900);
  });

  it("never drops the cache it is writing", () => {
    data.set("atlas:repoCache", "y".repeat(400));
    save("etags", { a: "z".repeat(700) });
    expect(load<Record<string, string>>("etags", {}).a).toHaveLength(700);
    expect(data.has("atlas:repoCache")).toBe(false);
  });

  it("keeps the GitHub response cache under its budget, newest kept", () => {
    const cache: Record<string, { etag: string; body: unknown }> = {};
    for (let i = 0; i < 50; i++) cache[`/repos/r${i}`] = { etag: `e${i}`, body: "b".repeat(100) };
    const json = trimEtags(cache, 2000);
    expect(json.length).toBeLessThanOrEqual(2000);
    expect(cache["/repos/r49"]).toBeDefined();
    expect(cache["/repos/r0"]).toBeUndefined();
  });
});
