import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openAtlas, settle, waitForScene, selectBuilding } from "./atlas";

/**
 * Agents' faces over a building's nameplate (BuildingFaces.tsx): on hover at desktop width, on a tap
 * (selection) on a phone. Review shots, like residence-agents.visual.ts: they run only when FACES_SHOT_DIR
 * is set, so the CI shards stay inside their time limit (buildingOccupants.test.ts covers the data).
 * FACES_BEFORE=1 runs the same steps on a build without the feature (no checks).
 */
const dir = process.env.FACES_SHOT_DIR;
test.skip(!dir, "Set FACES_SHOT_DIR to a folder to take these review shots");
const before = !!process.env.FACES_BEFORE;
const shot = async (page: Page, name: string) => {
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
};
const plaque = (page: Page, name: string) => page.locator(`.m3-plaque[title^=${JSON.stringify(name + " ·")} i]`).first();

test("faces over a building name on hover, desktop", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1512, height: 900 });
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  await plaque(page, "Atlas Command Center").hover();
  await settle(page, 2);
  if (!before) {
    const faces = page.locator(".m3-faces");
    await expect(faces).toBeVisible();
    await expect(faces).toContainText("Works here");
    await expect(faces.locator(".m3-face img").first()).toBeVisible();
    // Moving onto a face keeps the card open, and a click opens that agent's card.
    await faces.locator(".m3-face").first().hover();
    await expect(faces).toBeVisible();
  }
  await shot(page, "1512-command-center-hover");
  await page.mouse.move(5, 450);
  await settle(page, 1);
  if (!before) await expect(page.locator(".m3-faces")).toHaveCount(0);

  await selectBuilding(page, "Financial District");
  await page.mouse.move(5, 450);
  await settle(page, 2);
  await plaque(page, "Team Residence Towers").hover();
  await settle(page, 2);
  if (!before) await expect(page.locator(".m3-faces")).toContainText("Lives here");
  await shot(page, "1512-residence-hover");
});

test("faces over a tapped building name, phone", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  await selectBuilding(page, "Atlas Command Center");
  await settle(page, 2);
  if (!before) await expect(page.locator(".m3-faces")).toBeVisible();
  await shot(page, "390-command-center-tap");
});
