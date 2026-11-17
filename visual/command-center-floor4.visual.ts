import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForOffice } from "./atlas";

// Atlas Command Center, Floor 4: the agent office floor built in Blender
// (assets/command-center-office). Shots of the whole floor from the interior camera, a closer
// look at desks and the meeting room, and a selected agent at its desk, on a desktop and a phone.
// FLOOR4_SHOTS=1 runs it; SHOT_DIR picks the folder (default visual/out/command-center-floor4).
const OUT = process.env.SHOT_DIR ?? join(import.meta.dirname, "out", "command-center-floor4");
// Evidence shots only (no comparison), so CI's visual time stays within its limit.
test.skip(!process.env.FLOOR4_SHOTS, "Set FLOOR4_SHOTS=1 to take Command Center Floor 4 screenshots.");

async function floor4(page: Page) {
  mkdirSync(OUT, { recursive: true });
  await openAtlas(page);
  await selectBuilding(page, "Atlas Command Center");
  await page.getByRole("button", { name: "Enter building", exact: true }).click();
  await settle(page, 2);
  await waitForOffice(page);
  await page.getByRole("navigation", { name: "Building floor navigation" }).getByRole("button", { name: "Floor 4", exact: true }).click();
  await settle(page, 4);
  await waitForOffice(page);
  // Software WebGL can lag a frame behind; let the model arrive and draw.
  await page.waitForTimeout(2500);
  await settle(page, 4);
}

async function select(page: Page, name: string) {
  const roster = page.locator(".office-roster summary");
  if (await roster.isVisible()) await roster.click();
  await settle(page, 1);
  await page.locator(".office-roster-list button", { hasText: name }).first().click();
  await settle(page, 6);
  await page.waitForTimeout(2000);
  await settle(page, 4);
}

test("Floor 4 on a desktop", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1512, height: 900 });
  await floor4(page);
  await page.screenshot({ path: join(OUT, "floor-1512.png") });
  // Closer, turned toward the back: the desks, the meeting room and the service core.
  const controls = page.locator(".office-controls");
  for (let i = 0; i < 2; i++) await controls.getByRole("button", { name: "Zoom in" }).dispatchEvent("click");
  for (let i = 0; i < 2; i++) await controls.getByRole("button", { name: "Orbit left" }).dispatchEvent("click");
  await settle(page, 6);
  await page.waitForTimeout(1500);
  await settle(page, 4);
  await page.screenshot({ path: join(OUT, "closeup-1512.png") });
  await controls.getByRole("button", { name: "Reset view" }).dispatchEvent("click");
  await settle(page, 4);
  await select(page, "Atlas Release Manager");
  await page.screenshot({ path: join(OUT, "selected-1512.png") });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("Floor 4 on an iPhone", async ({ page }) => {
    test.setTimeout(600_000);
    await floor4(page);
    await page.screenshot({ path: join(OUT, "floor-390.png") });
    await select(page, "Atlas Release Manager");
    await page.screenshot({ path: join(OUT, "selected-390.png") });
  });
});

test("entering and leaving three times loads the model once and leaves no office canvas behind", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1512, height: 900 });
  const fetched: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("command-center-floor4.glb")) fetched.push(r.url());
  });
  await openAtlas(page);
  const canvases = () => page.locator("canvas").count();
  const mapOnly = await canvases();
  for (let i = 0; i < 3; i++) {
    // After leaving, the building stays selected, so its Enter button is still there.
    const enter = page.getByRole("button", { name: "Enter building", exact: true });
    if (!(await enter.isVisible())) await selectBuilding(page, "Atlas Command Center");
    await enter.click();
    await settle(page, 2);
    await waitForOffice(page);
    await page.getByRole("navigation", { name: "Building floor navigation" }).getByRole("button", { name: "Floor 4", exact: true }).click();
    await settle(page, 4);
    await page.getByRole("button", { name: "Exit building" }).click();
    await settle(page, 4);
  }
  expect(fetched.length, "the floor model is fetched once and reused").toBe(1);
  expect(await canvases(), "the office canvas goes away on leaving").toBe(mapOnly);
});
