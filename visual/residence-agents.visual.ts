import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openAtlas, settle, waitForScene } from "./atlas";

// Review shots, not baselines: RESIDENCE_SHOTS=<dir> npx playwright test -c visual visual/residence-agents.visual.ts
// Agents inside Ellipse Residences, in the apartments their home cards name, home or out by their own day.
const out = process.env.RESIDENCE_SHOTS ?? "";
test.skip(!out, "Set RESIDENCE_SHOTS to a folder to take these review shots");

const TIMES = { night: Date.parse("2026-11-19T04:30:00Z"), day: Date.parse("2026-11-19T18:00:00Z") };
const SIZES = { 1512: { width: 1512, height: 945 }, 390: { width: 390, height: 844 } };

for (const [when, time] of Object.entries(TIMES))
  for (const [size, viewport] of Object.entries(SIZES))
    test(`residents at home, ${when}, ${size}`, async ({ page }) => {
      test.setTimeout(300_000);
      mkdirSync(out, { recursive: true });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize(viewport);
      await openAtlas(page, { light: when === "night" ? "night" : "day", time });
      await waitForScene(page);
      await settle(page, 6);
      await page.evaluate(async () => {
        const m = await import("/src/views/office/store.ts" as string);
        m.enterBuilding("skyline-business:Ellipse Residences", true);
      });
      await settle(page, 4);
      for (const [name, label] of [["floor3", /^Floor 3$/], ["floor4", /^Floor 4$/], ["all", /^All floors$/]] as const) {
        await page.getByRole("button", { name: label }).click();
        for (let i = 0; i < 6; i++) {
          await page.waitForTimeout(250);
          await settle(page, 2);
        }
        await page.screenshot({ path: `${out}/${name}-${when}-${size}.png` });
      }
      expect(errors).toEqual([]);
    });
