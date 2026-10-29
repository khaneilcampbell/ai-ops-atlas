import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({ isTauri: () => false, isHostedWeb: () => false }));

const data = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); },
  removeItem: (key: string) => { data.delete(key); },
});
const alerts = "/repos/khaneilcampbell/ai-ops-atlas/dependabot/alerts?state=open&per_page=20";
const other = "/repos/khaneilcampbell/other/commits?per_page=10";
// What an earlier build left behind: an alert body in the cache, beside an unrelated entry.
data.set("atlas:etags", JSON.stringify({
  [alerts]: { etag: "\"old\"", body: [{ number: 1, security_advisory: { summary: "private advisory detail" } }] },
  [other]: { etag: "\"keep\"", body: [] },
}));

const { stewardGet } = await import("./check");
const { githubGet } = await import("../github/transport");

afterEach(() => { vi.useRealTimers(); });

describe("Steward keeps private findings off disk", () => {
  it("purges cached alert bodies and never caches or revalidates its own reads", async () => {
    const seen: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return Response.json([{ number: 2, security_advisory: { summary: "new private detail" } }], { headers: { etag: "\"new\"" } });
    }));
    await stewardGet(alerts);
    await stewardGet("/repos/khaneilcampbell/ai-ops-atlas/readme");
    const disk = data.get("atlas:etags") ?? "";
    expect(disk).not.toContain("private");
    expect(disk).not.toContain("ai-ops-atlas");
    expect(JSON.parse(disk)).toHaveProperty([other]);
    expect(seen.every((h) => !h.has("If-None-Match"))).toBe(true);
  });

  it("leaves the shared cache working for ordinary reads", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ name: "r" }, { headers: { etag: "\"e\"" } })));
    await githubGet("/repos/o/r");
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();
    expect(JSON.parse(data.get("atlas:etags") ?? "{}")).toHaveProperty(["/repos/o/r"]);
  });
});
