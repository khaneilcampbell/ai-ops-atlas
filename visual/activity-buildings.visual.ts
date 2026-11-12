import { test, expect } from "@playwright/test";
import { openAtlas, goTo } from "./atlas";

// Activity's Project filter lists the buildings on the map today, not removed ones.
for (const phone of [false, true]) {
  test(`Activity building filter ${phone ? "phone" : "desktop"}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await openAtlas(page);
    await goTo(page, "Activity");
    const filter = page.getByRole("combobox", { name: "Project", exact: true });
    await expect(filter.locator("option", { hasText: "Atlas Command Center" })).toHaveCount(1);
    for (const name of ["Skyline", "Service Desk", "Benjaire Dashboard"]) {
      await expect(filter.locator("option").filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(0);
    }
  });
}
