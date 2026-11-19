import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForOffice } from "./atlas";

// Agent office organization (team signs over each tier row, grouped roster) and the glass data
// hologram over a selected agent. Shots: visual/out/office-holo-*.png.
const OUT = join(import.meta.dirname, "out");

async function run(page: Page, tag: string) {
  mkdirSync(OUT, { recursive: true });
  await openAtlas(page);
  await selectBuilding(page, "Atlas Command Center");
  await page.getByRole("button", { name: "Enter building", exact: true }).click();
  await settle(page, 2);
  await waitForOffice(page);
  await page.getByRole("button", { name: "Floor 4 · Agents", exact: true }).click();
  await settle(page, 4);
  await waitForOffice(page);
  await page.screenshot({ path: join(OUT, `office-holo-floor-${tag}.png`) });
  await page.locator(".office-roster summary").click();
  await settle(page, 1);
  await page.screenshot({ path: join(OUT, `office-holo-roster-${tag}.png`) });
  // The front-centre desk, so the hologram has the room behind it.
  await page.locator(".office-roster-list button", { hasText: "Atlas Release Manager" }).click();
  await settle(page, 6);
  await page.screenshot({ path: join(OUT, `office-holo-selected-${tag}.png`) });
  // Closer, the way Khaneil would lean in to read it.
  // On a phone the agent sheet covers the map controls, so there the selected shot is the close one.
  const zoom = page.locator(".office-controls").getByRole("button", { name: "Zoom in" });
  if (!(await zoom.isVisible())) return;
  for (let i = 0; i < 3; i++) await zoom.dispatchEvent("click");
  await settle(page, 6);
  await page.screenshot({ path: join(OUT, `office-holo-closeup-${tag}.png`) });
  // An agent with GitHub Actions runs in the fixtures, so the run strip has real bars.
  await page.locator(".office-roster-list button", { hasText: "Build and Release Engineer" }).click();
  await settle(page, 6);
  // Software WebGL can lag a frame behind the selection; let it catch up.
  await page.waitForTimeout(2000);
  await settle(page, 4);
  await page.screenshot({ path: join(OUT, `office-holo-runs-${tag}.png`) });
}

test("desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  await run(page, "1512");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("iphone", async ({ page }) => run(page, "390"));
});
