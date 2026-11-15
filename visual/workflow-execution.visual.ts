import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Workflow Intelligence live run with the execution panel: Khaneil starts a live run, lets Atlas
// coordinate it, and the panel shows what waits on whom and the goal report. Screenshots go to
// visual/out/workflow-execution/ (not baselines). Nothing leaves the page: n8n is read-only and
// every step here is either manual or unconfigured.
test.use({ deviceScaleFactor: 1 });
const out = process.env.WF_SHOTS ?? "visual/out/workflow-execution";

for (const width of [1512, 390])
  test(`Workflow execution panel ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await openAtlas(page);
    await goTo(page, "Mission");
    await page.locator(".ghost-btn", { hasText: "Workflow Intelligence" }).first().click();
    await settle(page, 1);
    await page.getByRole("tab", { name: "Live" }).click();
    await page.getByRole("button", { name: /Start a live run/ }).click();
    await page.getByRole("button", { name: "Create tasks" }).click();
    await settle(page, 1);
    const coordinate = page.getByRole("button", { name: "Start coordinating" });
    if (await coordinate.isVisible().catch(() => false)) {
      await coordinate.click();
      await settle(page, 1);
      await expect(page.locator(".wf-exec-list")).toContainText("Agent Operations Lead · waiting on you");
      await expect(page.locator(".wf-exec-report")).toContainText("Business outcome");
    }
    await page.locator(".wf-live").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/live-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
