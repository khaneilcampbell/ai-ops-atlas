import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle } from "./atlas";
import { NOW } from "./github";
import { sampleGithub, sampleSite } from "./propertiesFixtures";

// The website dashboards in Mission Control's Website management section, as the hosted page shows them.
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

const toMission = async (page: Page) => {
  // The header's view switch on a desktop; the bottom navigation on a phone.
  await page.locator(".view-switch button[aria-label='Mission Control']:visible, .nav-item:visible:has-text('Mission')").first().click();
  await settle(page);
};
const section = (page: Page) => page.locator("#website-management");
const site = (page: Page, domain: string) => section(page).getByRole("region", { name: `${domain} live dashboard` });

test("Mission Control's Website management shows a failed deploy as an incident, with links to act", async ({ page }) => {
  await open(page);
  // No website pill in the header any more: the header keeps its width.
  await expect(page.locator(".property-pill")).toHaveCount(0);
  mkdirSync(OUT, { recursive: true });
  await page.locator(".header").screenshot({ path: join(OUT, "properties-1-header.png") });
  await toMission(page);
  await expect(section(page).locator(".card-head .chip")).toHaveText(/2 open/);
  const dash = site(page, "benjaire.com");
  await expect(dash.locator(".property-incident")).toHaveCount(2);
  await expect(dash.locator(".property-incident").first()).toContainText("Production deploy failed");
  await expect(dash.locator(".property-incident").first().getByRole("link", { name: /Fix with Claude/ })).toHaveAttribute("href", /labels=claude-fix/);
  await expect(dash.locator(".property-tile", { hasText: "Deploys" })).toContainText("Failed");
  await expect(dash.locator(".property-tile", { hasText: "Traffic" })).toContainText("Needs Cloudflare analytics");
  await section(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, "properties-2-mission.png"), animations: "disabled", caret: "hide" });

  await dash.locator(".property-incident").first().getByRole("button", { name: "Dismiss" }).click();
  await expect(dash.locator(".property-incident")).toHaveCount(1);
});

test("a healthy site shows every signal, and the building panel is back to its original design", async ({ page }) => {
  await open(page);
  await selectBuilding(page, "Portfolio Site");
  await expect(page.locator(".property")).toHaveCount(0);
  await toMission(page);
  const dash = site(page, "khaneilcampbell.com");
  await expect(dash.locator(".property-chip")).toHaveText("No incidents");
  await expect(dash.locator(".property-tile", { hasText: "Deploys" })).toContainText("Live");
  await expect(dash.locator(".property-tile", { hasText: "SSL certificate" })).toContainText(/6\d days left/);
});

test.describe("on iPhone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  test("Website management fits the phone", async ({ page }) => {
    await open(page);
    await toMission(page);
    await expect(section(page)).toBeVisible();
    await section(page).scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(OUT, "properties-5-phone.png"), animations: "disabled", caret: "hide" });
  });
});
