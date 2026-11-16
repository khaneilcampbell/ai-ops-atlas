import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Agent Output Studio under the Execution canvas: the simulation played to the end (simulated
// samples, labelled), a step picked on the canvas highlighting its outputs, the workflow report,
// and a fresh live run (only real records, so mostly "not set up" and nothing invented).
// Screenshots go to visual/out/output-studio/ (not baselines). Nothing leaves the page.
test.use({ deviceScaleFactor: 2 });
const out = process.env.OS_SHOTS ?? "visual/out/output-studio";

for (const width of [1512, 390])
  test(`Agent Output Studio ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await openAtlas(page);
    await goTo(page, "Mission");
    await page.locator(".ghost-btn", { hasText: "Workflow Intelligence" }).first().click();
    await settle(page, 1);

    const studio = page.locator(".os-studio");
    if (!(await studio.count())) {
      // Before the Studio existed: what sits under the canvas.
      await page.locator(".wf-lower").evaluate((e) => e.scrollIntoView({ block: "start" }));
      await settle(page, 1);
      await page.screenshot({ path: `${out}/below-canvas-${width}.png` });
      return;
    }

    // Play the simulation to its end, with a person standing in for unconfigured steps.
    await page.getByLabel("Assume a person does unconfigured steps").check();
    const next = page.getByRole("button", { name: "Next step" });
    while (await next.isEnabled()) await next.click();
    await settle(page, 1);
    await expect(studio).toContainText("Simulated outputs");
    await expect(studio).toContainText("Opportunity scorecard");
    await studio.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/below-canvas-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    // Pick an output: its step is selected on the canvas and in the inspector.
    await studio.locator('.os-card[data-node="scoring"] .os-card-head').first().click();
    await settle(page, 1);
    await expect(page.locator(".wf-insp h3")).toHaveText("Opportunity scoring");
    await expect(studio.locator('.os-card.on[data-node="scoring"]').first()).toBeVisible();
    await studio.locator('.os-card[data-node="scoring"]').first().getByRole("button", { name: "Details" }).click();
    await settle(page, 1);
    await studio.locator('.os-card[data-node="scoring"]').first().evaluate((e) => e.scrollIntoView({ block: "center" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/selected-${width}.png` });

    // The consolidated report.
    await studio.getByRole("tab", { name: /Workflow report/ }).click();
    await settle(page, 1);
    await expect(studio.locator(".os-report")).toContainText("Every line is a simulated sample");
    await studio.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/report-${width}.png` });

    // A fresh live run: only real records.
    await page.getByRole("tab", { name: "Live" }).click();
    await page.getByRole("button", { name: /Start a live run/ }).click();
    await page.getByRole("button", { name: "Create tasks" }).click();
    await settle(page, 1);
    await studio.getByRole("tab", { name: /All outputs/ }).click();
    await expect(studio).toContainText("Live outputs come only from");
    await expect(studio.locator(".os-badge.v-sim")).toHaveCount(0);
    await studio.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/live-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
