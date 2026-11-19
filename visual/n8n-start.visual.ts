import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Starting an allow-listed n8n workflow from the Task Center: a task on "Commerce · Add product idea",
// its Execution callout, the input form drawn from the workflow's schema, and the review step.
// Nothing is sent: the shots stop before Confirm. Screenshots go to visual/out/n8n-start/.
test.use({ deviceScaleFactor: 1 });
const out = process.env.N8N_START_SHOTS ?? "visual/out/n8n-start";

for (const width of [1512, 390])
  test(`n8n start ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await openAtlas(page);
    await goTo(page, "Task Center");
    await page.getByRole("button", { name: "New task" }).first().click();
    await page.getByLabel("Title").fill("Queue the 90-Day Planner");
    // The commerce Design Run agent runs the Add product idea workflow.
    await page.getByRole("radio", { name: /^Commerce · Draft Product and Designs/ }).dispatchEvent("click");
    const wf = page.locator(".task-field", { hasText: "Workflow" }).locator("select");
    const value = await wf.locator("option", { hasText: "Add product idea" }).first().getAttribute("value");
    await wf.selectOption(value!);
    await page.locator(".task-panel .task-callout").last().scrollIntoViewIfNeeded();
    await settle(page, 1);
    await page.screenshot({ path: `${out}/form-callout-${width}.png` });
    await page.getByRole("button", { name: "Create task" }).click();
    await settle(page, 1);
    // Creating a task opens it.
    if (!(await page.getByRole("dialog", { name: "Task details" }).isVisible().catch(() => false))) {
      await page.locator(".task-title", { hasText: "Queue the 90-Day Planner" }).first().click();
      await settle(page, 1);
    }
    await page.screenshot({ path: `${out}/task-${width}.png` });
    const start = page.getByRole("button", { name: "Start in n8n" });
    if (!(await start.isVisible().catch(() => false))) return; // main: read-only
    await start.click();
    await page.getByLabel("Product name *").fill("90-Day Small Business Planner");
    await page.getByLabel("Who is it for? *").fill("new freelance designers");
    await page.getByLabel("Notes for Claude (optional)").fill("Weekly pages, a goals page and a simple cash tracker.");
    await page.locator(".n8n-start").scrollIntoViewIfNeeded();
    await settle(page, 1);
    await page.screenshot({ path: `${out}/start-form-${width}.png` });
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("button", { name: /Confirm and start/ })).toBeVisible();
    await page.locator(".n8n-start").scrollIntoViewIfNeeded();
    await settle(page, 1);
    await page.screenshot({ path: `${out}/start-review-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
