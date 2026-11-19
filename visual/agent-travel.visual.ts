import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// Agents travelling by car or train (agentRides.ts, Khaneil 2026-11-19): the Travel by choice in the Free time picker,
// an agent waiting at the kerb for an Atlas car, and riding in it (badge on the car). Map picture only: nothing is run.
// Review shots, not baselines:
// TRAVEL_SHOTS=<dir> npx playwright test -c visual/local-chromium.config.ts visual/agent-travel.visual.ts
const out = process.env.TRAVEL_SHOTS ?? "";
test.skip(!out, "Set TRAVEL_SHOTS to a folder to take these review shots");
// The cars and the train only move with motion on.
test.use({ reducedMotion: "no-preference" });

const AT = Date.parse("2026-10-28T14:05:00Z"); // 10:05 in New York: most agents are in their free time

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await openAtlas(page, { time: AT, storage: { mapInside: false } });
  await waitForScene(page);
  // The train (and so the cars' shared clock) runs only in the window in front: headless never has focus by itself.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await settle(page, 4);
}

for (const width of process.env.TRAVEL_WIDTH ? [Number(process.env.TRAVEL_WIDTH)] : [1512, 390]) {
  test(`Travel by car ${width}`, async ({ page }) => {
    test.setTimeout(900_000);
    mkdirSync(out, { recursive: true });
    await open(page, width);
    await page.getByRole("button", { name: /^Agents, \d+ active$/ }).click();
    await settle(page, 3);
    const panel = page.getByRole("dialog", { name: "City agents" });
    await panel.getByRole("button", { name: /^Free time \d+$/ }).click();
    await settle(page, 1);
    const row = panel.locator("button.ca-row").first();
    const name = (await row.locator(".ca-row-name").textContent())!;
    await row.click();
    await settle(page, 2);
    await panel.getByRole("button", { name: "Free time", exact: true }).click();
    await settle(page, 1);
    await expect(panel.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    await panel.getByRole("radio", { name: "Car" }).click();
    await expect(panel.locator(".ca-freetime")).toContainText("An Atlas car picks it up at the kerb");
    await panel.locator(".ca-detail").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.screenshot({ path: join(out, `${width}-1-picker.png`) });
    await panel.getByRole("button", { name: "Arena", exact: true }).click();
    await settle(page, 2);
    await expect(panel.locator(".ca-detail")).toContainText(`${name} is off to the arena by Atlas car`);
    await page.screenshot({ path: join(out, `${width}-2-sent.png`) });
    await panel.getByRole("button", { name: "Follow" }).click();

    // Walking to the kerb, waiting there, then riding (the badge rides on the car).
    const seen = new Set<string>();
    for (let i = 0; i < Number(process.env.TRAVEL_STEPS ?? 40) && seen.size < 2; i++) {
      await page.clock.fastForward(5_000);
      await settle(page, 1);
      const text = (await panel.locator(".ca-detail").textContent()) ?? "";
      const step = /Waiting for a ride/.test(text) ? "3-waiting" : /Riding in an Atlas car/.test(text) ? "4-riding" : null;
      if (step && !seen.has(step)) {
        seen.add(step);
        await settle(page, 2);
        await page.screenshot({ path: join(out, `${width}-${step}.png`) });
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
}
