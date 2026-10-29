import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas } from "./atlas";
import { NOW } from "./github";

// Agent alerts: a failure the contact Worker reported raises the header pill and the Mission
// Control list; dismissing it clears both. Screenshots go to visual/out/alerts-*.png for review.
const OUT = join(import.meta.dirname, "out");
const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `alerts-${name}.png`), animations: "disabled", caret: "hide" });
};

const reports = [
  { id: 2, project: "benjaire-com", agents: ["benjaire-contact-worker"], phase: "Contact form", status: "failed", detail: "Flow forward timed out after 3 tries", at: new Date(NOW - 20 * 60_000).toISOString() },
  { id: 1, project: "benjaire-com", agents: ["benjaire-flow-intake"], phase: "Intake", status: "ok", detail: "Inquiry classified", at: new Date(NOW - 3 * 3_600_000).toISOString() },
];

test("a reported failure raises an alert until it is dismissed", async ({ page }) => {
  await openAtlas(page, { storage: { liveAgentRuns: reports, "mission-tab": "overview" } });
  const pill = page.locator(".alert-pill");
  await expect(pill).toHaveText("Benjaire Contact and Checkout Gateway failed");
  await goTo(page, "Mission");
  const card = page.locator("#agent-alerts");
  await expect(card.locator(".watch.failing")).toContainText("Flow forward timed out after 3 tries");
  // The commerce agents are off on purpose, so they never alert.
  await expect(card.locator(".watch.not-running")).toHaveCount(4);
  // This browser isn't reading the live feed, so the intake's state is unknown, not healthy.
  await expect(card.locator(".watch.no-source")).toHaveCount(1);
  await shot(page, "1-mission");
  await card.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(pill).toHaveCount(0);
  await expect(card.locator(".chip-bad")).toHaveCount(0);
  await shot(page, "2-dismissed");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the alert list fits the phone layout", async ({ page }) => {
    await openAtlas(page, { storage: { liveAgentRuns: reports, "mission-tab": "overview" } });
    await expect(page.locator(".alert-pill")).toBeVisible();
    await goTo(page, "Mission");
    const card = page.locator("#agent-alerts");
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await shot(page, "3-phone");
  });
});
