import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../data/db";
import type { D1, D1Statement } from "../live";
import { receiveGithub } from "../live";
import type { DispatchEnvelope, ResultBody } from "../../src/executive/control/contracts";
import { AGENT_GRANTS } from "../../src/intelligence/capabilities";
import { runnerTaskFrom } from "../../src/engineering/contracts";
import type { JobFacts, RunFacts } from "../../src/engineering/classify";
import type { QaEvidence } from "../../src/engineering/qa";
import { ENGINEERING_LIMITS } from "../../src/engineering/types";
import { goalView, receiveResult, tick } from "../executive/engine";
import { forGithubEvent, forHook, forOwner, type ExecutiveEnv } from "../executive/api";
import { mockAdapter, type MockAdapter } from "../executive/mockAdapter";
import { rosterFromFiles } from "../executive/roster";
import { qaRunner } from "./qaRunner";
import { ingestRun, ingestWebhook, reconcile, type IntakeDeps } from "./intake";
import type { GithubReader } from "./github";
// The runner's own helper, so the result Atlas receives here is exactly what the workflow would post.
// @ts-expect-error plain ESM helper without type declarations
import { buildResult, parseTask, usageFrom } from "../../ops/atlas-engineer/runner.mjs";

// The Engineering Division end to end against a real PostgreSQL (PGlite, all four migrations). GitHub
// and n8n are deterministic fakes, nothing calls a model or the network, and every run here is a
// labelled LOCAL FIXTURE (source "fixture"): it proves the control path, not a real repair.

const MIG = (f: string) => readFileSync(new URL(`../../db/migrations/${f}`, import.meta.url), "utf8");
const REPO = "khaneilcampbell/ai-ops-atlas";
const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const RUNNER_RUN = 555;
const VALIDATE_RUN = 556;
const TOKEN = "t".repeat(40);
const catalogDir = new URL("../../catalog/", import.meta.url).pathname;
const files = Object.fromEntries(
  readdirSync(catalogDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => [f, readFileSync(join(catalogDir, f), "utf8")]),
);
// The catalog keeps the division paused until Khaneil switches it on; these tests run it as switched on.
const ROSTER = rosterFromFiles(files).map((a) => (["atlas-executive", "atlas-engineer", "atlas-qa"].includes(a.id) ? { ...a, status: "active" } : a));

let pg: PGlite;
let db: Db;
function pgliteDb(p: Pick<PGlite, "query">, top?: PGlite): Db {
  const self: Db = {
    query: async <T,>(text: string, params: unknown[] = []) => (await p.query<T>(text, params)).rows,
    tx: async <T,>(fn: (d: Db) => Promise<T>) => (top ? top.transaction((t) => fn(pgliteDb(t))) : fn(self)),
  };
  return self;
}
beforeAll(async () => {
  pg = new PGlite();
  db = pgliteDb(pg, pg);
});
afterAll(async () => {
  await pg.close();
});

// ---- fakes ----------------------------------------------------------------------------------------

