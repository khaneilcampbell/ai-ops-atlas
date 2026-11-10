import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForOffice } from "./atlas";

test.use({ deviceScaleFactor: 1 });
// Benjaire Dashboard left the map in #297, so only Intelligence Hub still has a building to enter.
for (const name of ["Intelligence Hub"]) {
  test(`${name}: Atlas repository, building entry, floors and exit`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openAtlas(page);
    await selectBuilding(page, name);
    const panel = page.getByRole("complementary", { name: "Inspector" });
    await expect(panel.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Inspect repository khaneilcampbell/ai-ops-atlas", exact: true })).toBeVisible();
    mkdirSync("visual/out", { recursive: true });
    await page.screenshot({ path: `visual/out/${name.replaceAll(" ", "-")}-migration.png` });
    await page.getByRole("button", { name: "Enter building", exact: true }).click();
    await settle(page, 3); await waitForOffice(page);
    const nav = page.getByRole("navigation", { name: "Building floor navigation" });
    await nav.getByRole("button", { name: "Lobby", exact: true }).click();
    await settle(page, 2); await waitForOffice(page);
    await nav.getByRole("button", { name: "All floors", exact: true }).click();
    await settle(page, 2); await waitForOffice(page);
    await page.getByRole("button", { name: "Exit building", exact: true }).click();
    await settle(page, 2);
    await expect(page.locator(".office-layer")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
