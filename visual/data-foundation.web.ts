import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas, settle } from "./atlas";
import { answer, NOW } from "./github";

// The Atlas database card at the bottom of the Task Center, as the hosted page shows it with the
// site's /api/data answers stubbed: connected (runs, approvals, records), not set up, and an
// approval being approved. Screenshots go to visual/out/data-foundation/ (not baselines).
// Run with: npx playwright test -c visual/data-foundation.config.ts
const OUT = process.env.DATA_SHOTS ?? join(import.meta.dirname, "out", "data-foundation");
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const G = "0b6a1d2e-3f40-4a51-8b62-7c83d9e4f5a1";
const P = "1c7b2e3f-4051-4b62-9c73-8d94e0f5a6b2";
const T1 = "2d8c3f40-5162-4c73-8d84-9ea5f1a6b7c3";
const T2 = "3e9d4051-6273-4d84-9e95-afb6a2b7c8d4";

const overview = (approvals = true) => ({
  status: { state: "ok", schemaVersion: 1, agentKeys: 1 },
  counts: { runs24h: 3, runsFailed24h: 1, approvalsPending: approvals ? 2 : 0, tasksOpen: 2 },
  runs: [
    { id: "r1", agent_id: "task-writer", workflow_id: "Atlas task writer", status: "succeeded", result_summary: "Filed 1 task from the project brief.", error: null, goal_id: G, project_id: P, task_id: T1, cost_usd: "0.0081", started_at: ago(12), finished_at: ago(11) },
    { id: "r2", agent_id: "task-writer", workflow_id: "Atlas task writer", status: "failed", result_summary: null, error: "The model's answer had no title, so nothing was saved.", goal_id: null, project_id: P, task_id: null, cost_usd: "0.0040", started_at: ago(95), finished_at: ago(94) },
    { id: "r3", agent_id: "task-writer", workflow_id: "Atlas task writer", status: "running", result_summary: null, error: null, goal_id: null, project_id: P, task_id: null, cost_usd: null, started_at: ago(1), finished_at: null },
  ],
  approvals: approvals
    ? [
        { id: "a1", kind: "fact_change", proposed_action: 'Change task "Pick a payment provider": status, priority', context: "Task writer (n8n) proposed this change to a record you own. It is applied only if you approve it.", area: "business", status: "pending", requested_by: "task-writer", target_table: "tasks", target_id: T2, payload: { fields: { status: "blocked", priority: "high" }, baseVersion: 2 }, run_id: "r1", task_id: T2, project_id: null, goal_id: null, created_at: ago(10), expires_at: null },
        { id: "a2", kind: "external_message", proposed_action: "Email the packaging supplier to reorder 200 boxes", context: "Stock of shipping boxes is below two weeks of orders.", area: "business", status: "pending", requested_by: "task-writer", target_table: null, target_id: null, payload: null, run_id: null, task_id: null, project_id: P, goal_id: null, created_at: ago(40), expires_at: new Date(NOW + 20 * 3_600_000).toISOString() },
      ]
    : [],
  records: [
    { id: G, table: "goals", label: "Grow Benjaire revenue", status: "active", area: "business", updated_at: ago(3000) },
    { id: P, table: "projects", label: "Launch the commerce pipeline", status: "active", area: "business", updated_at: ago(600) },
    { id: T1, table: "tasks", label: "Draft the Stripe product list", status: "queued", area: "business", updated_at: ago(11) },
    { id: T2, table: "tasks", label: "Pick a payment provider", status: "queued", area: "business", updated_at: ago(200) },
  ],
});

async function open(page: Page, data: (u: URL, method: string) => { status: number; json: unknown }) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/api/data/")) {
      const r = data(u, route.request().method());
      return route.fulfill({ status: r.status, json: r.json });
    }
    if (u.pathname.startsWith("/api/github")) {
      const body = answer(u.pathname.slice("/api/github".length) + u.search);
      return route.fulfill({ status: body == null ? 404 : 200, json: body ?? { message: "Not Found" } });
    }
    return route.fulfill({ status: 404, json: { message: "Not in this check." } });
  });
  await openAtlas(page);
  await goTo(page, "Task Center");
  const card = page.locator(".db-card");
  await card.scrollIntoViewIfNeeded();
  await settle(page, 1);
  return card;
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [1512, 390]) {
  test(`connected, with runs and approvals ${width}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    let decided = false;
    const card = await open(page, (u, method) => {
      if (method === "POST" && u.pathname === "/api/data/approvals/a1/decision") {
        decided = true;
        return { status: 200, json: { result: "approved" } };
      }
      return { status: 200, json: overview(!decided) };
    });
    await expect(card.getByRole("status").first()).toContainText("Connected · schema v1 · 1 agent key");
    await expect(card).toContainText("The model's answer had no title");
    await expect(card).toContainText("status → blocked");
    await card.screenshot({ path: join(OUT, `connected-${width}.png`) });
    await card.locator(".section-title").first().evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: join(OUT, `task-center-${width}.png`) });
    expect(await noHorizontalScroll(page)).toBe(true);

    await card.getByRole("button", { name: /Task: Draft the Stripe product list/ }).first().click();
    await expect(card.locator(".db-focus")).toContainText("Draft the Stripe product list");
    await card.getByRole("button", { name: "Approve" }).first().click();
    await expect(card).toContainText("Nothing is waiting for you.");
    await card.screenshot({ path: join(OUT, `approved-${width}.png`) });
  });

  test(`not set up ${width}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    const card = await open(page, () => ({ status: 503, json: { message: "The Atlas database isn't set up on the site yet (ATLAS_DB Hyperdrive binding missing)." } }));
    await expect(card.getByRole("status").first()).toContainText("Not set up");
    await card.screenshot({ path: join(OUT, `not-set-up-${width}.png`) });
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}

test("unreachable database shows the error", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const card = await open(page, () => ({ status: 503, json: { message: "Atlas couldn't reach the database." } }));
  await expect(card.getByRole("alert")).toContainText("couldn't reach the database");
  await card.screenshot({ path: join(OUT, "unreachable-1512.png") });
});
