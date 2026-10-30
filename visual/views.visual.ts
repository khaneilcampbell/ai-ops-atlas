import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas, selectBuilding, settle, waitForOffice, waitForScene } from "./atlas";

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
  // A view added since the last baseline update has nothing to compare with yet: keep the
  // screenshot as a result instead of failing, until the next update run records it.
  if (!existsSync(test.info().snapshotPath(`${name}.png`, { kind: "screenshot" }))) {
    test.info().annotations.push({ type: "no baseline", description: `${name}.png is new; run the visual workflow with 'update' to record it.` });
    await page.screenshot({ path: test.info().outputPath(`${name}.png`), animations: "disabled", caret: "hide" });
    return;
  }
  await expect(page).toHaveScreenshot(`${name}.png`);
}

/** Agents → Manage agents, with one agent's details open. */
async function openManage(page: Page) {
  await openAtlas(page, { storage: { "registry-prefs-agents": { sub: "manage" } } });
  await goTo(page, "Agents");
  await expect(page.getByRole("heading", { name: "Manage agents" })).toBeVisible();
  await expect(page.locator(".manage-table .status").first()).toHaveText("Enabled");
  await page.getByRole("button", { name: /Details for Merge Flow/ }).click();
  await settle(page, 1);
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
  await selectBuilding(page, "Atlas HQ");
  await check(page, "map-selected");
});

test("office", async ({ page }) => {
  await openAtlas(page);
  await selectBuilding(page, "Atlas HQ");
  await page.getByRole("button", { name: "Enter building" }).click();
  await settle(page, 4);
  await waitForOffice(page);
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

test("agents, manage", async ({ page }) => {
  await openManage(page);
  // Keyboard: the details button is reachable and toggles.
  const toggle = page.getByRole("button", { name: /Hide for Merge Flow/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await check(page, "agents-manage");
  // The building opens the map with that building selected.
  await page.getByRole("button", { name: "Show GitHub Profile on the map" }).first().click();
  await settle(page);
  await expect(page.locator(".map-stage")).toBeVisible();
  await expect(page.getByText("GitHub Profile").first()).toBeVisible();
});

// iPhone-size checks: the phone layout in mobile.css and the phone camera in Map3D.
test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("map", async ({ page }) => {
    await openAtlas(page);
    await waitForScene(page);
    // Every toolbar control sits inside the screen.
    const box = await page.locator(".map-controls").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await check(page, "phone-map");
  });

  test("map, building selected", async ({ page }) => {
    await openAtlas(page);
    await waitForScene(page);
    await selectBuilding(page, "Atlas HQ");
    await check(page, "phone-map-selected");
  });

  test("agents, manage", async ({ page }) => {
    await openManage(page);
    // No sideways scroll on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await check(page, "phone-agents-manage");
  });
});
