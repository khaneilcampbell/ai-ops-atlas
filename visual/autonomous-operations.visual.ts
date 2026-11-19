import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";
import { NOW } from "./github";

// Phase 9 autonomous operations in Mission Control, with two seeded Task Center records (a failed
// n8n step and one past its timeout) that the real derivation turns into incidents. Then the
// emergency stop, and the incident as a workflow in Workflow Intelligence with its Output Studio
// cards. Screenshots go to visual/out/autonomous-operations/ (not baselines). Nothing outside runs.
test.use({ deviceScaleFactor: 2 });
const out = process.env.OPS_SHOTS ?? "visual/out/autonomous-operations";

const iso = (ms: number) => new Date(ms).toISOString();
const KH = { kind: "person", id: "khaneil", name: "Khaneil" };
const task = (id: string, title: string, status: string, attempt: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  description: "Seeded for the screenshot.",
  status,
  priority: "medium",
  source: "manual",
  dependencyIds: [],
  requiresApproval: false,
  createdAt: iso(NOW - 9 * 3_600_000),
  updatedAt: iso(NOW - 20 * 60_000),
  rev: 3,
  createdBy: KH,
  workflow: { kind: "n8n", id: "tGYMec2rp0twZFxv", label: "Atlas · Step Runner" },
  categories: [],
  maxAttempts: 3,
  attempts: [{ id: `${id}-a1`, number: 1, idempotencyKey: `${id}:1`, executor: "n8n", requestedAt: iso(NOW - 8 * 3_600_000), requestedBy: KH, startedAt: iso(NOW - 8 * 3_600_000), ...attempt }],
  approvals: [],
  artifacts: [],
  usage: [],
  events: [],
  eventsTrimmed: 0,
  ...extra,
});

const tasks = {
  version: 1,
  tasks: [
    task("task_ops_failed", "Market scan for Benjaire product ideas", "failed", { state: "failed", finishedAt: iso(NOW - 20 * 60_000), error: "n8n answered 503; try again shortly." }, { error: "n8n answered 503; try again shortly." }),
    task("task_ops_stalled", "Competitor pricing check", "running", { state: "running" }),
  ],
};

for (const width of [1512, 390])
  test(`Autonomous operations ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await openAtlas(page, { storage: { tasks } });
    await goTo(page, "Mission");
    const ops = page.locator(".ops");
    await expect(ops).toContainText("Autonomous operations");
    await expect(ops).toContainText("Stalled: Competitor pricing check");
    await ops.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/overview-${width}.png` });

    await ops.locator(".ops-inc-top", { hasText: "Stalled" }).click();
    await expect(ops).toContainText("Reconcile an uncertain workflow execution");
    await ops.locator(".ops-inc").first().evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/incident-${width}.png` });

    await ops.locator(".ops-policies").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/policies-${width}.png` });

    await ops.getByRole("button", { name: "Emergency stop" }).click();
    await expect(ops.locator(".ops-stop")).toContainText("Emergency stop is on");
    await ops.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/stopped-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    await ops.getByRole("button", { name: "Workflow Intelligence" }).first().click();
    await settle(page, 2);
    // Pick the incident in the goal list and its live view (the dev server's StrictMode can use up the one-time focus).
    const wf = page.locator(".wf-page");
    const value = await wf.locator(".wf-goal-pick select option", { hasText: "Stalled" }).first().getAttribute("value");
    await wf.locator(".wf-goal-pick select").selectOption(value!);
    await wf.getByRole("tab", { name: "Live" }).click();
    await settle(page, 2);
    await expect(wf.locator(".wf-goal-name")).toContainText("Incident ·");
    await page.screenshot({ path: `${out}/workflow-${width}.png` });
    await page.locator(".wf-page").getByText("Incident summary").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/outputs-${width}.png` });
  });
