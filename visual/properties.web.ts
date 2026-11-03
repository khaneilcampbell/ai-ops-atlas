import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle } from "./atlas";
import { NOW } from "./github";
import { sampleGithub, sampleSite } from "./propertiesFixtures";

// The live website dashboards on Benjaire HQ and Portfolio Site, as the hosted page shows them.
// The sample answers are in propertiesFixtures.ts. Screenshots go to visual/out/properties-*.png.
// Run with: npx playwright test -c visual/properties.config.ts
const OUT = join(import.meta.dirname, "out");

async function open(page: Page) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/properties") {
      const domain = u.searchParams.get("domain")!;
      return route.fulfill({ json: sampleSite(domain, NOW) });
    }
    if (u.pathname.startsWith("/api/github")) {
      const body = sampleGithub(u.pathname.slice("/api/github".length) + u.search, NOW);
      return route.fulfill({ status: body == null ? 404 : 200, json: body ?? { message: "Not Found" } });
    }
    return route.fulfill({ status: 404, json: { message: "Not in this check." } });
  });
  await openAtlas(page);
  await settle(page, 4);
}

const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" }).or(page.getByRole("dialog", { name: "Details" }));

test("a failed deploy is an incident on Benjaire HQ, with links to act", async ({ page }) => {
  await open(page);
  await expect(page.locator(".property-pill")).toHaveText(/2 website incidents/);
  mkdirSync(OUT, { recursive: true });
  await page.locator(".header").screenshot({ path: join(OUT, "properties-1-header.png") });
  await page.locator(".property-pill").click();
  await settle(page, 4);
  const dash = inspector(page).locator(".property");
  await expect(dash.locator(".property-incident")).toHaveCount(2);
  await expect(dash.locator(".property-incident").first()).toContainText("Production deploy failed");
  await expect(dash.locator(".property-incident").first().getByRole("link", { name: /Fix with Claude/ })).toHaveAttribute("href", /labels=claude-fix/);
  await expect(dash.locator(".property-tile", { hasText: "Deploys" })).toContainText("Failed");
  await expect(dash.locator(".property-tile", { hasText: "Traffic" })).toContainText("Needs Cloudflare analytics");
  await page.screenshot({ path: join(OUT, "properties-2-benjaire.png"), animations: "disabled", caret: "hide" });
  
  await dash.locator(".property-incident").first().getByRole("button", { name: "Dismiss" }).click();
  await expect(dash.locator(".property-incident")).toHaveCount(1);
});

test("a healthy site shows every signal and what still needs connecting", async ({ page }) => {
  await open(page);
  await selectBuilding(page, "Portfolio Site");
  const dash = inspector(page).locator(".property");
  await expect(dash.locator(".property-chip")).toHaveText("No incidents");
  await expect(dash.locator(".property-tile", { hasText: "Deploys" })).toContainText("Live");
  await expect(dash.locator(".property-tile", { hasText: "SSL certificate" })).toContainText(/6\d days left/);
  await page.screenshot({ path: join(OUT, "properties-4-portfolio.png"), animations: "disabled", caret: "hide" });
});

test.describe("on iPhone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  test("the dashboard fits the phone panel", async ({ page }) => {
    await open(page);
    await page.locator(".property-pill").click();
    await settle(page, 4);
    const dash = inspector(page).locator(".property");
    await expect(dash).toBeVisible();
    await dash.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, "properties-5-phone.png"), animations: "disabled", caret: "hide" });
  });
});
