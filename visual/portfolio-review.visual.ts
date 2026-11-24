import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Agents > Review, the read-only agent portfolio review (2026-11-24): the proposed list, then one
// recommendation approved so its Claude brief shows. Screenshots only, into
// visual/out/portfolio-review/ (REVIEW_SHOTS overrides), not baselines. Before the Review tab
// exists it shoots the Agents page head instead, as the "before" picture.
test.use({ deviceScaleFactor: 1 });
const out = process.env.REVIEW_SHOTS ?? "visual/out/portfolio-review";

for (const width of [1512, 390])
  test(`Agent portfolio review ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await openAtlas(page);
    await goTo(page, "Agents");
    await settle(page, 1);
    const tab = page.getByRole("tab", { name: "Review", exact: true });
    if (!(await tab.isVisible().catch(() => false))) {
      await page.screenshot({ path: `${out}/agents-${width}.png` });
      return;
    }
    await tab.click();
    await settle(page, 1);
    await page.screenshot({ path: `${out}/review-${width}.png` });
    const first = page.locator(".review-rec").first();
    await first.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("tab", { name: /^Approved/ }).click();
    await settle(page, 1);
    await page.locator(".review-brief").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/brief-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
