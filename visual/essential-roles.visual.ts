import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openAtlas, goTo, settle } from "./atlas";
// The Agents tab opens on eight essential roles, each with its agents and automations nested
// underneath (2026-11-17). Inactive, Archived and All entries stay one tab away.
test.use({ deviceScaleFactor: 1 });
const out = process.env.ROLE_SHOTS ?? "docs/essential-roles";
for (const width of [1512, 390])
  test(`Essential roles directory ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openAtlas(page);
    mkdirSync(out, { recursive: true });
    await goTo(page, "Agents");
    await expect(page.locator(".role-card")).toHaveCount(8);
    await settle(page, 1);
    await page.screenshot({ path: `${out}/overview-${width}.png` });
    await page.locator('.role-card[data-role="benjaire-product-lab"] > summary').click();
    await expect(page.getByRole("list", { name: "Product Research Lead members" }).getByRole("button")).toHaveCount(6);
    await page.locator('.role-card[data-role="benjaire-inquiry-manager"] > summary').click();
    await expect(page.getByRole("list", { name: "Automations run by Client Inquiry Manager" }).getByRole("button")).toHaveCount(6);
    await page.locator('.role-card[data-role="benjaire-inquiry-manager"]').evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/roles-${width}.png` });
    await page.getByLabel("Search roles").fill("benjaire-flow-digest");
    await expect(page.locator(".role-card")).toHaveCount(1);
    await expect(page.locator('.role-card[data-role="benjaire-inquiry-manager"] [data-id="benjaire-flow-digest"]')).toBeVisible();
    await page.locator('[data-id="benjaire-flow-digest"]').click();
    await settle(page, 1);
    await page.screenshot({ path: `${out}/search-${width}.png` });
    const close = page.getByRole("button", { name: "Close details" }); // phones show details as a sheet
    if (await close.isVisible()) await close.click();
    await page.getByLabel("Search roles").fill("");
    await page.getByRole("tab", { name: /^Archived/ }).click();
    await expect(page.getByRole("list", { name: "Archived entries" }).getByRole("button")).toHaveCount(11);
    await page.screenshot({ path: `${out}/archived-${width}.png` });
    // Inactive: the Atlas Task Writer (n8n draft, #506) and the Atlas Executive (paused until its
    // n8n workflows are published, #508), Investment Operations (not connected, #518), the five
    // trading team seats, paused while trading is off (#518), and Connor's security sheet (paused on main).
    await page.getByRole("tab", { name: /^Inactive 9/ }).click();
    await expect(page.getByRole("list", { name: "Inactive entries" }).locator('[data-id="atlas-executive"]')).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Inactive entries" }).locator('[data-id="investment-operations"]')).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Inactive entries" }).locator('[data-id="trade-desk"]')).toHaveCount(1);
    await page.getByRole("tab", { name: "All entries" }).click();
    await expect(page.locator(".reg-row").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
