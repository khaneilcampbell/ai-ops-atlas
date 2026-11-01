import { expect, test } from "@playwright/test";
import { openAtlas } from "./atlas";

// When the 3D map can't draw (here: WebGL refuses to start for the map's canvas), the Projects
// view keeps its toolbar and shows a short note with Try again, instead of the whole view crashing.
for (const [name, viewport] of [["desktop", { width: 1512, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`3D map failure keeps the view (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      // The app's first WebGL check passes (so it picks the 3D map); the map's own canvas then fails.
      let calls = 0;
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...a: Parameters<typeof orig>) {
        if (String(a[0]).startsWith("webgl") && calls++ > 0) return null;
        return orig.apply(this, a);
      } as typeof orig;
    });
    await openAtlas(page);
    await expect(page.locator(".map3d-failed")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".map3d-failed")).toContainText("Try again");
    await expect(page.getByRole("button", { name: "3D map" })).toBeVisible();
    if (process.env.SHOTS) await page.screenshot({ path: `visual/out/map-guard-${name}.png` });
  });
}
