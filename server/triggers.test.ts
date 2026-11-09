import { describe, expect, it } from "vitest";
import { evaluate, firePayload, MAX_PER_DAY, signalFrom, whyNot, type TriggerEnv } from "./triggers";
import type { D1, D1Statement } from "./live";

const NOW = Date.UTC(2026, 10, 9, 18);
const REPO = "khaneilcampbell/ai-ops-atlas";
const ENV: TriggerEnv = {};
const FIRE: TriggerEnv = { TRIGGER_FIRE_URL: "https://api.anthropic.com/v1/claude_code/routines/trig_x/fire", TRIGGER_FIRE_TOKEN: "tok" };

const run = (conclusion: string, over: Record<string, unknown> = {}) => ({
  action: "completed",
  default_branch: "main",
  run: { name: "Release", path: ".github/workflows/release.yml", status: "completed", conclusion, head_branch: "main", html_url: "https://github.com/x/runs/1", ...over },
});
const issue = (over: Record<string, unknown> = {}) => ({ action: "opened", number: 7, title: "Map is blank", author: "khaneilcampbell", labels: [], url: "https://github.com/x/issues/7", ...over });

/** Just enough of D1 for the trigger_state table. */
function fakeD1() {
  const state = new Map<string, { failing: number; fired_at: string | null }>();
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT")) {
        const [key, a, b] = args as [string, unknown, unknown];
        state.set(key, sql.includes("0, ?") ? { failing: 0, fired_at: a as string | null } : { failing: a as number, fired_at: b as string | null });
      } else if (sql.startsWith("DELETE")) state.delete(args[0] as string);
    },
    all: async <T,>() => {
      if (sql.includes("COUNT(*)")) return { results: [{ n: [...state.values()].filter((s) => s.fired_at && s.fired_at >= (args[0] as string)).length }] as T[] };
      const row = state.get(args[0] as string);
      return { results: (row ? [row] : []) as T[] };
    },
  });
  const db: D1 = { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
  return { db, state };
}

