import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { goTo, openAtlas } from "./atlas";

// Before and after screenshots for Design Consistency fix pull requests (ops/design-consistency).
// Runs only when DESIGN_SHOTS names a folder; the regular visual checks skip it.
const OUT = process.env.DESIGN_SHOTS;

// 1x keeps the images small enough to show inline on the pull request.
test.use({ deviceScaleFactor: 1 });
test.skip(!OUT, "Set DESIGN_SHOTS to a folder to take design screenshots.");

for (const [name, nav] of [["mission-control", "Mission"], ["agents", "Agents"], ["repositories", "Repositories"]] as const) {
  test(`design: ${name}`, async ({ page }) => {
    await openAtlas(page, { storage: { "mission-tab": "overview" } });
    await goTo(page, nav);
    mkdirSync(OUT!, { recursive: true });
    await page.screenshot({ path: join(OUT!, `${name}.png`), animations: "disabled", caret: "hide" });
  });
}
