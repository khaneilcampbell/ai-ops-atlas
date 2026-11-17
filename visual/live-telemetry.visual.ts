import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForOffice } from "./atlas";
import { NOW } from "./github";

// Live telemetry states in the building module and the office inspector. Signal Watch last
// reported 2 hours ago against a 90-minute window, so its success has expired. Shots: visual/out/telemetry-*.png.
const OUT = join(import.meta.dirname, "out");
const reports = [{ id: 1, project: "ai-ops-atlas", agents: ["signal-watch"], phase: "signal-watch", status: "ok", detail: "", at: new Date(NOW - 2 * 3_600_000).toISOString() }];

async function run(page: Page, tag: string) {
  mkdirSync(OUT, { recursive: true });
  await openAtlas(page, { storage: { liveAgentRuns: reports } });
  await selectBuilding(page, "Observability Center");
  const mod = page.locator(".module-section");
  await expect(mod).toContainText("Signal Watch");
  await mod.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, `telemetry-module-${tag}.png`) });
  await selectBuilding(page, "Atlas Command Center");
  await page.getByRole("button", { name: "Enter building", exact: true }).click();
  await settle(page, 2);
  await waitForOffice(page);
  await page.getByRole("button", { name: "Floor 4 · Agents", exact: true }).click();
  await settle(page, 2);
  await waitForOffice(page);
  await page.locator(".office-roster summary").click();
  await page.locator(".office-roster-list button").first().click();
  await settle(page, 2);
  await expect(page.locator(".office-panel")).toContainText("Source:");
  await page.screenshot({ path: join(OUT, `telemetry-inspector-${tag}.png`) });
}

test("desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  await run(page, "1512");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("iphone", async ({ page }) => run(page, "390"));
});
