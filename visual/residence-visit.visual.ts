import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openAtlas, settle, waitForScene } from "./atlas";

// Review shots and flow checks, not baselines:
//   VISIT_SHOTS=<dir> npx playwright test -c visual visual/residence-visit.visual.ts
// Visit apartment in Team Residence Towers: pick Claire's apartment (401), visit it, check the workspace, reload
// (the visit is restored), go back to the building, and see a stale saved suite fall back to the overview.
const out = process.env.VISIT_SHOTS ?? "";
test.skip(!out, "Set VISIT_SHOTS to a folder to take these review shots");

const SIZES = { 1512: { width: 1512, height: 945 }, 390: { width: 390, height: 844 } };
const TIME = Date.parse("2026-11-19T18:00:00Z");

async function enterResidence(page: Page) {
  await page.evaluate(async () => {
    const m = await import("/src/views/office/store.ts" as string);
    m.enterBuilding("skyline-business:Ellipse Residences", true);
  });
  await frames(page);
}
async function frames(page: Page) {
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(200);
    await settle(page, 2);
  }
}

for (const [size, viewport] of Object.entries(SIZES))
  test(`visit apartment, ${size}`, async ({ page }) => {
    test.setTimeout(400_000);
    mkdirSync(out, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(viewport);
    await openAtlas(page, { time: TIME });
    await waitForScene(page);
    await settle(page, 6);
    await enterResidence(page);

    await page.getByRole("button", { name: /^Floor 4$/ }).click();
    await frames(page);
    await page.getByRole("button", { name: /Apartment 401/ }).click();
    await frames(page);
    await page.screenshot({ path: `${out}/1-picked-${size}.png` });
    const visit = page.getByRole("button", { name: "Visit apartment 401" });
    if (!(await visit.count())) return; // Before this change: no visit control.

    await visit.click();
    await frames(page);
    const panel = page.getByRole("complementary", { name: /Suite 401/ });
    await expect(panel).toContainText("Suite 401 · West tower · Floor 4");
    await expect(panel.getByRole("heading")).toHaveText(/Claire/);
    for (const name of [/Agent profile/, /Tasks/, /Saved outputs/]) await expect(panel.getByRole("button", { name })).toBeVisible();
    await expect(page.getByRole("button", { name: /Exit .* return to city/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Floor 6$/ })).toBeVisible();
    await page.screenshot({ path: `${out}/2-visit-${size}.png` });

    // Saved suite survives a reload.
    await page.reload();
    await waitForScene(page);
    await settle(page, 4);
    await enterResidence(page);
    await expect(page.getByRole("complementary", { name: /Suite 401/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Floor 4$/ })).toHaveAttribute("aria-pressed", "true");

    // Fold the workspace, then back to the building: the floor overview and its navigation work again.
    await page.getByRole("button", { name: "Hide workspace" }).click();
    await frames(page);
    await page.screenshot({ path: `${out}/3-folded-${size}.png` });
    await page.getByRole("button", { name: "← Back to building" }).click();
    await frames(page);
    await expect(page.getByRole("complementary", { name: /Suite 401/ })).toHaveCount(0);
    await page.screenshot({ path: `${out}/4-back-${size}.png` });
    await page.getByRole("button", { name: /^Floor 3$/ }).click();
    await frames(page);
    await expect(page.getByRole("heading", { level: 2 })).toContainText("Floor 3");

    // Escape closes a visit before it leaves the building; repeated visits leave one panel.
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: /Apartment 301/ }).click();
      await page.getByRole("button", { name: "Visit apartment 301" }).click();
      await frames(page);
      await expect(page.locator(".residence-visit")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await frames(page);
      await expect(page.locator(".residence-visit")).toHaveCount(0);
      await expect(page.locator(".skyline-interior")).toHaveCount(1);
    }

    // A stale saved suite (nobody lives there) opens the plain overview.
    await page.evaluate(() => localStorage.setItem("atlas:residenceVisit", JSON.stringify({ suite: "999", folded: "x" })));
    await page.reload();
    await waitForScene(page);
    await settle(page, 4);
    await enterResidence(page);
    await expect(page.locator(".residence-visit")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^All floors$/ })).toHaveAttribute("aria-pressed", "true");

    // A shortcut reaches its page: Agent profile opens Claire in the Agents tab.
    await page.getByRole("button", { name: /^Floor 4$/ }).click();
    await page.getByRole("button", { name: /Apartment 401/ }).click();
    await page.getByRole("button", { name: "Visit apartment 401" }).click();
    await frames(page);
    await page.getByRole("button", { name: "Agent profile" }).click();
    await settle(page, 3);
    await expect(page.locator(".skyline-interior")).toHaveCount(0);
    await expect(page.locator(".nav-item.active")).toHaveAttribute("aria-label", /Agents/);
    await page.screenshot({ path: `${out}/5-profile-${size}.png` });
    expect(errors).toEqual([]);
  });
