import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas, settle } from "./atlas";
import { answer, NOW } from "./github";

// Agent memory (migration 0003) on the two screens it extends, with the site's /api/data answers
// stubbed: the Task Center database card (runs told apart by execution number, a run that stopped
// reporting, memory waiting for review, a verify click) and an agent's Operations tab (memory,
// verified procedure, runs, related jobs, performance). MEMORY=0 shows the card as it was before.
// Screenshots go to visual/out/agent-memory/ (not baselines).
// Run with: npx playwright test -c visual/agent-memory.config.ts
const OUT = process.env.MEMORY_SHOTS ?? join(import.meta.dirname, "out", "agent-memory");
const WITH_MEMORY = process.env.MEMORY !== "0";
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const P = "1c7b2e3f-4051-4b62-9c73-8d94e0f5a6b2";

const mem = (over: Record<string, unknown>) => ({
  id: "m0",
  category: "operational",
  kind: "lesson",
  title: "",
  content: "",
  tags: [],
  area: "business",
  agent_id: null,
  task_key: null,
  workflow_id: "aYk4xDGoE4HgAi2G",
  error_class: null,
  source_kind: "run",
  source_ref: "run 3f86a751",
  source_url: null,
  run_id: null,
  verification: "unverified",
  verified_by: null,
  verified_at: null,
  suspicious: null,
  supersedes: null,
  expires_at: null,
  review_at: new Date(NOW + 80 * 86_400_000).toISOString(),
  use_count: 0,
  last_used_at: null,
  created_by: "task-writer",
  created_at: ago(300),
  updated_at: ago(300),
  version: 1,
  ...over,
});

const lesson = mem({ id: "m1", title: "Registry sheet append times out above 500 rows", content: "Split the rows into batches of 200 and append each batch; the run that did this finished in 41 s.", task_key: "registry-sync", error_class: "sheets.timeout" });
const procedure = mem({ id: "m2", kind: "procedure", title: "File the daily review task once per day", content: "Run memory/prepare with task key task-desk:daily-scan:<date>; on skip, record nothing; on create, file the task with the same dedupe_key.", verification: "verified", verified_by: "Khaneil", verified_at: ago(1000), use_count: 4, created_at: ago(2000), updated_at: ago(1000), task_key: "task-desk:daily-scan" });

const runs = [
  { id: "r1", agent_id: "task-writer", workflow_id: "aYk4xDGoE4HgAi2G", external_run_id: "879", status: "succeeded", result_summary: "Task desk (daily scan): filed 0 new tasks, 1 already in Atlas.", error: null, goal_id: null, project_id: null, task_id: null, cost_usd: null, started_at: ago(30), finished_at: ago(30), task_key: "task-desk:daily-scan:2026-10-28", attempt: 1 },
  { id: "r2", agent_id: "task-writer", workflow_id: "aYk4xDGoE4HgAi2G", external_run_id: "878", status: "succeeded", result_summary: "Task desk (daily scan): filed 1 new task, 0 already in Atlas.", error: null, goal_id: null, project_id: null, task_id: null, cost_usd: null, started_at: ago(31), finished_at: ago(30.9), task_key: "task-desk:daily-scan:2026-10-28", attempt: 1 },
  { id: "r3", agent_id: "task-writer", workflow_id: "aYk4xDGoE4HgAi2G", external_run_id: "842", status: WITH_MEMORY ? "timed_out" : "running", result_summary: null, error: WITH_MEMORY ? "Atlas heard nothing from this run (no finish, heartbeat or lease renewal) and stopped counting it as running." : null, goal_id: null, project_id: P, task_id: null, cost_usd: null, started_at: ago(2 * 1440 + 200), finished_at: null, task_key: null, attempt: 1 },
];

