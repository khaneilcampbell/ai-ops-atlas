import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { D1, D1Statement } from "./live";
import { ensureSchema } from "./live";
import { logEvent, redact, REDACTED, requestIdOf } from "./log";
import { crossSiteWrite } from "./origin";
import { handle } from "./middleware";
import { credentialStatus, healthReport, readHealthForApp, type HealthEnv } from "./health";
import { overallState } from "../src/observability/health";

/** D1 on a real in-memory SQLite, so the SQL itself is tested. */
function sqliteD1(): D1 & { raw: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => db.prepare(sql).run(...(args as never[])),
    all: async <T,>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
}

const NOW = Date.parse("2026-11-16T12:00:00Z");
const GH_TOKEN = "ghp_" + "a".repeat(36);
const SYNC = "s".repeat(40);

describe("redacted logs", () => {
  it("never prints a secret-named field or a token-shaped string", () => {
    const lines: string[] = [];
    logEvent({ event: "auth.denied", severity: "warn", service: "test", authorization: `Bearer ${GH_TOKEN}`, nested: { apiKey: "x", note: `token ${GH_TOKEN} and sk-ant-${"b".repeat(30)}` }, detail: `header Bearer abc.def` }, (l) => lines.push(l), NOW);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).not.toContain(GH_TOKEN);
    expect(line).not.toContain("sk-ant-");
    expect(line).not.toContain("abc.def");
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ at: "2026-11-16T12:00:00.000Z", event: "auth.denied", severity: "warn", authorization: REDACTED, nested: { apiKey: REDACTED } });
  });

  it("masks JWTs and PEM keys, caps long strings, and survives cycles of depth", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl";
    const out = redact({ a: jwt, b: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", c: "x".repeat(2000), d: { e: { f: { g: { h: { i: 1 } } } } } }) as Record<string, unknown>;
    expect(out.a).toBe(REDACTED);
    expect(out.b).toBe(REDACTED);
    expect((out.c as string).length).toBeLessThan(510);
    expect(JSON.stringify(out.d)).toContain("[truncated]");
  });

  it("uses Cloudflare's ray id as the correlation id when present", () => {
    expect(requestIdOf(new Request("https://x/", { headers: { "cf-ray": "8f00aa11bb22cc33-EWR" } }))).toBe("8f00aa11bb22cc33-EWR");
    expect(requestIdOf(new Request("https://x/", { headers: { "cf-ray": "bad id with spaces" } }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("cross-site writes", () => {
  const req = (method: string, headers: Record<string, string> = {}) => new Request("https://atlas.example/api/n8n/steps", { method, headers });
  it("refuses a change a browser marks as coming from another site", () => {
    expect(crossSiteWrite(req("POST", { "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(crossSiteWrite(req("POST", { "sec-fetch-site": "same-site" }))).toBe(true);
    expect(crossSiteWrite(req("POST", { origin: "https://evil.example" }))).toBe(true);
    expect(crossSiteWrite(req("POST", { origin: "null" }))).toBe(true);
  });
  it("allows the page itself, reads, and non-browser clients", () => {
    expect(crossSiteWrite(req("POST", { "sec-fetch-site": "same-origin", origin: "https://atlas.example" }))).toBe(false);
    expect(crossSiteWrite(req("POST", { origin: "https://atlas.example" }))).toBe(false);
    expect(crossSiteWrite(req("GET", { "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(crossSiteWrite(req("POST"))).toBe(false);
  });
});

describe("middleware", () => {
  const next = vi.fn(async () => new Response("{}", { status: 200 }));
  const ctx = (path: string, init: RequestInit = {}, env = {}) => ({ request: new Request(`https://atlas.example${path}`, init), env, next });

  it("refuses an Access route without a session, logs it, and returns a request id", async () => {
    const lines: string[] = [];
    const res = await handle(ctx("/api/health", {}, { ACCESS_TEAM_DOMAIN: "https://t.cloudflareaccess.com", ACCESS_AUD: "aud" }), (l) => lines.push(l));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(JSON.parse(lines[0])).toMatchObject({ event: "auth.denied", status: 401, path: "/api/health" });
    expect(next).not.toHaveBeenCalled();
  });

  it("lets hooks check their own secret, and logs their refusals without the key", async () => {
    const lines: string[] = [];
    const deny = vi.fn(async () => new Response("{}", { status: 401 }));
    const res = await handle({ request: new Request("https://atlas.example/api/hooks/feed", { headers: { authorization: `Bearer ${GH_TOKEN}` } }), env: {}, next: deny }, (l) => lines.push(l));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(lines[0]).toContain("auth.hook_denied");
    expect(lines[0]).not.toContain(GH_TOKEN);
  });

  it("turns a thrown error into a logged 500 without the error's internals leaking to the client", async () => {
    const lines: string[] = [];
    const boom = vi.fn(async (): Promise<Response> => { throw new Error(`db failed with ${GH_TOKEN}`); });
    const res = await handle({ request: new Request("https://atlas.example/api/hooks/feed"), env: {}, next: boom }, (l) => lines.push(l));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("db failed");
    expect(lines[0]).toContain("api.error");
    expect(lines[0]).not.toContain(GH_TOKEN);
  });
});

describe("health", () => {
  const fetcher = (over: Partial<Record<"github" | "n8n", Response | Error>> = {}) =>
    vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      const pick = u.includes("api.github.com") ? over.github ?? Response.json({ resources: { core: { limit: 5000, remaining: 4900 } } }) : over.n8n ?? (u.includes("/workflows") ? Response.json({ data: [{ id: "w1", name: "Flow", active: true }] }) : Response.json({ data: [{ id: "1", workflowId: "w1", status: "success", startedAt: "2026-11-16T11:00:00Z" }] }));
      if (pick instanceof Error) throw pick;
      return pick.clone();
    }) as unknown as typeof fetch;

  const baseEnv = async (): Promise<HealthEnv> => {
    const db = sqliteD1();
    await ensureSchema(db);
    db.raw.prepare("INSERT INTO events (at, source, kind, repo, delivery, body) VALUES (?, 'github', 'push', 'r', 'd1', '{}')").run("2026-11-16T10:00:00.000Z");
    return { LIVE: db, ACCESS_TEAM_DOMAIN: "https://t.cloudflareaccess.com", ACCESS_AUD: "aud", ALLOWED_EMAILS: "owner@example.com", GITHUB_TOKEN: GH_TOKEN, GITHUB_WEBHOOK_SECRET: "w", N8N_API_KEY: "k", USAGE_SYNC_TOKEN: SYNC };
  };

  it("reports healthy only for what it verified, and never returns a credential", async () => {
    const r = await healthReport(await baseEnv(), null, fetcher(), NOW);
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c.state]));
    expect(by).toMatchObject({ access: "healthy", database: "healthy", "github-api": "healthy", "github-webhooks": "healthy", n8n: "healthy", "n8n-bridge": "unknown", "production-agents": "unknown" });
    expect(r.overall).toBe("healthy");
    expect(r.metrics.workflowSuccessRate).toBe(1);
    const text = JSON.stringify(r);
    expect(text).not.toContain(GH_TOKEN);
    expect(text).not.toContain(SYNC);
  });

  it("is unavailable without the database, and degraded without the owner allowlist", async () => {
    const env = await baseEnv();
    const noDb = await healthReport({ ...env, LIVE: undefined }, null, fetcher(), NOW);
    expect(noDb.overall).toBe("unavailable");
    expect(noDb.checks.find((c) => c.id === "n8n-bridge")?.state).toBe("unknown");
    const open = await healthReport({ ...env, ALLOWED_EMAILS: "" }, null, fetcher(), NOW);
    expect(open.checks.find((c) => c.id === "access")?.state).toBe("degraded");
    expect(open.overall).toBe("degraded");
  });

  it("marks integration failures without throwing: revoked GitHub token, n8n down", async () => {
    const r = await healthReport(await baseEnv(), null, fetcher({ github: new Response("{}", { status: 401 }), n8n: new Error("down") }), NOW);
    expect(r.checks.find((c) => c.id === "github-api")?.state).toBe("unavailable");
    expect(r.checks.find((c) => c.id === "n8n")?.state).toBe("unavailable");
    expect(r.overall).toBe("degraded");
  });

  it("flags step sends that never got an answer", async () => {
    const env = await baseEnv();
    const bridge = { ...env, N8N_BRIDGE_TOKEN: "b".repeat(40), N8N_BRIDGE_CALLBACK_TOKEN: "c".repeat(40) };
    const db = env.LIVE as ReturnType<typeof sqliteD1>;
    db.raw.exec("CREATE TABLE n8n_dispatch (idem TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, attempt_id TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL, detail TEXT)");
    db.raw.prepare("INSERT INTO n8n_dispatch VALUES ('k1','r','n','a',?, 'sending', NULL)").run("2026-11-16T11:00:00.000Z");
    const r = await healthReport(bridge, null, fetcher(), NOW);
    expect(r.checks.find((c) => c.id === "n8n-bridge")).toMatchObject({ state: "degraded" });
  });

  it("names every credential by whether it is set, never by value", () => {
    const list = credentialStatus({ USAGE_SYNC_TOKEN: "short" });
    expect(list.find((c) => c.id === "sync")?.configured).toBe(false);
    expect(list.every((c) => Object.keys(c).sort().join() === "configured,id,label,scope")).toBe(true);
  });

  it("the Mac app's copy needs the sync key", async () => {
    const env = await baseEnv();
    expect((await readHealthForApp(new Request("https://x/api/hooks/health"), env, null, fetcher())).status).toBe(401);
    expect((await readHealthForApp(new Request("https://x/api/hooks/health", { headers: { authorization: `Bearer ${SYNC}` } }), env, null, fetcher())).status).toBe(200);
  });

  it("never calls unknown healthy", () => {
    const at = "2026-11-16T12:00:00Z";
    expect(overallState([{ id: "a", label: "a", state: "unknown", detail: "", critical: true, checkedAt: at }])).toBe("unknown");
    expect(overallState([])).toBe("unknown");
    expect(overallState([{ id: "a", label: "a", state: "healthy", detail: "", critical: true, checkedAt: at }, { id: "b", label: "b", state: "unknown", detail: "", checkedAt: at }])).toBe("healthy");
  });
});
