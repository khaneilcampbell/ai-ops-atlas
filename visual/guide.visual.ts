import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Intel → Overview, the guide to Atlas (2026-11-24). Screenshots only, into visual/out/guide/
// (GUIDE_SHOTS overrides), not baselines. Before the Overview tab exists it shoots the page Intel
// opens on instead, as the "before" picture.
test.use({ deviceScaleFactor: 1 });
const out = process.env.GUIDE_SHOTS ?? "visual/out/guide";

for (const width of [1512, 390])
  test(`Atlas guide ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await openAtlas(page);
    await goTo(page, "Intel");
    const tab = page.locator(".section-tabs button", { hasText: /^\s*Overview/ });
    if (await tab.count()) await tab.first().click();
    await settle(page, 1);
    // The page scrolls inside the app shell, so grow the window to the page's height for one picture.
    const tall = await page.evaluate(() => Math.max(...[...document.querySelectorAll("*")].map((e) => e.scrollHeight)));
    await page.setViewportSize({ width, height: Math.min(tall + 120, 6000) });
    await settle(page, 1);
    await page.screenshot({ path: `${out}/intel-${width}.png` });
    if (!(await tab.count())) return;
    await expect(page.getByRole("heading", { name: "How Atlas works" })).toBeVisible();
    await expect(page.getByText("Yusuf Demir coordinates.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