function fakeFire(ok = true) {
  const calls: { url: string; body: { text: string }; auth: string | null }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify({ claude_code_session_url: "https://claude.ai/code/session_1" }), { status: ok ? 200 : 500 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("signalFrom", () => {
  it("reads a failed deploy on the default branch", () => {
    expect(signalFrom("workflow_run", REPO, run("failure"), ENV)).toMatchObject({ kind: "deploy", failing: true, title: "Release failed on main" });
    expect(signalFrom("workflow_run", REPO, run("failure", { name: "CI", path: ".github/workflows/ci.yml" }), ENV)).toMatchObject({ kind: "ci" });
    expect(signalFrom("workflow_run", REPO, run("success"), ENV)).toMatchObject({ failing: false });
  });

  it("ignores branches, in-progress runs, cancelled runs and other repositories", () => {
    expect(signalFrom("workflow_run", REPO, run("failure", { head_branch: "claude/x" }), ENV)).toBeNull();
    expect(signalFrom("workflow_run", REPO, { ...run("failure"), action: "requested" }, ENV)).toBeNull();
    expect(signalFrom("workflow_run", REPO, run("cancelled"), ENV)).toBeNull();
    expect(signalFrom("workflow_run", "someone/else", run("failure"), ENV)).toBeNull();
    expect(signalFrom("workflow_run", "someone/else", run("failure"), { TRIGGER_REPOS: "someone/else" })).not.toBeNull();
  });

  it("only wakes on issues from allowed authors, and leaves Fix with Claude requests to their own run", () => {
    expect(signalFrom("issue", REPO, issue(), ENV)).toMatchObject({ kind: "issue", key: `issue:${REPO}#7` });
    expect(signalFrom("issue", REPO, issue({ author: "stranger" }), ENV)).toBeNull();
    expect(signalFrom("issue", REPO, issue({ author: null }), ENV)).toBeNull();
    expect(signalFrom("issue", REPO, issue({ labels: ["claude-fix"] }), ENV)).toBeNull();
  });

  it("reads failed pipeline phases", () => {
    const s = signalFrom("agent_run", null, { project: "commerce", agents: ["order-delivery"], phase: "Delivery", status: "failed", detail: "SMTP refused" }, ENV);
    expect(s).toMatchObject({ kind: "automation", failing: true, title: "order-delivery failed in Delivery: SMTP refused" });
    expect(signalFrom("agent_run", null, { project: "c", agents: ["a"], phase: "p", status: "skipped" }, ENV)).toBeNull();
  });
});

describe("whyNot", () => {
  const s = signalFrom("workflow_run", REPO, run("failure"), ENV)!;
  it("wakes when a problem starts, not while it continues or past the cap", () => {
    expect(whyNot(s, null, 0)).toBeNull();
    expect(whyNot(s, { failing: false, firedAt: null }, 0)).toBeNull();
    expect(whyNot(s, { failing: true, firedAt: "x" }, 0)).toMatch(/already/);
    expect(whyNot(s, null, MAX_PER_DAY)).toMatch(/cap/);
  });
});

describe("evaluate", () => {
  it("records a ready trigger once per failure streak when no routine is set up", async () => {
    const { db } = fakeD1();
    const first = await evaluate(db, ENV, "workflow_run", REPO, run("failure"), NOW);
    expect(first).toMatchObject({ state: "ready", kind: "deploy" });
    expect(await evaluate(db, ENV, "workflow_run", REPO, run("failure"), NOW + 60_000)).toBeNull();
    expect(await evaluate(db, ENV, "workflow_run", REPO, run("success"), NOW + 120_000)).toBeNull();
    expect(await evaluate(db, ENV, "workflow_run", REPO, run("failure"), NOW + 180_000)).toMatchObject({ state: "ready" });
  });

  it("starts the routine with the event as text, and retries after a failed start", async () => {
    const { db } = fakeD1();
    const bad = fakeFire(false);
    expect(await evaluate(db, FIRE, "workflow_run", REPO, run("failure"), NOW, bad.fetcher)).toMatchObject({ state: "failed" });
    const good = fakeFire();
    const t = await evaluate(db, FIRE, "workflow_run", REPO, run("failure"), NOW + 60_000, good.fetcher);
    expect(t).toMatchObject({ state: "fired", session: "https://claude.ai/code/session_1" });
    expect(good.calls[0].auth).toBe("Bearer tok");
    expect(good.calls[0].body.text).toContain("Release failed on main");
  });

  it("fires each issue once, even when GitHub redelivers it", async () => {
    const { db } = fakeD1();
    expect(await evaluate(db, ENV, "issue", REPO, issue(), NOW)).toMatchObject({ state: "ready" });
    expect(await evaluate(db, ENV, "issue", REPO, issue(), NOW + 1)).toBeNull();
    expect(await evaluate(db, ENV, "issue", REPO, issue({ number: 8 }), NOW + 2)).toMatchObject({ state: "ready" });
  });

  it("stops at the daily cap", async () => {
    const { db } = fakeD1();
    for (let i = 0; i < MAX_PER_DAY; i++) expect(await evaluate(db, ENV, "issue", REPO, issue({ number: i }), NOW + i)).not.toBeNull();
    expect(await evaluate(db, ENV, "issue", REPO, issue({ number: 99 }), NOW + 10)).toBeNull();
  });

  it("never throws when D1 is down", async () => {
    const broken: D1 = { prepare: () => { throw new Error("D1 down"); }, batch: async () => undefined };
    expect(await evaluate(broken, ENV, "issue", REPO, issue(), NOW)).toBeNull();
  });
});

describe("firePayload", () => {
  it("says what happened in plain lines", () => {
    expect(firePayload(signalFrom("issue", REPO, issue(), ENV)!)).toBe(`Atlas event trigger (issue).\nRepository: ${REPO}\nWhat happened: New issue #7: Map is blank\nLink: https://github.com/x/issues/7`);
  });
});
