import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openAtlas, goTo, settle } from "./atlas";
// The Agents tab opens on eight essential roles with their AI agents (2026-11-17). Automations are
// never agent rows: an owning agent names them on one line that opens Automations (2026-11-18). Inactive, Archived and All entries stay one tab away.
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
    await expect(page.getByRole("note", { name: "Automations run by Client Inquiry Manager" })).toHaveAttribute("data-count", "6");
    await expect(page.locator('.role-card [data-id="benjaire-flow-digest"]')).toHaveCount(0);
    await page.locator('.role-card[data-role="benjaire-inquiry-manager"]').evaluate((e) => e.scrollIntoView({ block: "start" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/roles-${width}.png` });
    await page.getByLabel("Search roles").fill("benjaire-flow-digest");
    await expect(page.locator(".role-card")).toHaveCount(1);
    await expect(page.locator('.role-card[data-role="benjaire-inquiry-manager"] [data-id="benjaire-inquiry-manager"]')).toBeVisible();
    await page.locator('[data-id="benjaire-inquiry-manager"]').click();
    await settle(page, 1);
    await page.screenshot({ path: `${out}/search-${width}.png` });
    const close = page.getByRole("button", { name: "Close details" }); // phones show details as a sheet
    if (await close.isVisible()) await close.click();
    await page.getByLabel("Search roles").fill("");
    await page.getByRole("tab", { name: /^Archived/ }).click();
    await expect(page.getByRole("list", { name: "Archived entries" }).getByRole("button")).toHaveCount(6); // AI agents only; the 5 archived automations stay under Automations
    await page.screenshot({ path: `${out}/archived-${width}.png` });
    await page.getByRole("tab", { name: /^Inactive/ }).click();
    await expect(page.getByText("Nothing inactive matches.")).toBeVisible(); // GitHub Profile Manager published 2026-11-17, Data Inventory 2026-11-13
    await page.getByRole("tab", { name: "All entries" }).click();
    await expect(page.locator(".reg-row").first()).toBeVisible();
    await expect(page.locator('.reg-list-pane [data-id="agent-registry-sync"]')).toHaveCount(0);
    await page.getByRole("tab", { name: /^Essential roles/ }).click();
    await page.locator('.role-card[data-role="agent-operations-lead"] > summary').click();
    await page.getByRole("note", { name: "Automations run by Agent Operations Lead" }).getByRole("button", { name: "View in Automations" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Automations" })).toBeVisible();
    await expect(page.locator('.reg-row.on[data-id="agent-registry-sync"]')).toBeVisible(); // opens on its first automation
    await settle(page, 1);
    await page.screenshot({ path: `${out}/open-automations-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
