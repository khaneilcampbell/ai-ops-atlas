import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Phase 7.6 personal command center: the Command brief at the top of Mission Control, the
// portfolio (category, business, building) on Workspace > Setup, and the tool cards with the
// projects, agents and workflows that use them. Screenshots go to visual/out/command-center/
// (not baselines). Before the change, the same places are captured so they can be compared.
test.use({ deviceScaleFactor: 2 });
const out = process.env.CC_SHOTS ?? "visual/out/command-center";

for (const width of [1512, 390])
  test(`Personal command center ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await openAtlas(page);
    await goTo(page, "Mission");
    await settle(page, 1);
    await page.screenshot({ path: `${out}/mission-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    await goTo(page, "Workspace");
    await settle(page, 1);
    const portfolio = page.locator(".portfolio");
    if (await portfolio.count()) {
      await expect(portfolio).toContainText("Business Operations");
      await portfolio.evaluate((e) => e.scrollIntoView({ block: "start" }));
      await settle(page, 1);
    }
    await page.screenshot({ path: `${out}/workspace-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    await page.getByRole("tab", { name: /^(Tools|Integrations)$/ }).click();
    await settle(page, 1);
    await page.screenshot({ path: `${out}/tools-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
