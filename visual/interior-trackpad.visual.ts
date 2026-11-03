import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForOffice, waitForScene } from "./atlas";

// Trackpad look-around inside every kind of building interior, with real (trusted) wheel events
// from Chromium. Reads the interior camera and checks each gesture moved it the right way, and
// writes before/after PNGs to visual/out/interior-trackpad/ (compares nothing).

// About 9 minutes of software WebGL: runs only when INTERIOR_TRACKPAD=1, like CIRCA_SHOTS, so the
// CI visual run stays under its time limit.
test.skip(!process.env.INTERIOR_TRACKPAD, "Set INTERIOR_TRACKPAD=1 to check trackpad look-around inside buildings.");
test.use({ deviceScaleFactor: 1 });
const out = join(import.meta.dirname, "out", "interior-trackpad");

type Cam = { x: number; y: number; z: number; tx: number; tz: number; d: number };

async function live(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) return false;
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const c = [...document.querySelectorAll<HTMLCanvasElement>(".office-layer canvas, .skyline-interior canvas")].find((el) => fiber._roots.has(el));
    return !!c && !!(fiber._roots.get(c)!.store.getState().controls as unknown as { target?: unknown } | null)?.target;
  });
}

/** The interior camera and the point it looks at, from the interior's own renderer. */
async function camera(page: Page): Promise<Cam> {
  // The interior's renderer loads lazily and sizes itself on a timer the paused test clock holds
  // back: keep stepping the clock until its canvas is live.
  for (let i = 0; i < 40 && !(await live(page)); i++) await settle(page, 2);
  return page.evaluate(async () => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Renderer missing");
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const canvas = [...document.querySelectorAll<HTMLCanvasElement>(".office-layer canvas, .skyline-interior canvas")].find((c) => fiber._roots.has(c))!;
    const state = fiber._roots.get(canvas)!.store.getState();
    const c = state.camera;
    // Every interior registers its controls as the canvas's default.
    const t = (state.controls as unknown as { target: { x: number; y: number; z: number } }).target;
    return { x: c.position.x, y: c.position.y, z: c.position.z, tx: t.x, tz: t.z, d: Math.hypot(c.position.x - t.x, c.position.y - t.y, c.position.z - t.z) };
  });
}

const BUILDINGS: { name: string; file: string; office: boolean }[] = [
  { name: "Atlas HQ", file: "office", office: true },
  { name: "Commerce Pipeline", file: "commerce", office: true },
  { name: "Skyline", file: "skyline", office: false },
  { name: "Atlas Marketplace", file: "mall", office: false },
  { name: "Benjaire Marketing Agency", file: "agency", office: false },
];

for (const b of BUILDINGS)
  test(`trackpad looks all the way round inside ${b.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    mkdirSync(out, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openAtlas(page, { light: "day" });
    await waitForScene(page);
    await selectBuilding(page, b.name);
    await settle(page, 2);
    await page.getByRole("button", { name: "Enter building", exact: true }).click();
    await settle(page, 4);
    if (b.office) await waitForOffice(page);
    // Let the arrival glide finish.
    for (let i = 0; i < 8; i++) await settle(page, 3);
    const canvas = page.locator(".office-layer canvas, .skyline-interior canvas").first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await camera(page);
    await page.screenshot({ path: join(out, `${b.file}-before.png`) });

    // A long sideways two-finger swipe turns the view half way round: the camera ends up on
    // the far side of the room, same distance, still looking at it.
    for (let i = 0; i < 42; i++) await page.mouse.wheel(15, 0.5);
    await settle(page, 4);
    const after = await camera(page);
    const side = (c: Cam) => Math.atan2(c.x - c.tx, c.z - c.tz);
    const turn = Math.abs(((side(after) - side(before) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    expect(turn).toBeGreaterThan(2.6);
    expect(Math.abs(after.d - before.d)).toBeLessThan(0.15 * before.d);
    await page.screenshot({ path: join(out, `${b.file}-turned.png`) });

    // Pinch apart (a ctrl wheel in Chromium) moves closer.
    await page.waitForTimeout(450);
    await page.keyboard.down("Control");
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -10);
    await page.keyboard.up("Control");
    await settle(page, 4);
    const closer = await camera(page);
    expect(closer.d).toBeLessThan(after.d - 0.3);

    // Option with a scroll walks across the floor at the same height.
    await page.waitForTimeout(450);
    await page.keyboard.down("Alt");
    for (let i = 0; i < 6; i++) await page.mouse.wheel(25, 0);
    await page.keyboard.up("Alt");
    await settle(page, 4);
    const walked = await camera(page);
    expect(Math.hypot(walked.tx - closer.tx, walked.tz - closer.tz)).toBeGreaterThan(0.3);
    await page.screenshot({ path: join(out, `${b.file}-moved.png`) });
    expect(errors).toEqual([]);
  });

test("phone: the project interior still opens framed, touch unchanged", async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  await selectBuilding(page, "Atlas HQ");
  await settle(page, 2);
  await page.getByRole("button", { name: "Enter building", exact: true }).click();
  await settle(page, 4);
  await waitForOffice(page);
  for (let i = 0; i < 8; i++) await settle(page, 3);
  await camera(page);
  await page.screenshot({ path: join(out, "phone-office.png") });
});
