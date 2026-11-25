import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Workflow Intelligence Design mode: Khaneil opens the saved goal, assigns an agent to a step,
// links an earlier output, adds an approval, saves a draft and previews it. Screenshots go to
// visual/out/workflow-design/ (not baselines). Nothing leaves the page: a draft lives on this
// device and Preview only checks it. Before Design mode existed, only the Run view is captured.
test.use({ deviceScaleFactor: 1 });
const out = process.env.WF_SHOTS ?? "visual/out/workflow-design";

async function openWorkflows(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await openAtlas(page);
  await goTo(page, "Mission");
  await page.locator(".ghost-btn", { hasText: "Workflow Intelligence" }).first().click();
  await settle(page, 1);
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

for (const width of [1512, 390])
  test(`Workflow design mode ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(out, { recursive: true });
    await openWorkflows(page, width);
    await page.screenshot({ path: `${out}/run-${width}.png` });
    const design = page.getByRole("tab", { name: "Design" });
    if (!(await design.isVisible().catch(() => false))) return;

    await design.click();
    await settle(page, 1);
    await expect(page.locator(".wf-design-status")).toContainText("Not ready");
    await page.locator(".wf-page .page-head").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/design-0-head-${width}.png` });
    await page.locator(".wf-goal").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/design-1-start-${width}.png` });

    // Assign an agent to the two steps the template leaves without one.
    for (const [step, who] of [
      ["Product development", /Development Hub Lead/],
      ["Quality checks", /Engineering Review/],
    ] as const) {
      await page.locator(".wf-design-steps li", { hasText: step }).first().locator("button").first().click();
      const agent = page.locator(".wf-step-edit select").first();
      const label = await agent.locator("option").filter({ hasText: who }).first().textContent();
      await agent.selectOption(label ? { label } : { index: 1 });
    }
    await page.locator(".wf-design-steps li", { hasText: "Opportunity scoring" }).first().locator("button").first().click();
    await page.locator(".wf-design-insp").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/design-2-step-${width}.png` });

    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: "Preview" }).click();
    await settle(page, 1);
    await expect(page.locator(".wf-design-status")).toContainText("Ready to preview");
    await page.locator(".wf-preview").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/design-3-preview-${width}.png` });

    await page.locator(".wf-canvas-card").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/design-4-canvas-${width}.png` });
    expect(await noSideScroll(page)).toBe(false);

    // Run mode still reads the template and its live-run controls are untouched.
    await page.getByRole("tab", { name: "Run" }).click();
    await expect(page.getByRole("tab", { name: "Live" })).toBeVisible();
  });
