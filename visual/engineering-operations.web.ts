import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas, settle } from "./atlas";
import type { Db } from "../server/data/db";
import { receiveResult } from "../server/executive/engine";
import { mockAdapter } from "../server/executive/mockAdapter";
import { rosterFromFiles } from "../server/executive/roster";
import { ingestRun, type IntakeDeps } from "../server/engineering/intake";
import { qaRunner } from "../server/engineering/qaRunner";
import { engineeringOverview } from "../server/engineering/overview";
import type { GithubReader } from "../server/engineering/github";
import type { RunFacts } from "../src/engineering/classify";
import type { DispatchEnvelope, ResultBody } from "../src/executive/control/contracts";

// Mission Control > Engineering Operations as the hosted page shows it. The overview is not
// hand-written: the real engine and intake run on an in-memory PostgreSQL with fake GitHub and n8n,
// and every run is a labelled LOCAL FIXTURE. Screenshots go to visual/out/engineering-operations/.
const OUT = process.env.ENG_OPS_SHOTS ?? join(import.meta.dirname, "out", "engineering-operations");
const REPO = "khaneilcampbell/ai-ops-atlas";

function pgliteDb(p: Pick<PGlite, "query">, top?: PGlite): Db {
  const self: Db = {
    query: async <T,>(text: string, params: unknown[] = []) => (await p.query<T>(text, params)).rows,
    tx: async <T,>(fn: (d: Db) => Promise<T>) => (top ? top.transaction((t) => fn(pgliteDb(t))) : fn(self)),
  };
  return self;
}

const run = (sha: string, runId: number): RunFacts => ({ repo: REPO, runId, runAttempt: 1, workflowName: "CI", workflowPath: ".github/workflows/ci.yml", event: "push", status: "completed", conclusion: "failure", headSha: sha, branch: "main", url: `https://github.com/${REPO}/actions/runs/${runId}`, createdAt: new Date(Date.now() - 600_000).toISOString() });

