import { expect, test, type Locator, type Page } from "@playwright/test";
import { goTo, openAtlas, selectBuilding } from "./atlas";

// Text can be highlighted and copied everywhere except controls and the drag-to-pan map.
// A double-click selects the word under the pointer only where selection is allowed.

async function selectWordIn(page: Page, el: Locator) {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  const box = (await el.boundingBox())!;
  await page.mouse.dblclick(box.x + Math.min(12, box.width / 2), box.y + box.height / 2);
  return page.evaluate(() => getSelection()?.toString().trim() ?? "");
}

const VIEWS = ["Mission", "Agents", "Activity", "Repos", "Settings"];

test("text is selectable in every view", async ({ page }) => {
  await openAtlas(page);
  for (const view of VIEWS) {
    await goTo(page, view);
    const heading = page.locator("main h1, main h2, .view h1, .view h2").filter({ visible: true }).first();
    expect(await selectWordIn(page, heading), `${view} heading`).not.toBe("");
  }
});

test("map drag stays a pan, inspector text is selectable and copyable", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openAtlas(page);
  const stage = page.locator(".map-stage");
  expect(await stage.evaluate((el) => getComputedStyle(el).userSelect)).toBe("none");
  expect(await page.locator(".nav-item").first().evaluate((el) => getComputedStyle(el).userSelect)).toBe("none");

  await selectBuilding(page, "Atlas HQ");
  await page.getByRole("button", { name: "Inspect repository khaneilcampbell/ai-ops-atlas", exact: true }).click();
  const name = page.locator(".panel-head .copy-value .selectable").first();
  await expect(name).toHaveText("khaneilcampbell/ai-ops-atlas");
  expect(await selectWordIn(page, name)).not.toBe("");
  await page.locator(".panel-head .copy-value .copy-btn").first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("khaneilcampbell/ai-ops-atlas");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("text is selectable on the phone layout", async ({ page }) => {
    await openAtlas(page);
    await goTo(page, "Mission");
    const heading = page.locator("main h1, main h2, .view h1, .view h2").filter({ visible: true }).first();
    expect(await heading.evaluate((el) => getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect)).not.toBe("none");
    expect(await selectWordIn(page, heading)).not.toBe("");
  });
});
