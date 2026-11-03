import { expect, test, type Page } from "@playwright/test";
import { check, openAtlas, selectBuilding, settle, waitForScene } from "./atlas";

/**
 * The map's Inside toggle (InsideView): headquarters open as cutaways without entering.
 * Day and night on a desktop, zoomed in on Atlas HQ so its office shows in full, and a phone.
 * Each case also checks that the toggle is a pressed button, that the choice is saved, and that
 * turning it off closes every building again.
 */
async function inside(page: Page) {
  return page.evaluate(async () => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Map renderer missing");
    const fiber = await import(url);
    const state = fiber._roots.get(document.querySelector("canvas"))?.store.getState();
    const materials = await import("/src/views/map3d/materials.ts");
    return { open: materials.cutCount.value as number, drawn: !!state.scene.getObjectByName("atlas-inside-view") };
  });
}

async function zoomIn(page: Page, times: number) {
  for (let i = 0; i < times; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await settle(page, 6);
}

test.use({ deviceScaleFactor: 1 });

for (const light of ["day", "night"] as const)
  test(`Inside shows the offices of nearby buildings (${light})`, async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openAtlas(page, { light });
    await waitForScene(page);
    const toggle = page.getByRole("button", { name: "Inside", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await selectBuilding(page, "Atlas");
    await zoomIn(page, 4);
    // SHOTS=1 also keeps the same view before the toggle, for the pull request's before/after.
    if (process.env.SHOTS) await page.screenshot({ path: `visual/out/inside-${light}-before.png` });

    await toggle.click();
    await settle(page, 8);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("atlas:mapInside"))).toBe("true");
    expect(await inside(page)).toMatchObject({ drawn: true });
    expect((await inside(page)).open).toBeGreaterThan(0);
    await check(page, `inside-${light}`);

    // The I key on the focused map turns it off too, and every building closes again.
    await page.locator(".map-stage").focus();
    await page.keyboard.press("i");
    await settle(page, 8);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(await inside(page)).toEqual({ open: 0, drawn: false });
    expect(errors).toEqual([]);
  });

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("Inside fits the phone toolbar and opens a building", async ({ page }) => {
    test.setTimeout(600_000);
    await openAtlas(page, { light: "day" });
    await waitForScene(page);
    // No selection here: on a phone the inspector sheet covers the toolbar. Zoom in with the keys.
    await page.locator(".map-stage").focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("+");
    await settle(page, 6);
    if (process.env.SHOTS) await page.screenshot({ path: "visual/out/inside-phone-before.png" });
    const toggle = page.getByRole("button", { name: "Inside", exact: true });
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // One row, no wrapping, and the Inside button in full view beside 3D. (The toolbar already
    // scrolls sideways at 390 wide on main: Rotate, Fit and Names sit past the edge.)
    const rows = await page.locator(".map-controls > button:visible, .map-controls .map-menu-wrap > button:visible").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(rows).size).toBe(1);
    const box = (await toggle.boundingBox())!;
    const threeD = (await page.getByRole("button", { name: "3D map", exact: true }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(Math.round(box.y)).toBe(Math.round(threeD.y));
    expect(box.x).toBeCloseTo(threeD.x + threeD.width, 0);
    await settle(page, 6);
    expect((await inside(page)).open).toBeGreaterThan(0);
    await check(page, "inside-phone");
  });
});
