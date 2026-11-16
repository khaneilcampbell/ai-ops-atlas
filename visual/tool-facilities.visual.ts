import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openAtlas, selectBuilding, settle, waitForScene } from "./atlas";

/**
 * Tool facilities (Khaneil, 2026-11-16): smaller buildings for the tools each building's agents use,
 * shown with the map's Tool facilities toggle. Screenshots only, no baselines: the toggle is off by
 * default, so every existing baseline stays as it is. Shots land in SHOT_DIR.
 */
const out = process.env.SHOT_DIR ?? "artifacts/tool-facilities";

async function open(page: Page, on: boolean) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openAtlas(page, { light: "day", storage: { mapFacilities: on } });
  await waitForScene(page);
  await settle(page, 2);
  return errors;
}

test("Tool facilities: the whole map with the toggle off, then on", async ({ page }) => {
  mkdirSync(out, { recursive: true });
  const errors = await open(page, false);
  const toggle = page.getByRole("button", { name: "Show Tool Facilities" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: `${out}/map-off.png` });
  await toggle.click();
  await settle(page, 3);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: `${out}/map-on.png` });
  expect(errors).toEqual([]);
});

test("Tool facilities: a facility close-up and its inspector", async ({ page }) => {
  mkdirSync(out, { recursive: true });
  const errors = await open(page, true);
  await selectBuilding(page, "Atlas Command Center");
  const panel = page.getByRole("complementary", { name: "Inspector" });
  await expect(panel.getByLabel("Tool facilities")).toBeVisible();
  await page.screenshot({ path: `${out}/parent-panel.png` });
  await panel.getByRole("button", { name: "Repository Office →" }).click();
  await settle(page, 4);
  await expect(panel).toContainText("Parent building");
  await expect(panel).toContainText("Integration status");
  await expect(panel).toContainText("GitHub");
  await page.screenshot({ path: `${out}/facility-closeup.png` });
  for (const [file, parent, facility] of [["benjaire", "Business Operations HQ", "AI Model Lab"], ["commerce", "Commerce Operations Center", "Repository Office"], ["agent-ops", "Agent Operations Center", "Automation Works"]]) {
    await selectBuilding(page, parent);
    await panel.getByLabel("Tool facilities").getByRole("button", { name: `${facility} →` }).click();
    await settle(page, 4);
    await page.screenshot({ path: `${out}/facility-${file}.png` });
  }
  // The Development Hub's district is too tight: its facilities say why instead of overlapping.
  await selectBuilding(page, "Development Hub");
  await expect(panel.getByLabel("Tool facilities")).toContainText("Not placed");
  expect(errors).toEqual([]);
});

test("Tool facilities on a phone", async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, true);
  await page.screenshot({ path: `${out}/phone-map-on.png` });
  expect(errors).toEqual([]);
});
