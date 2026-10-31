import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle } from "./atlas";

/**
 * The top bar at the widths people use. The plain web build shows fewer pills than the Mac app,
 * so `desktopChrome` adds what the Mac app adds (traffic-light padding, a live pill with a long
 * status, and the "Read-only + re-runs" mode) to check the crowded case too.
 */
async function desktopChrome(page: Page, mac = true) {
  await page.evaluate((mac) => {
    if (mac) document.documentElement.classList.add("mac-app");
    const header = document.querySelector(".header")!;
    const platform = header.querySelector(".platform-label");
    if (platform) platform.textContent = "Desktop";
    const live = document.createElement("span");
    live.className = "live-pill live";
    live.innerHTML = '<span class="dot"></span>Live<span class="live-last">Merge flow failed · ai-ops-atlas</span>';
    (platform ?? header.querySelector(".pill-mode"))!.after(live);
    const mode = header.querySelector(".pill-mode");
    if (mode) mode.lastChild!.textContent = "Read-only + re-runs";
  }, mac);
  await settle(page, 1);
}

/** The header fits on one line: nothing in it is taller than the bar or runs past its right edge. */
async function expectHeaderFits(page: Page) {
  const problems = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".header")!;
    const box = header.getBoundingClientRect();
    const out: string[] = [];
    if (header.scrollWidth > header.clientWidth + 1) out.push(`header scrolls: ${header.scrollWidth} > ${header.clientWidth}`);
    for (const el of header.querySelectorAll<HTMLElement>("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
      if (r.top < box.top - 1 || r.bottom > box.bottom + 1) out.push(`${el.className || el.tagName} spills vertically (${Math.round(r.top)}-${Math.round(r.bottom)})`);
      if (r.right > box.right + 1) out.push(`${el.className || el.tagName} runs past the right edge`);
    }
    for (const el of header.querySelectorAll<HTMLElement>(".brand-title, .brand .eyebrow")) {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
      if (el.offsetParent && el.getBoundingClientRect().height > lh * 1.5) out.push(`${el.className} wraps`);
    }
    return out;
  });
  expect.soft(problems, "header layout problems").toEqual([]);
}

const WIDTHS = [
  { name: "wide", width: 1728 },
  { name: "laptop", width: 1512 },
  { name: "narrow", width: 1280 },
  { name: "small", width: 1024 },
];

// The header looks the same by day and night (only the map changes), so one light is enough.
for (const w of WIDTHS) {
  test(`header, ${w.name}`, async ({ page }) => {
    await page.setViewportSize({ width: w.width, height: 800 });
    await openAtlas(page);
    await desktopChrome(page);
    await expectHeaderFits(page);
    await expect(page.locator(".header")).toHaveScreenshot(`header-${w.name}.png`);
  });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("header", async ({ page }) => {
    await openAtlas(page);
    await desktopChrome(page, false);
    await expectHeaderFits(page);
    await expect(page.locator(".header")).toHaveScreenshot("header-phone.png");
  });
});
