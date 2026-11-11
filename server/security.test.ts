import { describe, expect, it } from "vitest";
import type { CheckCache } from "./properties";
import { countAlerts, readSecurity, readSecurityForApp, requestedRepos, securitySnapshot, severityOf } from "./security";

const TOKEN = "github_pat_" + "t".repeat(40);
const SYNC = "s".repeat(43);
const ENV = { GITHUB_TOKEN: TOKEN, ALLOWED_OWNERS: "khaneilcampbell", USAGE_SYNC_TOKEN: SYNC };

const memCache = (): CheckCache => {
  const m = new Map<string, unknown>();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) };
};

type Answer = { status: number; body: unknown };
function fakeFetch(answer: (url: string) => Answer) {
  const calls: { url: string; auth: string | null; method: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization"), method: init?.method ?? "GET" });
    const a = answer(url);
    return Response.json(a.body, { status: a.status });
  }) as typeof fetch;
  return { f, calls };
}

const DEPENDABOT = [
  { number: 3, state: "open", security_advisory: { severity: "high", summary: "secret advisory text" }, dependency: { manifest_path: "package-lock.json" } },
  { number: 2, state: "open", security_advisory: { severity: "moderate" } },
];
const CODE = [{ number: 9, rule: { security_severity_level: "critical", description: "x" }, most_recent_instance: { location: { path: "src/a.ts" } } }];

describe("GitHub security alerts on the site", () => {
  it("keeps only well-formed repositories of allowed owners, at most 20", () => {
    expect(requestedRepos("repos=khaneilcampbell/ai-ops-atlas,someone/else,../x,khaneilcampbell/benjaire.com,khaneilcampbell/ai-ops-atlas", ENV))
      .toEqual(["khaneilcampbell/ai-ops-atlas", "khaneilcampbell/benjaire.com"]);
    const many = Array.from({ length: 30 }, (_, i) => `khaneilcampbell/r${i}`).join(",");
    expect(requestedRepos(`repos=${many}`, ENV)).toHaveLength(20);
  });

  it("reads severities from each feed's own field", () => {
    expect(severityOf("dependabot", DEPENDABOT[1])).toBe("medium");
    expect(severityOf("code-scanning", CODE[0])).toBe("critical");
    expect(severityOf("code-scanning", { rule: { severity: "warning" } })).toBe("medium");
    expect(severityOf("secret-scanning", { secret_type: "aws" })).toBeNull();
    expect(countAlerts("dependabot", DEPENDABOT)).toEqual({ state: "ok", open: 2, more: false, severity: { high: 1, medium: 1 } });
  });

  it("returns counts only, never alert text, and only makes GET requests with the site token", async () => {
    const { f, calls } = fakeFetch((url) => url.includes("dependabot") ? { status: 200, body: DEPENDABOT } : url.includes("code-scanning") ? { status: 200, body: CODE } : { status: 200, body: [] });
    const snap = await securitySnapshot(["khaneilcampbell/ai-ops-atlas"], ENV, memCache(), f, Date.parse("2026-11-10T19:00:00Z"));
    expect(snap).toEqual({ state: "ok", fetchedAt: "2026-11-10T19:00:00.000Z", repos: [{ repo: "khaneilcampbell/ai-ops-atlas", feeds: {
      dependabot: { state: "ok", open: 2, more: false, severity: { high: 1, medium: 1 } },
      "code-scanning": { state: "ok", open: 1, more: false, severity: { critical: 1 } },
      "secret-scanning": { state: "ok", open: 0, more: false, severity: {} },
    } }] });
    expect(JSON.stringify(snap)).not.toMatch(/advisory text|package-lock|src\/a\.ts/);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.method === "GET" && c.auth === `Bearer ${TOKEN}` && c.url.includes("state=open"))).toBe(true);
  });

  it("tells a switched-off feed and a token without access apart from a failure", async () => {
    const { f } = fakeFetch((url) => url.includes("dependabot") ? { status: 403, body: { message: "Dependabot alerts are disabled for this repository." } }
      : url.includes("code-scanning") ? { status: 403, body: { message: "Resource not accessible by personal access token" } }
      : { status: 500, body: {} });
    const snap = await securitySnapshot(["khaneilcampbell/benjaire.com"], ENV, null, f);
    expect(snap.state === "ok" && snap.repos[0].feeds).toEqual({
      dependabot: { state: "off", reason: "Not switched on for this repository." },
      "code-scanning": { state: "no-access", reason: "The site's GitHub token can't read these alerts." },
      "secret-scanning": { state: "error", reason: "GitHub answered 500." },
    });
  });

  it("asks for a token instead of guessing, and reuses a cached answer", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: [] }));
    expect(await securitySnapshot(["khaneilcampbell/x"], { ALLOWED_OWNERS: "khaneilcampbell" }, null, f)).toMatchObject({ state: "not-configured" });
    expect(calls).toHaveLength(0);
    const cache = memCache();
    await securitySnapshot(["khaneilcampbell/x"], ENV, cache, f);
    await securitySnapshot(["khaneilcampbell/x"], ENV, cache, f);
    expect(calls).toHaveLength(3);
  });

  it("refuses an empty list and checks the Mac app's sync key", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: [] }));
    expect((await readSecurity(new Request("https://atlas.example/api/security?repos=someone/else"), ENV, null, f)).status).toBe(400);
    const bad = new Request("https://atlas.example/api/hooks/security?repos=khaneilcampbell/x", { headers: { authorization: "Bearer wrong" } });
    expect((await readSecurityForApp(bad, ENV, null, f)).status).toBe(401);
    expect((await readSecurityForApp(bad, { ...ENV, USAGE_SYNC_TOKEN: undefined }, null, f)).status).toBe(503);
    expect(calls).toHaveLength(0);
    const good = new Request("https://atlas.example/api/hooks/security?repos=khaneilcampbell/x", { headers: { authorization: `Bearer ${SYNC}` } });
    const r = await readSecurityForApp(good, ENV, null, f);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