interface FakeGithub extends GithubReader {
  failedJobs: JobFacts[];
  validateSteps: Record<string, string>;
  validateStatus: "completed" | "in_progress" | "not_started";
  compareFiles: NonNullable<QaEvidence["compare"]>["files"];
  compareHead: string;
  laterSuccess: RunFacts[];
  failing: RunFacts[];
  down: boolean;
}
const failedRun = (over: Partial<RunFacts> = {}): RunFacts => ({
  repo: REPO,
  runId: 101,
  runAttempt: 1,
  workflowName: "CI",
  workflowPath: ".github/workflows/ci.yml",
  event: "push",
  status: "completed",
  conclusion: "failure",
  headSha: BASE,
  branch: "main",
  url: `https://github.com/${REPO}/actions/runs/101`,
  createdAt: "2026-11-23T11:30:00Z",
  ...over,
});
function fakeGithub(): FakeGithub {
  const g: FakeGithub = {
    configured: true,
    failedJobs: [{ name: "Frontend (types, tests, build)", conclusion: "failure", url: `https://github.com/${REPO}/actions/runs/101/job/1`, steps: [{ name: "Run npm run lint", conclusion: "failure" }] }],
    validateSteps: { Lint: "success", Typecheck: "success", "Unit tests": "success" },
    validateStatus: "completed",
    compareFiles: [
      { filename: "src/lib/format.ts", status: "modified", additions: 2, deletions: 1, patch: "+  return String(n);" },
      { filename: "changelog.d/atlas-eng-fix.md", status: "added", additions: 1, deletions: 0, patch: "+- 2026-11-23 · Fixed the lint check" },
    ],
    compareHead: HEAD,
    laterSuccess: [],
    failing: [],
    down: false,
    async run(_repo, runId) {
      if (g.down) throw new Error("GitHub 502");
      if (runId === RUNNER_RUN) return { ...failedRun(), runId, workflowName: "Atlas Engineer", workflowPath: ".github/workflows/atlas-engineer.yml", event: "workflow_dispatch", conclusion: "success", headSha: "c".repeat(40), url: null };
      return failedRun({ runId });
    },
    async dispatchedRuns(_repo, workflowFile, branch) {
      if (g.down) throw new Error("GitHub 502");
      if (workflowFile !== "atlas-engineer-validate.yml" || g.validateStatus === "not_started") return [];
      return [{ ...failedRun(), runId: VALIDATE_RUN, workflowName: "Atlas Engineer validate", workflowPath: ".github/workflows/atlas-engineer-validate.yml", event: "workflow_dispatch", status: g.validateStatus, conclusion: g.validateStatus === "completed" ? "success" : null, headSha: g.compareHead, branch, url: null }];
    },
    async jobs(_repo, runId) {
      if (g.down) throw new Error("GitHub 502");
      if (runId === VALIDATE_RUN) return [{ name: "validate", conclusion: Object.values(g.validateSteps).every((s) => s === "success") ? "success" : "failure", url: null, steps: Object.entries(g.validateSteps).map(([name, conclusion]) => ({ name, conclusion })) }];
      return g.failedJobs;
    },
    async recentRuns(_repo, _branch, status) {
      return status === "success" ? g.laterSuccess : g.failing;
    },
    async compare() {
      if (g.down) throw new Error("GitHub 502");
      return { mergeBaseSha: BASE, status: "ahead", aheadBy: 1, behindBy: 0, headSha: g.compareHead, files: g.compareFiles };
    },
  };
  return g;
}

let clock: number;
let adapter: MockAdapter;
let github: FakeGithub;
let stopReason: string | null;
let enabled: boolean;
const deps = (): IntakeDeps => {
  const d: IntakeDeps = { db, adapter, roster: async () => ROSTER, stop: async () => stopReason, now: () => clock, github, enabled, local: {} };
  d.local = { "qa-validation": qaRunner(db, github, () => clock) };
  return d;
};
const env = (over: Partial<ExecutiveEnv> = {}): ExecutiveEnv => ({ ATLAS_ENGINEERING_CALLBACK_TOKEN: TOKEN, ATLAS_ENGINEERING_ENABLED: enabled ? "true" : "false", ...over }) as ExecutiveEnv;
const seams = () => ({ db, adapter, roster: async () => ROSTER, stop: async () => stopReason, now: () => clock, github });

beforeEach(async () => {
  await db.query("DROP SCHEMA IF EXISTS atlas CASCADE");
  for (const f of ["0001_atlas_core.sql", "0002_executive.sql", "0003_agent_memory.sql", "0004_engineering.sql"]) await pg.exec(MIG(f));
  clock = Date.parse("2026-11-23T12:00:00Z");
  adapter = mockAdapter();
  github = fakeGithub();
  stopReason = null;
  enabled = true;
});

// ---- helpers --------------------------------------------------------------------------------------