async function data() {
  const pg = new PGlite();
  for (const f of ["0001_atlas_core.sql", "0002_executive.sql", "0003_agent_memory.sql", "0004_engineering.sql"]) await pg.exec(readFileSync(join(import.meta.dirname, "..", "db", "migrations", f), "utf8"));
  const dir = join(import.meta.dirname, "..", "catalog");
  const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
  const roster = rosterFromFiles(files).map((a) => (["atlas-executive", "atlas-engineer", "atlas-qa"].includes(a.id) ? { ...a, status: "active" } : a));
  let head = "b".repeat(40);
  let step: [string, string][] = [["Run npm run lint", "failure"]];
  const github: GithubReader = {
    configured: true,
    run: async (_r, id) => (id >= 500 ? { ...run("c".repeat(40), id), workflowName: "Atlas Engineer", workflowPath: ".github/workflows/atlas-engineer.yml", event: "workflow_dispatch", conclusion: "success" } : run("a".repeat(40), id)),
    jobs: async (_r, id) => (id >= 500 ? [{ name: "validate", conclusion: "success", url: null, steps: ["Lint", "Typecheck", "Unit tests"].map((name) => ({ name, conclusion: id === 501 && name === "Unit tests" ? "failure" : "success" })) }] : [{ name: "Frontend (types, tests, build)", conclusion: "failure", url: null, steps: step.map(([name, conclusion]) => ({ name, conclusion })) }]),
    recentRuns: async () => [],
    compare: async () => ({ mergeBaseSha: base, status: "ahead", aheadBy: 1, behindBy: 0, headSha: head, files: [{ filename: "src/lib/format.ts", status: "modified", additions: 3, deletions: 1, patch: "+  return String(n);" }, { filename: "changelog.d/atlas-eng.md", status: "added", additions: 1, deletions: 0, patch: "+- fixed" }] }),
  };
  let base = "a".repeat(40);
  const adapter = mockAdapter();
  const db = pgliteDb(pg, pg);
  const d: IntakeDeps = { db, adapter, roster: async () => roster, stop: async () => null, github, enabled: true, local: {} };
  d.local = { "qa-validation": qaRunner(db, github) };
  const change = (e: DispatchEnvelope, runId: number): ResultBody => ({
    contract: "ATLAS_WORKFLOW_RESULT", version: 1, eventId: `${e.idempotencyKey}:gh`, taskId: e.taskId, attempt: e.attempt, correlationId: e.correlationId, idempotencyKey: e.idempotencyKey, nonce: e.nonce, executionId: String(runId), kind: "succeeded", at: new Date().toISOString(),
    usage: { model: e.inputs.model, inputTokens: 38_000, outputTokens: 2_900, webSearches: 0, costUsd: 0.18 },
    artifact: { schema: "engineering-change/1", outcome: "changed", repo: REPO, baseSha: base, headSha: head, branch: e.inputs.branch, runId, runUrl: `https://github.com/${REPO}/actions/runs/${runId}`, filesChanged: [{ path: "src/lib/format.ts", additions: 3, deletions: 1 }, { path: "changelog.d/atlas-eng.md", additions: 1, deletions: 0 }], validation: [], phases: [], usage: { model: e.inputs.model, inputTokens: 38_000, outputTokens: 2_900, costUsd: 0.18, turns: 6 }, plan: "The formatter returned a number where a string was expected.", error: null },
  });
  // 1. A lint failure repaired end to end, pull request open.
  await ingestRun(d, run(base, 101), "fixture");
  await receiveResult(d, change(adapter.sent[0], 500));
  const dl = adapter.sent.find((e) => e.route === "pr-delivery")!;
  await receiveResult(d, { contract: "ATLAS_WORKFLOW_RESULT", version: 1, eventId: `${dl.idempotencyKey}:n8n`, taskId: dl.taskId, attempt: dl.attempt, correlationId: dl.correlationId, idempotencyKey: dl.idempotencyKey, nonce: dl.nonce, executionId: "9", kind: "succeeded", at: new Date().toISOString(), artifact: { schema: "pr-delivery/1", repo: REPO, prUrl: `https://github.com/${REPO}/pull/900`, prNumber: 900, branch: dl.inputs.branch, headSha: head } });
  // 2. A unit test failure: QA sent the first attempt back, the repair is running.
  base = "d".repeat(40);
  head = "e".repeat(40);
  step = [["Run npm test", "failure"]];
  await ingestRun(d, run(base, 102), "fixture");
  const second = adapter.sent.filter((e) => e.route === "engineering-repair").at(-1)!;
  await receiveResult(d, change(second, 501));
  // 3. A Rust failure Atlas doesn't repair on its own: sent to Khaneil.
  step = [["cargo test", "failure"]];
  await ingestRun(d, { ...run("f".repeat(40), 103), workflowName: "CI" }, "fixture").catch(() => null);
  const o = await engineeringOverview(db, { database: true, n8n: true, github: true, runnerCallback: true, enabled: true }, roster);
  await pg.close();
  return o;
}

async function open(page: Page, body: unknown, status = 200) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/executive/engineering") return route.fulfill({ status, json: body });
    return route.fulfill({ status: 404, json: { message: "Not in this check." } });
  });
  await openAtlas(page);
  await goTo(page, "Mission");
  const card = page.locator('section[aria-label="Engineering Operations"]');
  await card.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await settle(page, 1);
  return card;
}

test.use({ deviceScaleFactor: 2 });

for (const width of [1512, 390]) {
  test(`Engineering Operations ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 1100 });
    const card = await open(page, await data());
    await expect(card).toContainText("Engineering Operations");
    await expect(card).toContainText("Local fixture");
    await expect(card).toContainText("Pull request open");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.screenshot({ path: join(OUT, `overview-${width}.png`) });
    await card.locator(".exec-goal-top", { hasText: "First attempt" }).last().click();
    await settle(page, 1);
    await card.screenshot({ path: join(OUT, `execution-${width}.png`) });
  });

  test(`Engineering Operations not set up ${width}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    const card = await open(page, { message: "The engineering tables aren't in the database yet: apply db/migrations/0004_engineering.sql." }, 503);
    await expect(card).toContainText("0004_engineering.sql");
    await card.screenshot({ path: join(OUT, `not-set-up-${width}.png`) });
  });
}
