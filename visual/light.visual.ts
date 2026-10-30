import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { openAtlas, waitForScene } from "./atlas";

// The day and night button, with motion on: the map eases between the two moods over about two
// seconds. The other checks open in a saved mood with reduced motion, which skips the easing.
// Not a baseline comparison: it checks the sky changes brightness. SHOTS=1 also saves the frames.
test.use({ reducedMotion: "no-preference", viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });

const OUT = join(import.meta.dirname, "out");

/** Mean brightness of the map where it shows on screen: sky, water and island together. */
async function brightness(page: Page, name: string) {
  const box = (await page.locator(".map3d canvas").first().boundingBox())!;
  const vp = page.viewportSize()!;
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const shot = await page.screenshot({ clip: { x, y, width: Math.min(box.x + box.width, vp.width) - x, height: Math.min(box.y + box.height, vp.height) - y } });
  if (process.env.SHOTS) {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, `${name}.png`) });
  }
  const d = PNG.sync.read(shot).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return sum / (d.length / 4);
}

/** Steps the frozen clock through a few seconds of frames, enough for the change to finish. */
async function ease(page: Page) {
  for (let i = 0; i < 12; i++) await page.clock.runFor(300);
}

for (const from of ["night", "day"] as const) {
  const to = from === "night" ? "day" : "night";
  test(`map, switching from ${from} to ${to}`, async ({ page }) => {
    await openAtlas(page, { light: from });
    await waitForScene(page);
    const before = await brightness(page, `light-${from}`);
    await page.getByRole("button", { name: "Night mode" }).click();
    await ease(page);
    const after = await brightness(page, `light-${from}-to-${to}`);
    // Day is a pale sky and teal water, night deep navy: the whole view changes brightness.
    if (to === "day") expect(after).toBeGreaterThan(before + 60);
    else expect(after).toBeLessThan(before - 60);
  });
}
