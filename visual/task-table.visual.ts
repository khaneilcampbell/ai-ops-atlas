import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";
import { NOW } from "./github";

// Task Center table (2026-11-19): at laptop and desktop widths every column fits inside the card,
// "Last run" included, and an agent with a long automation line does not push the table wide.
// The layout checks always run; screenshots only when TASK_TABLE_SHOTS names an output folder.
test.use({ deviceScaleFactor: process.env.TASK_TABLE_SHOTS ? 2 : 1 });
const shots = process.env.TASK_TABLE_SHOTS;

const iso = (ms: number) => new Date(ms).toISOString();
const KH = { kind: "person", id: "khaneil", name: "Khaneil" };
const DAY = 86_400_000;

function task(i: number, over: Record<string, unknown>) {
  const id = `task_table_${i}`;
  const at = iso(NOW - 3 * DAY - i * 60_000);
  return {
    id,
    status: "completed",
    priority: "medium",
    source: "manual",
    dependencyIds: [],
    requiresApproval: false,
    createdAt: at,
    updatedAt: at,
    rev: 2,
    createdBy: KH,
    categories: [],
    maxAttempts: 3,
    attempts: [{ id: `${id}_a1`, number: 1, idempotencyKey: `${id}_k1`, state: "succeeded", executor: "manual", requestedAt: at, requestedBy: KH, startedAt: at, finishedAt: at }],
    approvals: [],
    artifacts: [],
    usage: [],
    events: [{ id: `${id}_e1`, taskId: id, at, actor: KH, type: "created" }],
    eventsTrimmed: 0,
    ...over,
  };
}

// Shaped like the seeded workflow tasks in the 2026-11-19 report: a long automation line under the
// agent, three-word building names, and long task titles.
const tasks = {
  version: 1,
  tasks: [
    task(1, {
      title: "Marketplace publication",
      description: "Creates the Stripe product, price and payment link after Khaneil approves.",
      priority: "high",
      source: "n8n",
      agentId: "shopify-publisher",
      agentName: "Commerce · Approve and Publish Product",
      buildingId: "commerce-operations-center", buildingName: "Commerce Operations Center",
      workflow: { kind: "n8n", id: "nbjCeZ80noaGMzXr", label: "Commerce · Approve and Publish Product" },
    }),
    task(2, { title: "Approve launch", description: "Khaneil approves the launch: is the product ready?", priority: "high", buildingId: "atlas-command-center", buildingName: "Atlas Command Center" }),
    task(3, { title: "Approve development scope", description: "Khaneil approves what will be built first.", priority: "high", buildingId: "atlas-command-center", buildingName: "Atlas Command Center" }),
    task(4, { title: "Quality checks (unconfigured, do by hand)", description: "Tests the product before it ships.", buildingId: "business-operations-hq", buildingName: "Business Operations HQ" }),
    task(5, { title: "Product development (unconfigured, do by hand)", description: "Builds the approved product.", buildingId: "business-operations-hq", buildingName: "Business Operations HQ" }),
  ],
};

for (const width of [1728, 1512, 1280, 390])
  test(`Task Center table fits at ${width}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 1100 });
    await openAtlas(page, { storage: { tasks } });
    await goTo(page, "Task Center");
    await settle(page, 2);
    const card = page.locator(".task-table-card");
    await expect(card.getByText("Marketplace publication")).toBeVisible();

    // Screenshots first, so a failing run still shows what went wrong.
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/tasks-${width}.png` });
      await card.screenshot({ path: `${shots}/table-${width}.png` });
    }
    if (width <= 760) {
      // On a phone each task is a card of label/value rows; none may run past the card's right edge.
      const over = await card.evaluate((el) => {
        const right = el.getBoundingClientRect().right;
        return [...el.querySelectorAll("tr, td, .agent-identity-role")].filter((n) => n.getBoundingClientRect().right > right + 1).length;
      });
      expect(over, "rows inside the card on a phone").toBe(0);
    }
    if (width > 760) {
      // The table never runs past the card, so nothing is clipped at the right edge.
      const fit = await card.evaluate((el) => {
        const table = el.querySelector("table")!;
        return { card: el.getBoundingClientRect().right, table: table.getBoundingClientRect().right };
      });
      expect(fit.table).toBeLessThanOrEqual(fit.card + 1);
      // Short headers and values stay on one line ("Last run", not "LA / RU").
      for (const label of ["Last run", "Created", "Priority", "Status"]) {
        const th = card.locator("th", { hasText: label });
        const box = (await th.boundingBox())!;
        expect(box.x + box.width, `${label} header inside the card`).toBeLessThanOrEqual(fit.card + 1);
        const lines = await th.evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return new Set([...r.getClientRects()].map((c) => Math.round(c.top))).size;
        });
        expect(lines, `${label} header on one line`).toBe(1);
      }
    }

  });
