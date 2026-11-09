import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// Trackpad navigation on the 3D map, with real (trusted) wheel events from Chromium. Not a
// screenshot test: it reads the camera and checks each gesture moved it the right way.
// Chromium reports a pinch as a ctrl wheel, so that path is covered for real; Safari's
// GestureEvents are synthesized, which is enough to check the handler but not WebKit itself.

test.use({ deviceScaleFactor: 1 });

type Cam = { x: number; y: number; z: number; dx: number; dy: number; dz: number };

/** Camera position and view direction, read from the map's renderer. */
async function camera(page: Page): Promise<Cam> {
  return page.evaluate(async () => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Map renderer missing");
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const state = fiber._roots.get(document.querySelector("canvas")!)!.store.getState();
    const c = state.camera;
    c.updateMatrixWorld();
    const d = c.getWorldDirection(c.position.clone());
    return { x: c.position.x, y: c.position.y, z: c.position.z, dx: d.x, dy: d.y, dz: d.z };
  });
}

const moved = (a: Cam, b: Cam) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const turned = (a: Cam, b: Cam) => Math.hypot(a.dx - b.dx, a.dy - b.dy, a.dz - b.dz);

/** Waits out the gap that separates one gesture from the next. */
const pause = (page: Page) => page.waitForTimeout(450);

test("Mac trackpad gestures move the 3D map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  const box = (await page.locator(".map3d canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Two-finger scroll (sideways jitter marks it as a trackpad): pans, same height and angle.
  let before = await camera(page);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(3, 25);
  await settle(page, 1);
  let after = await camera(page);
  expect(moved(before, after)).toBeGreaterThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
  expect(turned(before, after)).toBeLessThan(1e-6);
  // Fingers up push the ground up the screen, which brings the near side into view: the camera
  // backs away from the way it looks.
  expect((after.x - before.x) * before.dx + (after.z - before.z) * before.dz).toBeLessThan(0);

  // Pinch apart (a ctrl wheel with negative deltaY in Chromium): zooms in, same angle.
  await pause(page);
  before = after;
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -8);
  await page.keyboard.up("Control");
  await settle(page, 1);
  after = await camera(page);
  expect(after.y).toBeLessThan(before.y - 0.5);
  expect(turned(before, after)).toBeLessThan(1e-6);

  // Option with a sideways scroll: turns the view.
  await pause(page);
  before = after;
  await page.keyboard.down("Alt");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(20, 0);
  await page.keyboard.up("Alt");
  await settle(page, 2);
  after = await camera(page);
  expect(turned(before, after)).toBeGreaterThan(0.05);

  // Safari's pinch: gesture events zoom too.
  await pause(page);
  before = after;
  await page.evaluate(({ x, y }) => {
    const el = document.querySelector(".map3d")!;
    const fire = (type: string, scale: number, rotation: number) => el.dispatchEvent(Object.assign(new Event(type, { cancelable: true, bubbles: true }), { scale, rotation, clientX: x, clientY: y }));
    fire("gesturestart", 1, 0);
    fire("gesturechange", 1.2, 0);
    fire("gesturechange", 1.4, 0);
    fire("gestureend", 1.4, 0);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await settle(page, 1);
  after = await camera(page);
  expect(after.y).toBeLessThan(before.y - 0.5);

  // A mouse wheel notch still zooms through the map's own controls.
  await pause(page);
  before = after;
  await page.mouse.wheel(0, 120);
  await settle(page, 2);
  after = await camera(page);
  expect(after.y).toBeGreaterThan(before.y + 0.5);

  // The page itself never scrolled or zoomed.
  expect(await page.evaluate(() => [window.scrollX, window.scrollY, visualViewport?.scale ?? 1])).toEqual([0, 0, 1]);
  expect(errors).toEqual([]);
});

test("Map navigation setting switches trackpad scroll to zoom", async ({ page }) => {
  await openAtlas(page, { light: "day", storage: { mapNavigation: { scroll: "zoom", speed: "normal" } } });
  await waitForScene(page);
  const box = (await page.locator(".map3d canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await camera(page);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(3, 25);
  await settle(page, 2);
  const after = await camera(page);
  // Zoomed out along the view (MapControls), rather than sliding at the same height.
  expect(after.y).toBeGreaterThan(before.y + 0.5);
});