const sentFor = (route: string) => adapter.sent.filter((e) => e.route === route);
const lastSent = (route: string) => sentFor(route).at(-1)!;
const exec = async (goalId: string) => db.query<{ phase: string; qa_outcome: string | null; pr_url: string | null; repair_iteration: number; head_sha: string | null; branch: string | null; cost_usd: string }>("SELECT phase, qa_outcome, pr_url, repair_iteration, head_sha, branch, cost_usd::text FROM atlas.eng_executions WHERE exec_goal_id = $1 ORDER BY created_at", [goalId]);
const incident = async () => (await db.query<{ id: string; status: string; source: string; exec_goal_id: string | null; owner_task_id: string | null }>("SELECT id, status, source, exec_goal_id, owner_task_id FROM atlas.eng_incidents ORDER BY created_at"))[0];

/** What the runner's report job posts, built by the runner's own helper from the dispatch Atlas sent. */
function runnerResult(e: DispatchEnvelope, over: { outcome?: string; files?: unknown[]; validationPassed?: boolean; costUsd?: number } = {}): ResultBody {
  const task = parseTask(JSON.stringify(runnerTaskFrom(e)));
  return buildResult({
    task,
    kind: "succeeded",
    outcome: over.outcome ?? "changed",
    files: over.files ?? [
      { path: "src/lib/format.ts", additions: 2, deletions: 1 },
      { path: "changelog.d/atlas-eng-fix.md", additions: 1, deletions: 0 },
    ],
    headSha: (over.outcome ?? "changed") === "changed" ? HEAD : null,
    runId: String(RUNNER_RUN),
    runAttempt: "1",
    runUrl: `https://github.com/${REPO}/actions/runs/${RUNNER_RUN}`,
    phases: [
      { phase: "CONTEXT_COLLECTED", at: "2026-11-23T12:01:00.000Z" },
      { phase: "POLICY_CHECKED", at: "2026-11-23T12:01:10.000Z" },
      { phase: "WORKSPACE_PREPARED", at: "2026-11-23T12:02:00.000Z" },
      { phase: "CODE_MODIFIED", at: "2026-11-23T12:05:00.000Z" },
      { phase: "VALIDATION_STARTED", at: "2026-11-23T12:06:00.000Z" },
      { phase: "VALIDATION_COMPLETED", at: "2026-11-23T12:09:00.000Z" },
    ],
    validation: ["Lint", "Typecheck", "Unit tests"].map((name) => ({ name, command: name, passed: over.validationPassed ?? true })),
    usage: usageFrom({ total_cost_usd: over.costUsd ?? 0.21, num_turns: 6, usage: { input_tokens: 42_000, output_tokens: 3_100 }, result: "The formatter returned a number where the lint rule expects a string." }, task.model),
    now: clock,
  }) as ResultBody;
}
const post = (body: unknown, token = TOKEN) => new Request("https://atlas.example/api/hooks/engineering-result", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const postRunner = async (body: unknown, token = TOKEN) => forHook(post(body, token), env(), "engineering-result", seams());
function deliveryResult(e: DispatchEnvelope, over: Record<string, unknown> = {}): ResultBody {
  return {
    contract: "ATLAS_WORKFLOW_RESULT",
    version: 1,
    eventId: `${e.idempotencyKey}:n8n-9`,
    taskId: e.taskId,
    attempt: e.attempt,
    correlationId: e.correlationId,
    idempotencyKey: e.idempotencyKey,
    nonce: e.nonce,
    executionId: "9",
    kind: "succeeded",
    artifact: { schema: "pr-delivery/1", repo: REPO, prUrl: `https://github.com/${REPO}/pull/900`, prNumber: 900, branch: e.inputs.branch, headSha: e.inputs.head_sha, ...over },
    at: new Date(clock).toISOString(),
  };
}

async function startFixture() {
  const out = await ingestRun(deps(), failedRun(), "fixture");
  expect(out.kind).toBe("goal");
  return out as { kind: "goal"; goalId: string; incidentId: string };
}

// ---- tests ----------------------------------------------------------------------------------------

describe("registration and permissions", () => {
  it("registers both agents under Atlas Executive with the right grants and no merge capability", () => {
    expect(ROSTER.find((a) => a.id === "atlas-engineer")).toBeTruthy();
    expect(ROSTER.find((a) => a.id === "atlas-qa")).toBeTruthy();
    expect(AGENT_GRANTS["atlas-engineer"]).toContain("engineering.implement_fix");
    expect(AGENT_GRANTS["atlas-qa"]).toContain("qa.verify_change");
    // QA can't write code, Engineering can't pass its own work, and nobody here can merge or deploy.
    expect(AGENT_GRANTS["atlas-qa"]).not.toContain("engineering.implement_fix");
    expect(AGENT_GRANTS["atlas-engineer"]).not.toContain("qa.verify_change");
    for (const id of ["atlas-engineer", "atlas-qa"]) expect(AGENT_GRANTS[id].some((c) => /merge|deploy|credential|approve/.test(c))).toBe(false);
  });
});

describe("LOCAL FIXTURE end to end: failed CI -> repair -> QA -> pull request (not a real repair)", () => {
  it("runs the whole lifecycle with real records and an audit trail", async () => {
    const { goalId } = await startFixture();
    // 1. Atlas assigned Engineering and dispatched the runner through n8n.
    const g1 = (await goalView(db, goalId))!;
    expect(g1.objective).toMatch(/local fixture, not a real repair/);
    const implement = g1.tasks.find((t) => t.key === "implement")!;
    expect(implement.agentId).toBe("atlas-engineer");
    expect(implement.state).toBe("running");
    const e = lastSent("engineering-repair");
    expect(e.inputs).toMatchObject({ repo: REPO, base_sha: BASE, category: "lint", model: "sonnet", branch: `atlas-eng/${e.taskId.slice(0, 8)}-a1` });
    expect((await exec(goalId))[0].phase).toBe("TASK_ASSIGNED");

    // 2. The runner reports through its own key; QA runs inside Atlas and passes it from GitHub's records.
    const res = await postRunner(runnerResult(e));
    expect(res.status).toBe(202);
    const afterQa = await exec(goalId);
    expect(afterQa[0]).toMatchObject({ phase: "PR_READY", qa_outcome: "PASS", head_sha: HEAD });
    expect(Number(afterQa[0].cost_usd)).toBeCloseTo(0.21, 2);

    // 3. Delivery: n8n opens the pull request (never merges) and reports it.
    const d = lastSent("pr-delivery");
    expect(d.inputs).toMatchObject({ repo: REPO, base: "main", head_sha: HEAD, qa_outcome: "PASS" });
    expect(d.inputs.body).toContain("Atlas never merges");
    expect((await receiveResult(deps(), deliveryResult(d))).status).toBe(202);

    const done = (await goalView(db, goalId))!;
    expect(done.state).toBe("GOAL_COMPLETED");
    expect(done.summary).toContain(`https://github.com/${REPO}/pull/900`);
    expect((await exec(goalId))[0].pr_url).toBe(`https://github.com/${REPO}/pull/900`);
    expect((await incident()).status).toBe("pr_open");
    // Every phase was persisted, and the audit log refuses edits.
    const phases = (await db.query<{ to_state: string }>("SELECT to_state FROM atlas.exec_events WHERE kind = 'engineering.phase' AND exec_goal_id = $1 ORDER BY id", [goalId])).map((r) => r.to_state);
    expect(phases).toEqual(expect.arrayContaining(["TASK_ASSIGNED", "CODE_MODIFIED", "VALIDATION_COMPLETED", "QA_REVIEW_REQUESTED", "PR_READY"]));
    await expect(db.query("UPDATE atlas.exec_events SET detail = 'x'")).rejects.toThrow();
    await expect(db.query("DELETE FROM atlas.exec_events")).rejects.toThrow();
    // A fixture never becomes a lesson in memory.
    expect(await db.query("SELECT id FROM atlas.memory_items WHERE category = 'operational'")).toHaveLength(0);
    // The panel shows it, labelled as a fixture.
    const panel = await forOwner(new Request("https://atlas.example/api/executive/engineering"), env(), "engineering", seams());
    const body = (await panel.json()) as { incidents: { source: string }[]; executions: { prUrl: string }[]; agents: { id: string; activity: string }[] };
    expect(body.incidents[0].source).toBe("fixture");
    expect(body.executions[0].prUrl).toContain("/pull/900");
    expect(body.agents.map((a) => a.activity)).toEqual(["IDLE", "IDLE"]);
  });

  it("is idempotent: a repeated runner callback changes nothing", async () => {
    const { goalId } = await startFixture();
    const body = runnerResult(lastSent("engineering-repair"));
    expect((await postRunner(body)).status).toBe(202);
    const again = await postRunner(body);
    expect([200, 202, 409]).toContain(again.status);
    expect(sentFor("pr-delivery")).toHaveLength(1);
    expect(await exec(goalId)).toHaveLength(1);
  });
});

describe("intake: monitoring, allowlist and dedupe", () => {
  it("dedupes the same failure from the webhook and the reconciliation sweep", async () => {
    github.failing = [failedRun()];
    const first = await ingestWebhook(deps(), "workflow_run", { action: "completed", repository: { full_name: REPO }, workflow_run: { id: 101, name: "CI", head_sha: BASE, head_branch: "main", conclusion: "failure" } });
    expect(first.kind).toBe("goal");
    const sweep = await reconcile(deps());
    expect(sweep.outcomes).toEqual(["duplicate"]);
    expect(await db.query("SELECT id FROM atlas.eng_incidents")).toHaveLength(1);
    const [state] = await db.query<{ last_seen_sha: string }>("SELECT last_seen_sha FROM atlas.eng_repo_state");
    expect(state.last_seen_sha).toBe(BASE);
  });

  it("ignores repositories off the allowlist, even with a valid-looking payload", async () => {
    const out = await ingestWebhook(deps(), "workflow_run", { action: "completed", repository: { full_name: "someone/else" }, workflow_run: { id: 1, name: "CI", head_sha: BASE, head_branch: "main", conclusion: "failure" } });
    expect(out.kind).toBe("ignored");
    expect(await db.query("SELECT id FROM atlas.eng_incidents")).toHaveLength(0);
  });

  it("only acts on a webhook after its signature checks out", async () => {
    let heard = 0;
    const d1: D1 = { prepare: () => ({ bind: () => d1.prepare(""), run: async () => undefined, all: async () => ({ results: [] }) }) as unknown as D1Statement, batch: async () => [] };
    const req = (sig: string) => new Request("https://atlas.example/api/hooks/github", { method: "POST", headers: { "x-github-event": "workflow_run", "x-hub-signature-256": sig }, body: JSON.stringify({ action: "completed" }) });
    const bad = await receiveGithub(req("sha256=00"), { LIVE: d1, GITHUB_WEBHOOK_SECRET: "secret" }, clock, () => heard++);
    expect(bad.status).toBe(401);
    expect(heard).toBe(0);
    const body = JSON.stringify({ action: "completed" });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await receiveGithub(new Request("https://atlas.example/api/hooks/github", { method: "POST", headers: { "x-github-event": "workflow_run", "x-hub-signature-256": `sha256=${mac}` }, body }), { LIVE: d1, GITHUB_WEBHOOK_SECRET: "secret" }, clock, () => heard++);
    expect(heard).toBe(1);
  });

  it("escalates to Khaneil instead of repairing when switched off, stopped, or the failure is unsupported", async () => {
    enabled = false;
    expect((await ingestRun(deps(), failedRun(), "fixture")).kind).toBe("escalated");
    const owner = await db.query<{ title: string; status: string }>("SELECT title, status FROM atlas.tasks");
    expect(owner).toHaveLength(1);
    enabled = true;
    stopReason = "Khaneil pressed stop";
    expect((await ingestRun(deps(), failedRun({ runId: 102, headSha: "d".repeat(40) }), "fixture")).kind).toBe("escalated");
    stopReason = null;
    github.failedJobs = [{ name: "Desktop shell (Rust tests)", conclusion: "failure", url: null, steps: [{ name: "cargo test", conclusion: "failure" }] }];
    expect((await ingestRun(deps(), failedRun({ runId: 103, headSha: "e".repeat(40) }), "fixture")).kind).toBe("escalated");
    expect(adapter.sent).toHaveLength(0);
  });

  it("keeps one engineering job per repository", async () => {
    await startFixture();
    const second = await ingestRun(deps(), failedRun({ runId: 104, headSha: "f".repeat(40) }), "fixture");
    expect(second.kind).toBe("escalated");
    expect(sentFor("engineering-repair")).toHaveLength(1);
  });

  it("does nothing when a later run already passed", async () => {
    github.laterSuccess = [failedRun({ runId: 200, conclusion: "success", createdAt: "2026-11-23T11:50:00Z" })];
    expect((await ingestRun(deps(), failedRun(), "fixture")).kind).toBe("ignored");
  });

  it("webhook intake through the site API is a no-op without a database", async () => {
    expect(await forGithubEvent({} as ExecutiveEnv, "workflow_run", {})).toBeNull();
  });
});

describe("runner callback authentication", () => {
  it("refuses a wrong key, an unset key, and use of the key for a non-engineering task", async () => {
    const { goalId } = await startFixture();
    const body = runnerResult(lastSent("engineering-repair"));
    expect((await postRunner(body, "w".repeat(40))).status).toBe(401);
    expect((await forHook(post(body), env({ ATLAS_ENGINEERING_CALLBACK_TOKEN: "" }), "engineering-result", seams())).status).toBe(503);
    // The QA and deliver tasks can't be reported with the runner's key.
    const [qa] = await db.query<{ id: string }>("SELECT id FROM atlas.exec_tasks WHERE exec_goal_id = $1 AND plan_key = 'qa'", [goalId]);
    expect((await postRunner({ ...body, taskId: qa.id })).status).toBe(403);
  });

  it("rejects a report for a branch or base Atlas didn't send", async () => {
    const { goalId } = await startFixture();
    const e = lastSent("engineering-repair");
    const body = runnerResult(e) as ResultBody & { artifact: Record<string, unknown> };
    body.artifact = { ...body.artifact, baseSha: "9".repeat(40) };
    await postRunner(body);
    expect(sentFor("pr-delivery")).toHaveLength(0);
    expect((await exec(goalId))[0].phase).not.toBe("PR_READY");
  });
});

describe("QA: independent, bounded repair loop", () => {
  it("sends a failed change back with feedback, at most twice, then escalates to Khaneil", async () => {
    const { goalId } = await startFixture();
    github.validateSteps = { Lint: "success", Typecheck: "success", "Unit tests": "failure" };
    // The runner claims everything passed; QA believes GitHub.
    await postRunner(runnerResult(lastSent("engineering-repair")));
    expect((await exec(goalId))[0].qa_outcome).toBe("FAIL");
    for (let i = 1; i <= ENGINEERING_LIMITS.maxRepairIterations; i++) {
      const e = lastSent("engineering-repair");
      expect(e.inputs.repair_iteration).toBe(String(i));
      expect(e.inputs.feedback).toMatch(/Unit tests/);
      expect(e.inputs.model).toBe("opus");
      await postRunner(runnerResult(e));
    }
    expect(sentFor("engineering-repair")).toHaveLength(1 + ENGINEERING_LIMITS.maxRepairIterations);
    expect(sentFor("pr-delivery")).toHaveLength(0);
    const g = (await goalView(db, goalId))!;
    expect(g.state).toBe("FAILED");
    const inc = await incident();
    expect(inc.status).toBe("failed");
    expect(inc.owner_task_id).toBeTruthy();
  });

  it("sends a dependency change to Khaneil as an approval, never straight to a pull request", async () => {
    const { goalId } = await startFixture();
    github.compareFiles = [{ filename: "package.json", status: "modified", additions: 1, deletions: 1, patch: '+  "x": "1.0.1"' }];
    await postRunner(runnerResult(lastSent("engineering-repair"), { files: [{ path: "package.json", additions: 1, deletions: 1 }] }));
    expect((await exec(goalId))[0].qa_outcome).toBe("NEEDS_REVIEW");
    expect(sentFor("pr-delivery")).toHaveLength(0);
    expect((await goalView(db, goalId))!.state).toBe("AWAITING_APPROVAL");
    const approvals = await db.query<{ status: string }>("SELECT status FROM atlas.approvals");
    expect(approvals.map((a) => a.status)).toEqual(["pending"]);
  });

  it("is BLOCKED and retried, never passed, while GitHub can't be read", async () => {
    const { goalId } = await startFixture();
    github.down = true;
    await postRunner(runnerResult(lastSent("engineering-repair")));
    expect(sentFor("pr-delivery")).toHaveLength(0);
    expect((await exec(goalId)).some((x) => x.qa_outcome === "PASS")).toBe(false);
    // One attempt used, the rest kept for later: QA doesn't burn its retries while GitHub is down.
    const [qa] = await db.query<{ state: string; attempts: number }>("SELECT state, attempts FROM atlas.exec_tasks WHERE exec_goal_id = $1 AND plan_key = 'qa'", [goalId]);
    expect(qa).toMatchObject({ state: "ready", attempts: 1 });
    await tick(deps(), "test");
    expect(sentFor("pr-delivery")).toHaveLength(0);
    github.down = false;
    await db.query("UPDATE atlas.exec_tasks SET lease_until = now() - interval '1 second' WHERE plan_key = 'qa'"); // five minutes pass
    await tick(deps(), "test");
    // After GitHub answers again, QA's retry passes it and delivery goes ahead.
    expect(sentFor("pr-delivery")).toHaveLength(1);
  });

  it("waits for the checks on the pushed branch, then passes on their results", async () => {
    const { goalId } = await startFixture();
    github.validateStatus = "not_started";
    await postRunner(runnerResult(lastSent("engineering-repair")));
    expect(sentFor("pr-delivery")).toHaveLength(0);
    github.validateStatus = "in_progress";
    await db.query("UPDATE atlas.exec_tasks SET lease_until = now() - interval '1 second' WHERE plan_key = 'qa'");
    await tick(deps(), "test");
    expect(sentFor("pr-delivery")).toHaveLength(0);
    const [qa] = await db.query<{ state: string; attempts: number }>("SELECT state, attempts FROM atlas.exec_tasks WHERE exec_goal_id = $1 AND plan_key = 'qa'", [goalId]);
    expect(qa).toMatchObject({ state: "ready", attempts: 2 });
    github.validateStatus = "completed";
    await db.query("UPDATE atlas.exec_tasks SET lease_until = now() - interval '1 second' WHERE plan_key = 'qa'");
    await tick(deps(), "test");
    expect(sentFor("pr-delivery")).toHaveLength(1);
    expect((await exec(goalId)).some((x) => x.qa_outcome === "PASS")).toBe(true);
  });

  it("an honest no-change ends the goal without a pull request", async () => {
    const { goalId } = await startFixture();
    await postRunner(runnerResult(lastSent("engineering-repair"), { outcome: "no_change", files: [] }));
    expect(sentFor("pr-delivery")).toHaveLength(0);
    expect((await goalView(db, goalId))!.state).toBe("FAILED");
    expect((await incident()).owner_task_id).toBeTruthy();
  });
});

describe("timeouts, recovery and cost limits", () => {
  it("a runner that never reports is retried once after its lease, then escalated", async () => {
    const { goalId } = await startFixture();
    for (let i = 0; i < 2; i++) {
      await db.query("UPDATE atlas.exec_tasks SET lease_until = now() - interval '1 second' WHERE state IN ('dispatching', 'running')");
      await tick(deps(), "test");
    }
    expect(sentFor("engineering-repair")).toHaveLength(2);
    expect(sentFor("engineering-repair")[1].inputs.branch).toMatch(/-a2$/);
    const g = (await goalView(db, goalId))!;
    expect(g.state).toBe("FAILED");
    expect((await incident()).owner_task_id).toBeTruthy();
  });

  it("refuses a result whose reported cost goes over the goal's budget", async () => {
    const { goalId } = await startFixture();
    await postRunner(runnerResult(lastSent("engineering-repair"), { costUsd: ENGINEERING_LIMITS.goalBudgetUsd + 1 }));
    expect(sentFor("pr-delivery")).toHaveLength(0);
    expect((await exec(goalId))[0].qa_outcome).toBeNull();
  });
});
