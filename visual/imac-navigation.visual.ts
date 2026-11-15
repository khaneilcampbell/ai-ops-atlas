import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForOffice, waitForScene } from "./atlas";

// Mouse and keyboard navigation, as on an iMac, with real (trusted) key and wheel events from
// Chromium. Not a screenshot comparison: it reads the camera and checks each control moved it
// the right way, and writes PNGs of the Controls panel to visual/out/imac-navigation/.
// The interior check takes a few minutes of software WebGL, so it runs only with IMAC_NAV=1.

test.use({ deviceScaleFactor: 1 });
const out = join(import.meta.dirname, "out", "imac-navigation");

type Cam = { x: number; y: number; z: number; dx: number; dy: number; dz: number; tx: number; tz: number; d: number };

/** The camera of the first live canvas matching `selector`, and the point its controls look at. */
async function camera(page: Page, selector = ".map3d canvas"): Promise<Cam> {
  return page.evaluate(async (sel) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Renderer missing");
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const canvas = [...document.querySelectorAll<HTMLCanvasElement>(sel)].find((c) => fiber._roots.has(c))!;
    const state = fiber._roots.get(canvas)!.store.getState();
    const c = state.camera;
    c.updateMatrixWorld();
    const d = c.getWorldDirection(c.position.clone());
    const t = (state.controls as unknown as { target?: { x: number; y: number; z: number } } | null)?.target ?? { x: 0, y: 0, z: 0 };
    return { x: c.position.x, y: c.position.y, z: c.position.z, dx: d.x, dy: d.y, dz: d.z, tx: t.x, tz: t.z, d: Math.hypot(c.position.x - t.x, c.position.y - t.y, c.position.z - t.z) };
  }, selector);
}

const moved = (a: Cam, b: Cam) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const turned = (a: Cam, b: Cam) => Math.hypot(a.dx - b.dx, a.dy - b.dy, a.dz - b.dz);
/** How far the camera moved along the way it looks, on the ground. */
const forward = (a: Cam, b: Cam) => {
  const h = Math.hypot(a.dx, a.dz);
  return ((b.x - a.x) * a.dx + (b.z - a.z) * a.dz) / h;
};

/** Holds a key down for a few clock steps. */
async function hold(page: Page, key: string, steps = 3) {
  await page.keyboard.down(key);
  await settle(page, steps);
  await page.keyboard.up(key);
  await settle(page, 1);
}

test("iMac: a click focuses the map, then keys and Command-scroll move it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openAtlas(page, { light: "day" });
  await waitForScene(page);

  // A plain click on the map gives it the keys, as the Controls panel says.
  const box = (await page.locator(".map3d canvas").boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + box.height - 30);
  await settle(page, 1);
  expect(await page.evaluate(() => document.activeElement?.classList.contains("map-stage"))).toBe(true);

  // W moves forward along the ground, at the same height and angle.
  let before = await camera(page);
  await hold(page, "w");
  let after = await camera(page);
  expect(forward(before, after)).toBeGreaterThan(0.5);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
  expect(turned(before, after)).toBeLessThan(1e-6);

  // D moves right, and Shift with the left arrow moves back the other way.
  before = after;
  await hold(page, "d");
  after = await camera(page);
  expect(moved(before, after)).toBeGreaterThan(0.5);
  before = after;
  await page.keyboard.down("Shift");
  await hold(page, "ArrowLeft");
  await page.keyboard.up("Shift");
  after = await camera(page);
  expect(moved(before, after)).toBeGreaterThan(0.5);

  // F tilts toward the horizon (the camera comes down), R back up toward a top-down view.
  before = after;
  await hold(page, "f");
  after = await camera(page);
  expect(after.y).toBeLessThan(before.y - 0.1);
  before = after;
  await hold(page, "r");
  after = await camera(page);
  expect(after.y).toBeGreaterThan(before.y + 0.1);

  // Command with a scroll zooms, even for a Magic Mouse scroll that reads as a trackpad.
  await page.waitForTimeout(450);
  before = after;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Meta");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(1, -15);
  await page.keyboard.up("Meta");
  await settle(page, 2);
  after = await camera(page);
  expect(after.d).toBeLessThan(before.d - 0.5);

  // Keys typed in the search box never move the map.
  before = after;
  await page.locator("input[type=search], .search input").first().click();
  await page.keyboard.type("wasd");
  await settle(page, 2);
  after = await camera(page);
  expect(moved(before, after)).toBeLessThan(1e-6);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("iMac: the Controls panel lists every control for both Macs", async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  await page.getByRole("button", { name: "Map controls" }).click();
  await settle(page, 1);
  const panel = page.getByRole("dialog", { name: "Map controls" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("iMac mouse and keyboard");
  await expect(panel).toContainText("W A S D");
  await page.screenshot({ path: join(out, "controls-panel.png") });
  // ? on the focused map opens and closes it too.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.locator(".map-stage").focus();
  await page.keyboard.press("?");
  await expect(panel).toBeVisible();
});

test("iMac: keys look and walk around inside a building", async ({ page }) => {
  test.skip(!process.env.IMAC_NAV, "Set IMAC_NAV=1 to check keyboard moves inside a building.");
  test.setTimeout(300_000);
  mkdirSync(out, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  await selectBuilding(page, "Atlas Command Center");
  await settle(page, 2);
  await page.getByRole("button", { name: "Enter building", exact: true }).click();
  await settle(page, 4);
  await waitForOffice(page);
  for (let i = 0; i < 8; i++) await settle(page, 3);
  const sel = ".office-layer canvas";
  const start = await camera(page, sel);
  await page.screenshot({ path: join(out, "office-before.png") });

  // E turns the view round the room at the same distance.
  await hold(page, "e", 6);
  const turnedView = await camera(page, sel);
  const side = (c: Cam) => Math.atan2(c.x - c.tx, c.z - c.tz);
  expect(Math.abs(side(turnedView) - side(start))).toBeGreaterThan(0.3);
  expect(Math.abs(turnedView.d - start.d)).toBeLessThan(0.05 * start.d);

  // W walks the point looked at across the floor.
  await hold(page, "w", 4);
  const walked = await camera(page, sel);
  expect(Math.hypot(walked.tx - turnedView.tx, walked.tz - turnedView.tz)).toBeGreaterThan(0.3);

  // Plus zooms in.
  await hold(page, "=", 4);
  const closer = await camera(page, sel);
  expect(closer.d).toBeLessThan(walked.d - 0.3);
  await page.screenshot({ path: join(out, "office-moved.png") });

  // 0 goes back to the view the room opened with.
  await page.keyboard.press("0");
  await settle(page, 2);
  const home = await camera(page, sel);
  expect(moved(home, start)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});
