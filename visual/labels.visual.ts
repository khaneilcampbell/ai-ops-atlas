import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForScene } from "./atlas";

// Building nameplates share one look citywide (src/views/map3d/plaques.tsx). Screenshots go to
// SHOT_DIR only when it is set, so the regular visual run just checks the rules.
const SHOT_DIR = process.env.SHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), animations: "disabled" });
}

async function zoomIn(page: Page, times: number) {
  for (let i = 0; i < times; i++) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await settle(page, 1);
  }
}

/** Font, height and colors of every compact building plaque currently on screen. */
async function plaqueLooks(page: Page) {
  return page.locator(".m3-plaque.compact").evaluateAll((els) =>
    els
      .filter((el) => getComputedStyle(el).visibility === "visible")
      .map((el) => {
        const s = getComputedStyle(el);
        const t = getComputedStyle(el.querySelector(".t")!);
        return {
          name: el.textContent ?? "",
          height: Math.round(el.getBoundingClientRect().height),
          font: `${t.fontSize} ${t.fontWeight}`,
          color: t.color,
          background: el.classList.contains("selected") || el.classList.contains("hover") ? "state" : s.backgroundColor,
          mark: el.querySelector(".t > .hm") !== null,
          fits: el.querySelector(".t")!.scrollWidth <= el.clientWidth,
        };
      }),
  );
}

function expectConsistent(looks: Awaited<ReturnType<typeof plaqueLooks>>) {
  expect(looks.length).toBeGreaterThan(3);
  const first = looks[0];
  for (const l of looks) {
    expect.soft(l.height, l.name).toBe(first.height);
    expect.soft(l.font, l.name).toBe(first.font);
    expect.soft(l.color, l.name).toBe(first.color);
    if (l.background !== "state") expect.soft(l.background, l.name).toBe(looks.find((x) => x.background !== "state")!.background);
    expect.soft(l.mark, `${l.name} has a status dot`).toBe(true);
    expect.soft(l.fits, `${l.name} fits its plaque`).toBe(true);
  }
}

test("every building plaque shares one size, font, color and status dot", async ({ page }) => {
  await openAtlas(page, { storage: { mapProjectGrouping: "none" } });
  await waitForScene(page);
  await zoomIn(page, 1);
  await shot(page, "overview-day");
  expectConsistent(await plaqueLooks(page));
  for (const name of ["Financial District", "Atlas Hills", "BMW", "Atlas Airport", "Anthropic"]) {
    await selectBuilding(page, name);
    await waitForScene(page);
    await shot(page, `${name.toLowerCase().replace(/\s+/g, "-")}-day`);
    expectConsistent(await plaqueLooks(page));
  }
});

test("plaques keep the same look at night", async ({ page }) => {
  test.skip(!SHOT_DIR, "screenshots only");
  await openAtlas(page, { light: "night", storage: { mapProjectGrouping: "none" } });
  await waitForScene(page);
  await zoomIn(page, 1);
  await shot(page, "overview-night");
  await selectBuilding(page, "Financial District");
  await shot(page, "financial-district-night");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("plaques on the phone map", async ({ page }) => {
    test.skip(!SHOT_DIR, "screenshots only");
    await openAtlas(page, { storage: { mapProjectGrouping: "none" } });
    await waitForScene(page);
    await selectBuilding(page, "Financial District");
    await shot(page, "phone-financial");
  });
});
