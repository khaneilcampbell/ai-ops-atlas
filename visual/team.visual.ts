import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openAtlas, goTo, settle } from "./atlas";
// Agents > Team (2026-11-24): the essential roles as an org chart under Yusuf Demir, with a
// lifecycle strip and a Needs you list built only from catalog and observed-run data.
test.use({ deviceScaleFactor: 1 });
const out = process.env.TEAM_SHOTS ?? "docs/team";
for (const width of [1512, 390])
  test(`Agents Team tab ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 600 ? 1500 : 2400 });
    await openAtlas(page);
    mkdirSync(out, { recursive: true });
    await goTo(page, "Agents");
    await page.getByRole("tab", { name: "Team" }).click();
    await expect(page.locator(".team-coord")).toHaveAttribute("data-role", "agent-operations-lead");
    await expect(page.locator(".team-role")).toHaveCount(8);
    await settle(page, 1);
    await page.screenshot({ path: `${out}/team-${width}.png`, });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('.team-role[data-role="benjaire-inquiry-manager"] .team-name').click();
    await expect(page.getByRole("tab", { name: "Directory" })).toHaveAttribute("aria-selected", "true");
  });
