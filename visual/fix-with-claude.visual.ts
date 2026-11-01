import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas } from "./atlas";

// Fix with Claude: Mission Control's failing workflow and next-step items each get a button that
// links to a pre-filled, labeled issue. Screenshots go to visual/out/fix-with-claude/ for review.
const OUT = join(import.meta.dirname, "out", "fix-with-claude", process.env.FIX_PHASE ?? "after");
const shot = async (page: Page, name: string, selector: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.locator(selector).first().screenshot({ path: join(OUT, `${name}.png`), animations: "disabled", caret: "hide" });
};
const SHOTS_ONLY = !!process.env.FIX_PHASE && process.env.FIX_PHASE !== "after";

async function open(page: Page) {
  await openAtlas(page, { storage: { "mission-tab": "overview" } });
  await goTo(page, "Mission");
}

async function expectButtons(page: Page) {
  const failing = page.locator(".mc-failing .fix-claude").first();
  await expect(failing).toBeVisible();
  const url = new URL((await failing.getAttribute("href"))!);
  expect(url.pathname).toBe("/khaneilcampbell/ai-ops-atlas/issues/new");
  expect(url.searchParams.get("labels")).toBe("claude-fix");
  expect(url.searchParams.get("body")).toContain("**Repository:** khaneilcampbell/benjaire.com");
  await expect(page.locator(".mission-focus .fix-claude").first()).toBeVisible();
}

test("failing workflows and next steps offer Fix with Claude", async ({ page }) => {
  await open(page);
  if (!SHOTS_ONLY) await expectButtons(page);
  await shot(page, "desktop-focus", ".mission-focus");
  await shot(page, "desktop-failing", ".mc-failing");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the buttons fit the phone layout", async ({ page }) => {
    await open(page);
    if (!SHOTS_ONLY) {
      await expectButtons(page);
      for (const b of await page.locator(".fix-claude").all()) {
        const box = (await b.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
      }
    }
    await shot(page, "phone-focus", ".mission-focus");
    await shot(page, "phone-failing", ".mc-failing");
  });
});
