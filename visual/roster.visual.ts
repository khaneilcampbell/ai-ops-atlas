import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openAtlas, goTo, settle } from "./atlas";
// Agents > Roster (2026-11-24): every current AI agent in one sortable table, with filter chips and
// the agent's existing details beside it. Values Atlas doesn't have say so instead of a number.
test.use({ deviceScaleFactor: 1 });
const out = process.env.ROSTER_SHOTS ?? "docs/roster";
for (const width of [1512, 390])
  test(`Agents Roster tab ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 600 ? 1500 : 2400 });
    await openAtlas(page);
    mkdirSync(out, { recursive: true });
    await goTo(page, "Agents");
    await page.getByRole("tab", { name: "Roster" }).click();
    await expect(page.locator("table.roster tbody tr[data-id]")).toHaveCount(22);
    await page.locator('table.roster tr[data-id="benjaire-inquiry-manager"]').click();
    await settle(page, 1);
    await page.screenshot({ path: `${out}/roster-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const close = page.getByRole("button", { name: "Close details" }); // phones show details as a sheet
    if (await close.isVisible()) await close.click();
    await page.getByRole("button", { name: /^Needs you/ }).click();
    if (width > 600) await page.getByRole("button", { name: /^Health/ }).click(); // phones hide the header row
    await settle(page, 1);
    await page.screenshot({ path: `${out}/needs-${width}.png` });
    await page.getByRole("button", { name: /^All/ }).click();
    await page.getByLabel("Search roster").fill("yusuf");
    await expect(page.locator("table.roster tbody tr[data-id]")).toHaveCount(1);
  });
