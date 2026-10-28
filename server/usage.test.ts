import { describe, expect, it } from "vitest";
import { pushUsage, readUsage, sameSecret, type Kv } from "./usage";

const SECRET = "s".repeat(43);
const kv = (): Kv & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v) };
};
const put = (body: unknown, token = SECRET) =>
  new Request("https://x.pages.dev/api/usage/push", { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("usage sync", () => {
  it("fails closed until the binding and secret exist", async () => {
    expect((await pushUsage(put({ records: [] }), {})).status).toBe(503);
    expect((await pushUsage(put({ records: [] }), { USAGE: kv() })).status).toBe(503);
  });

  it("refuses a wrong, missing or short key", async () => {
    const env = { USAGE: kv(), USAGE_SYNC_TOKEN: SECRET };
    expect((await pushUsage(put({ records: [] }, "nope"), env)).status).toBe(401);
    expect((await pushUsage(new Request("https://x/api/usage/push", { method: "PUT", body: "{}" }), env)).status).toBe(401);
    expect((await pushUsage(put({ records: [] }, "short"), { USAGE: kv(), USAGE_SYNC_TOKEN: "short" })).status).toBe(401);
    expect(env.USAGE.data.size).toBe(0);
  });

  it("stores a valid snapshot with the server's time and reads it back", async () => {
    const env = { USAGE: kv(), USAGE_SYNC_TOKEN: SECRET };
    const r = await pushUsage(put({ records: [{ at: "2026-10-28T00:00:00Z", provider: "anthropic" }] }), env, Date.UTC(2026, 9, 28, 5));
    expect(r.status).toBe(200);
    const read = await (await readUsage(env)).json();
    expect(read).toEqual({ configured: true, snapshot: { pushed_at: "2026-10-28T05:00:00.000Z", records: [{ at: "2026-10-28T00:00:00Z", provider: "anthropic" }] } });
  });

  it("rejects malformed bodies", async () => {
    const env = { USAGE: kv(), USAGE_SYNC_TOKEN: SECRET };
    expect((await pushUsage(put("not json"), env)).status).toBe(400);
    expect((await pushUsage(put({ rows: [] }), env)).status).toBe(400);
    expect((await pushUsage(put({ records: new Array(5001).fill({}) }), env)).status).toBe(413);
  });

  it("reports when nothing is set up or pushed", async () => {
    expect(await (await readUsage({})).json()).toEqual({ configured: false, snapshot: null });
    expect(await (await readUsage({ USAGE: kv() })).json()).toEqual({ configured: true, snapshot: null });
  });

  it("compares secrets fully", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
  });
});
