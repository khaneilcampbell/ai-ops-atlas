import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// Free time from the City agents panel (CityAgentsPanel.tsx, routine/freeTime.ts): the button on a
// free agent, the picker, the agent heading for the Ferris wheel on the map, and "Free time for idle
// agents". Map picture only: nothing is run. Review shots, not baselines:
// FREE_TIME_SHOTS=<dir> npx playwright test -c visual/local-chromium.config.ts visual/free-time.visual.ts
const out = process.env.FREE_TIME_SHOTS ?? "";
test.skip(!out, "Set FREE_TIME_SHOTS to a folder to take these review shots");

const AT = Date.parse("2026-10-28T14:05:00Z"); // 10:05 in New York: most agents are in their free time

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await openAtlas(page, { time: AT, storage: { mapInside: false } });
  await waitForScene(page);
  await settle(page, 4);
}

for (const width of [1512, 390]) {
  test(`Free time ${width}`, async ({ page }) => {
    test.setTimeout(900_000);
    mkdirSync(out, { recursive: true });
    await open(page, width);
    await page.getByRole("button", { name: /^Agents, \d+ active$/ }).click();
    await settle(page, 3);
    const panel = page.getByRole("dialog", { name: "City agents" });
    await page.screenshot({ path: join(out, `${width}-1-roster.png`) });

    // A free agent: the Free time filter's first row.
    await panel.getByRole("button", { name: /^Free time \d+$/ }).click();
    await settle(page, 1);
    const row = panel.locator("button.ca-row").first();
    const name = (await row.locator(".ca-row-name").textContent())!;
    await row.click();
    await settle(page, 2);
    await page.screenshot({ path: join(out, `${width}-2-selected.png`) });
    await panel.getByRole("button", { name: "Free time", exact: true }).click();
    await settle(page, 1);
    await expect(panel.locator(".ca-freetime")).toContainText(`Where should ${name} go?`);
    await panel.locator(".ca-detail").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.screenshot({ path: join(out, `${width}-3-picker.png`) });
    await panel.getByRole("button", { name: "Ferris wheel", exact: true }).click();
    await settle(page, 2);
    await expect(panel.locator(".ca-detail")).toContainText(`${name} is off to the Ferris wheel`);
    await page.screenshot({ path: join(out, `${width}-4-sent.png`) });

    // A few minutes on, the agent is on the way or in the queue: locate it on the map.
    for (let i = 0; i < 6; i++) {
      await page.clock.fastForward(40_000);
      await settle(page, 1);
    }
    await expect(panel.locator(".ca-detail")).toContainText(/Walking|Relaxing|Riding/);
    await panel.getByRole("button", { name: "Locate", exact: true }).click();
    for (let i = 0; i < 3; i++) await settle(page, 2);
    await page.screenshot({ path: join(out, `${width}-5-on-the-way.png`) });

    // Everyone free at once.
    await panel.getByRole("button", { name: "Back to the list" }).click();
    await panel.getByRole("button", { name: /^All/ }).click();
    await settle(page, 1);
    const all = panel.getByRole("button", { name: /^Free time for idle agents/ });
    await all.click();
    await settle(page, 2);
    await expect(panel.locator(".ca-freeall .ca-note")).toContainText("Only the map changes");
    await page.screenshot({ path: join(out, `${width}-6-all-idle.png`) });
  });
}
