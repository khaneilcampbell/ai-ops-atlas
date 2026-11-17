import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Agent profiles filled from production evidence (2026-11-17): the Documentation tab of one
// owning agent, one Business Operations HQ automation and Atlas Data Inventory. Screenshots only, into
// visual/out/agent-profiles/ (PROFILE_SHOTS overrides), not baselines.
test.use({ deviceScaleFactor: 1 });
const out = process.env.PROFILE_SHOTS ?? "visual/out/agent-profiles";

const SHOTS = [
  { id: "benjaire-inquiry-manager", section: "Agents" },
  { id: "benjaire-flow-status", section: "Automations" },
  { id: "atlas-data-inventory", section: "Automations" },
];
for (const width of [1512, 390])
  for (const { id, section } of SHOTS)
    test(`Agent profile ${id} ${width}`, async ({ page }) => {
      test.setTimeout(180_000);
      mkdirSync(out, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await openAtlas(page, { storage: { "registry-prefs-agents": { view: "all" }, "registry-prefs-automations": { view: "all" } } });
      await goTo(page, section);
      await page.locator(`.reg-row[data-id="${id}"]`).click();
      await settle(page, 1);
      // On a phone the agent opens in a sheet with Overview and Output only; shoot the sheet.
      const tab = page.getByRole("tab", { name: /Documentation/ });
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await settle(page, 1);
        await tab.evaluate((e) => e.scrollIntoView({ block: "start" }));
        await settle(page, 1);
      }
      await page.screenshot({ path: `${out}/${id}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    });
