import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle } from "./atlas";

// Flow lines: Atlas Command Center selected, so its feed and n8n lines show. Shots: visual/out/flows-*.png.
const OUT = join(import.meta.dirname, "out");
async function run(page: Page, tag: string) {
  mkdirSync(OUT, { recursive: true });
  await openAtlas(page);
  await selectBuilding(page, "Atlas Command Center");
  await settle(page, 4);
  await page.screenshot({ path: join(OUT, `flows-${tag}.png`) });
}
test("desktop", async ({ page }) => run(page, "1512"));
test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("iphone", async ({ page }) => run(page, "390"));
});
