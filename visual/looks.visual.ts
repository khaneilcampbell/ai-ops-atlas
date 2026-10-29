import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForScene } from "./atlas";

const OUT = join(import.meta.dirname, "out", "looks");
const only = process.env.LOOKS?.split(",") ?? ["classic", "studio", "golden", "gallery"];
for (const look of only)
  for (const light of ["day", "night"] as const)
    test(`office ${look} ${light}`, async ({ page }) => {
      await openAtlas(page, { light, storage: { officeLook: look } });
      await selectBuilding(page, "AI Ops Atlas");
      await page.getByRole("button", { name: "Enter building" }).click();
      await settle(page, 4);
      await waitForScene(page);
      await settle(page, 3);
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, `${look}-${light}.png`), animations: "disabled", caret: "hide" });
    });
