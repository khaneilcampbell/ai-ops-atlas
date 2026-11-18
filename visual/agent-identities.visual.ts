import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";
import { NOW } from "./github";

// Agent identities (2026-11-18): the Agents directory, one agent's inspector, the task form's
// agent picker and a task's detail with its agent. Screenshots only, into
// visual/out/agent-identities/ (IDENTITY_SHOTS overrides), not baselines. Runs on main too,
// for before shots: steps that need the new picker are skipped there.
test.use({ deviceScaleFactor: 2 });
const out = process.env.IDENTITY_SHOTS ?? "visual/out/agent-identities";

const iso = (ms: number) => new Date(ms).toISOString();
const KH = { kind: "person", id: "khaneil", name: "Khaneil" };
const AGENT = { kind: "agent", id: "benjaire-inquiry-manager", name: "Benjaire Inquiry Manager" };
const tasks = {
  version: 1,
  tasks: [
    {
      id: "task_identity_1",
      title: "Reply to the wholesale inquiry from Lagos",
      description: "Seeded for the screenshot.",
      status: "awaiting_approval",
      priority: "medium",
      source: "manual",
      dependencyIds: [],
      requiresApproval: true,
      createdAt: iso(NOW - 3 * 3_600_000),
      updatedAt: iso(NOW - 20 * 60_000),
      rev: 3,
      createdBy: KH,
      agentId: "benjaire-inquiry-manager",
      agentName: "Benjaire Inquiry Manager",
      categories: [],
      maxAttempts: 3,
      attempts: [],
      approvals: [],
      artifacts: [],
      usage: [],
      events: [
        { id: "e1", taskId: "task_identity_1", at: iso(NOW - 3 * 3_600_000), actor: KH, type: "created" },
        { id: "e2", taskId: "task_identity_1", at: iso(NOW - 20 * 60_000), actor: AGENT, type: "approval_requested" },
      ],
      eventsTrimmed: 0,
    },
  ],
};

for (const width of [1512, 390])
  test(`Agent identities ${width}`, async ({ page }) => {
    test.setTimeout(240_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await openAtlas(page, { storage: { tasks, "registry-prefs-agents": { view: "all" } } });

    await goTo(page, "Agents");
    await settle(page, 2);
    await page.screenshot({ path: `${out}/agents-${width}.png` });

    await page.locator('.reg-row[data-id="benjaire-inquiry-manager"]').click();
    await settle(page, 2);
    await page.screenshot({ path: `${out}/inspector-${width}.png` });
    await page.keyboard.press("Escape");

    await goTo(page, "Task Center");
    await settle(page, 2);
    await page.screenshot({ path: `${out}/tasks-${width}.png` });
    await page.getByText("Reply to the wholesale inquiry from Lagos").first().click();
    await settle(page, 2);
    await page.screenshot({ path: `${out}/task-detail-${width}.png` });

    await page.keyboard.press("Escape");
    await settle(page, 1);
    const close = page.getByRole("button", { name: /^Close/ }).first();
    if (await close.isVisible().catch(() => false)) await close.click();
    await settle(page, 1);
    await page.getByRole("button", { name: "New task" }).first().click();
    await settle(page, 2);
    const picker = page.getByRole("radiogroup", { name: "Agent" });
    if (await picker.isVisible().catch(() => false)) {
      await picker.evaluate((e) => e.scrollIntoView({ block: "start" }));
      await settle(page, 1);
    } else {
      await page.locator("select").filter({ hasText: "Unassigned" }).first().evaluate((e) => e.scrollIntoView({ block: "start" })).catch(() => {});
    }
    await page.screenshot({ path: `${out}/task-form-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
