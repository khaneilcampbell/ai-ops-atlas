import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compactGithub, readEvents, readFeed, receiveAtlas, receiveGithub, validSignature, type D1, type D1Statement } from "./live";

const SECRET = "w".repeat(64);
const SYNC = "s".repeat(43);
const NOW = Date.UTC(2026, 9, 28, 8);

/** A tiny in-memory stand-in for the D1 queries live.ts makes. */
function fakeD1() {
  const rows: { id: number; at: string; source: string; kind: string; repo: string | null; delivery: string | null; body: string }[] = [];
  let next = 1;
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT")) {
        const [at, source, kind, repo, delivery, body] = args as [string, string, string, string | null, string | null, string];
        if (delivery && rows.some((r) => r.delivery === delivery)) return;
        rows.push({ id: next++, at, source, kind, repo, delivery, body });
      } else if (sql.startsWith("DELETE")) {
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].at < (args[0] as string)) rows.splice(i, 1);
      }
    },
    all: async <T,>() => {
      if (sql.includes("MAX(id)")) return { results: [{ id: rows.length ? rows[rows.length - 1].id : null }] as T[] };
      const [x, limit] = args as [string | number, number];
      const hit = sql.includes("WHERE at >=") ? rows.filter((r) => r.at >= (x as string)) : rows.filter((r) => r.id > (x as number));
      return { results: hit.slice().reverse().slice(0, limit) as T[] };
    },
  });
  const db: D1 = { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
  return { db, rows };
}

const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const hook = (event: string, payload: unknown, opts: { secret?: string; delivery?: string } = {}) => {
  const body = JSON.stringify(payload);
  return new Request("https://x.pages.dev/api/hooks/github", {
    method: "POST",
    headers: { "x-github-event": event, "x-hub-signature-256": sign(body, opts.secret), "x-github-delivery": opts.delivery ?? crypto.randomUUID() },
    body,
  });
};
const runPayload = (status: string, extra: Record<string, unknown> = {}) => ({
  action: status === "completed" ? "completed" : "in_progress",
  repository: { full_name: "khaneilcampbell/ai-ops-atlas" },
  workflow_run: { id: 7, run_attempt: 1, name: "CI", path: ".github/workflows/ci.yml", status, conclusion: status === "completed" ? "success" : null, head_branch: "main", event: "push", created_at: "2026-10-28T07:59:00Z", html_url: "https://github.com/r/7", head_commit: { message: "secret stuff" }, ...extra },
});

describe("live hooks", () => {
  it("checks GitHub's signature", async () => {
    expect(await validSignature(SECRET, "{}", sign("{}"))).toBe(true);
    expect(await validSignature(SECRET, "{}", sign("{}", "other"))).toBe(false);
    expect(await validSignature(SECRET, "{}", null)).toBe(false);
  });

  it("fails closed until the binding and secret exist", async () => {
    expect((await receiveGithub(hook("workflow_run", runPayload("in_progress")), {})).status).toBe(503);
    expect((await receiveGithub(hook("workflow_run", runPayload("in_progress")), { LIVE: fakeD1().db })).status).toBe(503);
  });

  it("refuses a bad signature and stores nothing", async () => {
    const d = fakeD1();
    expect((await receiveGithub(hook("workflow_run", runPayload("in_progress"), { secret: "nope" }), { LIVE: d.db, GITHUB_WEBHOOK_SECRET: SECRET })).status).toBe(401);
    expect(d.rows).toHaveLength(0);
  });

  it("stores a compact run once per delivery and serves it to readers", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, GITHUB_WEBHOOK_SECRET: SECRET, USAGE_SYNC_TOKEN: SYNC };
    expect((await receiveGithub(hook("workflow_run", runPayload("in_progress"), { delivery: "a" }), env, NOW)).status).toBe(202);
    await receiveGithub(hook("workflow_run", runPayload("in_progress"), { delivery: "a" }), env, NOW);
    await receiveGithub(hook("workflow_run", runPayload("completed"), { delivery: "b" }), env, NOW + 1000);
    expect(d.rows).toHaveLength(2);
    expect(d.rows[0].body).not.toContain("secret stuff");

    const fresh = await (await readEvents(new URL("https://x/api/events"), env, NOW + 2000)).json();
    expect(fresh.events.map((e: { body: { run: { status: string } } }) => e.body.run.status)).toEqual(["in_progress", "completed"]);
    expect(fresh.cursor).toBe(2);
    const after = await (await readEvents(new URL("https://x/api/events?after=2"), env, NOW + 2000)).json();
    expect(after).toMatchObject({ cursor: 2, events: [] });

    const feed = (token: string) => readFeed(new Request("https://x/api/hooks/feed?after=1", { headers: { authorization: `Bearer ${token}` } }), env, NOW);
    expect((await feed("wrong")).status).toBe(401);
    expect((await (await feed(SYNC)).json()).events).toHaveLength(1);
  });

  it("answers pings and ignores events it doesn't show", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, GITHUB_WEBHOOK_SECRET: SECRET };
    expect((await receiveGithub(hook("ping", { zen: "hi" }), env)).status).toBe(200);
    expect((await receiveGithub(hook("issues", { repository: { full_name: "o/r" } }), env)).status).toBe(202);
    expect(d.rows).toHaveLength(0);
  });

  it("keeps a push's commit summaries only", () => {
    const c = compactGithub("push", {
      ref: "refs/heads/main",
      repository: { full_name: "o/r", default_branch: "main" },
      commits: [{ id: "abc", message: "Fix it\n\nlong body", author: { name: "KC", email: "kc@example.com" }, timestamp: "t", url: "u", added: ["x"] }],
    });
    expect(c).toEqual({ kind: "push", repo: "o/r", body: { ref: "refs/heads/main", branch: "main", default_branch: "main", deleted: false, commits: [{ sha: "abc", message: "Fix it", author: "KC", date: "t", url: "u" }] } });
  });

  it("takes the Mac app's agent runs with its sync key", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, USAGE_SYNC_TOKEN: SYNC };
    const post = (body: unknown, token = SYNC) => new Request("https://x/api/hooks/atlas", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    expect((await receiveAtlas(post({ events: [] }, "nope"), env)).status).toBe(401);
    const r = await receiveAtlas(post({ events: [{ kind: "intel_run", repo: "o/r", body: { id: "run1", status: "running" } }, { kind: "other", body: {} }] }), env, NOW);
    expect(await r.json()).toEqual({ stored: 1 });
    expect(d.rows[0]).toMatchObject({ source: "atlas", kind: "intel_run", repo: "o/r" });
  });
});
