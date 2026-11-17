import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Phase 8 executive goals in Mission Control: intake, the validated plan, the plan started (tasks in
// the Task Center, no execution) and an on-demand briefing. Screenshots go to
// visual/out/executive-goals/ (not baselines). Nothing outside Atlas is called.
test.use({ deviceScaleFactor: 2 });
const out = process.env.EXEC_SHOTS ?? "visual/out/executive-goals";

for (const width of [1512, 390])
  test(`Executive goals ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await openAtlas(page);
    await goTo(page, "Mission");
    const exec = page.locator(".exec");
    await expect(exec).toContainText("Executive goals");
    await exec.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/empty-${width}.png` });

    await exec.getByRole("button", { name: "Set a goal" }).click();
    await exec.getByRole("button", { name: "Identify, validate and prepare an AI automation product for Benjaire" }).click();
    await page.screenshot({ path: `${out}/intake-${width}.png` });
    await exec.getByRole("button", { name: /Save goal/ }).click();
    await settle(page, 1);
    await expect(exec).toContainText("Plan ready for review");
    await expect(exec).toContainText("Product Scoring Analyst");
    await exec.locator(".exec-goal").first().evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/plan-${width}.png` });

    await exec.getByRole("button", { name: "Approve plan" }).click();
    await exec.getByRole("button", { name: /Start plan/ }).click();
    await settle(page, 1);
    await expect(exec).toContainText("In progress");
    await expect(exec).toContainText("0 of");
    await exec.locator(".exec-goal").first().evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${out}/running-${width}.png` });

    await exec.getByRole("button", { name: "Right now" }).click();
    await settle(page, 1);
    await exec.locator(".exec-brief").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await expect(exec.locator(".exec-brief")).toContainText("No model was used");
    await page.screenshot({ path: `${out}/briefing-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