const overview = (reviewed: boolean) => ({
  status: { state: "ok", schemaVersion: WITH_MEMORY ? 3 : 1, agentKeys: 1 },
  counts: { runs24h: 2, runsFailed24h: 0, approvalsPending: 0, tasksOpen: 2 },
  runs: WITH_MEMORY ? runs : runs.map(({ external_run_id: _e, task_key: _k, attempt: _a, ...r }) => r),
  approvals: [],
  records: [{ id: P, table: "projects", label: "Launch the commerce pipeline", status: "active", area: "business", updated_at: ago(600) }],
  memory: WITH_MEMORY
    ? { counts: { live: 6, verified: reviewed ? 4 : 3, unverified: reviewed ? 1 : 2, disputed: 0, procedures: 1, staleReview: 0 }, toReview: reviewed ? [] : [lesson], decisions30d: { create: 4, skip: 3, retry: 1, resume: 1 }, tokensSaved30d: 14_200, runsTimedOut: 1, lastSweep: ago(2) }
    : undefined,
});

const agentMemory = {
  agentId: "atlas-task-writer",
  memory: [procedure, lesson],
  runs: runs.map((r, i) => ({ ...r, verdict: i === 0 ? "passed" : i === 1 ? "passed" : null, error_class: null, retryable: null, quality_score: i < 2 ? 95 : null, duration_ms: i === 1 ? 5600 : null })),
  performance: { runs30d: 9, succeeded30d: 7, failed30d: 1, timedOut30d: 1, passedChecks30d: 6, medianDurationMs: 18_000, costUsd30d: 0, tokensSaved30d: 14_200, duplicatesPrevented30d: 3 },
  related: [
    { taskKey: "task-desk:daily-scan:2026-10-28", runs: 2, lastStatus: "succeeded", lastAt: ago(30) },
    { taskKey: "registry-sync", runs: 3, lastStatus: "failed", lastAt: ago(400) },
  ],
};

async function stub(page: Page) {
  let reviewed = false;
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/data/memory/m1/review") {
      reviewed = true;
      return route.fulfill({ status: 200, json: { result: "verified" } });
    }
    if (u.pathname.startsWith("/api/data/memory/agents/")) return route.fulfill(WITH_MEMORY ? { status: 200, json: agentMemory } : { status: 503, json: { message: "Agent memory needs database migration 0003 (docs/agent-memory.md)." } });
    if (u.pathname.startsWith("/api/data/")) return route.fulfill({ status: 200, json: overview(reviewed) });
    if (u.pathname.startsWith("/api/github")) {
      const body = answer(u.pathname.slice("/api/github".length) + u.search);
      return route.fulfill({ status: body == null ? 404 : 200, json: body ?? { message: "Not Found" } });
    }
    return route.fulfill({ status: 404, json: { message: "Not in this check." } });
  });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [1512, 390]) {
  test(`Task Center database card ${width}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await stub(page);
    await openAtlas(page);
    await goTo(page, "Task Center");
    const card = page.locator(".db-card");
    await card.scrollIntoViewIfNeeded();
    await settle(page, 1);
    if (WITH_MEMORY) {
      await expect(card).toContainText("Run #879");
      await expect(card).toContainText("Stopped reporting");
      await expect(card).toContainText("Agent memory");
    }
    await card.screenshot({ path: join(OUT, `card-${width}.png`) });
    expect(await noHorizontalScroll(page)).toBe(true);
    if (WITH_MEMORY) {
      await card.getByRole("button", { name: "Verify" }).click();
      await expect(card).toContainText("No agent lesson or procedure is waiting for you to check.");
      await card.locator(".db-memory").screenshot({ path: join(OUT, `card-verified-${width}.png`) });
    }
  });

  test(`Agent page operations ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await stub(page);
    await openAtlas(page, { storage: { "registry-prefs-agents": { view: "all" } } });
    await goTo(page, "Agents");
    await page.getByRole("button", { name: /Database Task Writer/ }).first().click();
    await settle(page, 1);
    // Desktop: the agent page's Operations tab. Phone: the details sheet's Overview, which has it too.
    const ops = page.getByRole("tab", { name: /^Operations/ });
    if (await ops.isVisible().catch(() => false)) await ops.click();
    await settle(page, 1);
    const panel = page.locator(".agent-memory");
    await expect(panel).toContainText(WITH_MEMORY ? "Verified procedures" : "migration 0003");
    await panel.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: join(OUT, `agent-${width}.png`) });
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}
