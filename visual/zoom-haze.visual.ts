import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { openAtlas, selectBuilding, settle, waitForScene } from "./atlas";

/**
 * Zooming into a building must not turn the view dark (night) or washed out (day).
 *
 * The distance haze follows the camera. It used to pull in so close that, zoomed into a tower,
 * the street below counted as "far" and took the sky colour. This walks KC's path: Financial
 * District, Circa, then Zoom in eight times (about as close as the map goes), and compares the close view with and without the
 * haze: the haze may only touch the far background, not the buildings and street in view. ZOOM_SHOTS=dir also saves the frames.
 */
const shots = process.env.ZOOM_SHOTS;

/** Average per-channel difference (0 to 255) between two same-size frames. */
function difference(a: Buffer, b: Buffer) {
  const [p, q] = [PNG.sync.read(a).data, PNG.sync.read(b).data];
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s += (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2])) / 3;
  return s / (p.length / 4);
}

/** Reads the haze start, or switches the haze off (false) / back on (true) for a comparison frame. */
async function haze(page: Page, on?: boolean) {
  return page.evaluate(async (on) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Fiber import not found");
    const fiber = await import(url);
    const state = fiber._roots.get(document.querySelector("canvas"))?.store.getState();
    const w = window as unknown as { __fog?: unknown };
    if (on === false) [w.__fog, state.scene.fog] = [state.scene.fog, null];
    if (on === true && w.__fog) state.scene.fog = w.__fog;
    state.invalidate();
    return (w.__fog ?? state.scene.fog)?.near as number;
  }, on);
}

test.use({ deviceScaleFactor: 1 });
const cases = [
  { light: "night", phone: false },
  { light: "day", phone: false },
  { light: "night", phone: true },
] as const;
for (const { light, phone } of cases)
  test(`zooming into Circa keeps the ${light} map lit${phone ? " on a phone" : ""}`, async ({ page }) => {
    // The phone case is for before/after shots (ZOOM_SHOTS); CI runs the two desktop cases to save time.
    test.skip(phone && !shots, "Phone case runs with ZOOM_SHOTS=dir.");
    test.setTimeout(600_000);
    const tag = `${light}${phone ? "-phone" : ""}`;
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await openAtlas(page, { light });
    await waitForScene(page);
    await selectBuilding(page, "Financial District");
    await selectBuilding(page, "Circa");
    const canvas = page.locator("canvas").first();
    for (let i = 0; i < 8; i++) {
      // Phones have no zoom buttons: scroll over Circa, in the strip of map above the details sheet.
      if (phone) {
        await page.mouse.move(195, 230);
        await page.mouse.wheel(0, -300);
      } else await page.getByRole("button", { name: "Zoom in" }).click();
      await settle(page, 3);
    }
    const withHaze = await canvas.screenshot();
    const near = await haze(page, false);
    await settle(page, 2);
    const noHaze = await canvas.screenshot();
    await haze(page, true);
    if (shots) {
      mkdirSync(shots, { recursive: true });
      writeFileSync(`${shots}/circa-close-${tag}.png`, withHaze);
      writeFileSync(`${shots}/circa-close-${tag}-no-haze.png`, noHaze);
    }
    const diff = difference(withHaze, noHaze);
    console.log(`${tag}: haze starts ${near.toFixed(1)} units out; with vs without haze differs ${diff.toFixed(2)} of 255`);
    // Before the fix: about 3 at night (navy wash), 12 by day (pale wash), 0.8 on a phone; after, under 0.2.
    expect(diff).toBeLessThan(0.5);
  });
