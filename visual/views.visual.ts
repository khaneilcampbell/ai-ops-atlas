import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas, selectBuilding, settle, waitForScene } from "./atlas";

// Each key view, compared against visual/baselines/<local|ci>/<name>.png.
// SHOTS=1 skips the comparison and writes the screenshots to visual/out/ instead, for looking at.
// BASELINE=1 writes them straight over the baselines. One capture of a frozen frame is enough;
// Playwright's own update mode retakes each until two match, which is slow with software WebGL.
const SHOTS = !!process.env.SHOTS;
const BASELINE = !!process.env.BASELINE;
const OUT = join(import.meta.dirname, "out");

async function check(page: Page, name: string) {
  if (BASELINE) {
    await page.screenshot({ path: test.info().snapshotPath(`${name}.png`, { kind: "screenshot" }), animations: "disabled", caret: "hide" });
    return;
  }
  if (SHOTS) {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, `${name}.png`), animations: "disabled", caret: "hide" });
    return;
  }
  await expect(page).toHaveScreenshot(`${name}.png`);
}

test("map, day", async ({ page }) => {
  await openAtlas(page, { light: "day" });
  await expect(page.locator("canvas").first()).toBeVisible();
  await waitForScene(page);
  await check(page, "map-day");
});

test("map, night", async ({ page }) => {
  await openAtlas(page, { light: "night" });
  await expect(page.locator("canvas").first()).toBeVisible();
  await waitForScene(page);
  await check(page, "map-night");
});

test("map, building selected", async ({ page }) => {
  await openAtlas(page);
  await selectBuilding(page, "AI Ops Atlas");
  await check(page, "map-selected");
});

test("office", async ({ page }) => {
  await openAtlas(page);
  await selectBuilding(page, "AI Ops Atlas");
  await page.getByRole("button", { name: "Enter building" }).click();
  await settle(page, 4);
  await waitForScene(page);
  await check(page, "office");
});

test("mission control", async ({ page }) => {
  await openAtlas(page, { storage: { "mission-tab": "overview" } });
  await goTo(page, "Mission");
  await check(page, "mission-control");
});

test("mission control, active agents", async ({ page }) => {
  await openAtlas(page);
  await goTo(page, "Mission");
  const tab = page.getByRole("button", { name: "Active agents" }).or(page.getByRole("tab", { name: "Active agents" }));
  test.skip((await tab.count()) === 0, "This build has no Active agents tab yet.");
  await tab.first().click();
  await settle(page);
  await check(page, "active-agents");
});
