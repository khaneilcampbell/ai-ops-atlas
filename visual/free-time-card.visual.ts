import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// Free time on the map's agent card (AgentTaskCard.tsx, FreeTimePicker.tsx): the button, the picker,
// the note once sent, and the reason shown for an agent that can't go. Review shots, not baselines:
// FREE_TIME_CARD_SHOTS=<dir> npx playwright test -c visual/local-chromium.config.ts visual/free-time-card.visual.ts
const out = process.env.FREE_TIME_CARD_SHOTS ?? "";
test.skip(!out, "Set FREE_TIME_CARD_SHOTS to a folder to take these review shots");

const AT = Date.parse("2026-10-28T14:05:00Z"); // 10:05 in New York: most agents are in their free time

for (const width of [1512, 390]) {
  test(`Free time on the agent card ${width}`, async ({ page }) => {
    test.setTimeout(900_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await openAtlas(page, { time: AT, storage: { mapInside: false } });
    await waitForScene(page);
    await settle(page, 4);

    // Pick a free agent through the City agents panel, then close it so the map card shows.
    await page.getByRole("button", { name: /^Agents, \d+ active$/ }).click();
    await settle(page, 2);
    const panel = page.getByRole("dialog", { name: "City agents" });
    await panel.getByRole("button", { name: /^Free time \d+$/ }).click();
    const row = panel.locator("button.ca-row").first();
    const name = (await row.locator(".ca-row-name").textContent())!;
    await row.click();
    await settle(page, 1);
    await panel.getByRole("button", { name: "Close City agents" }).click();
    await settle(page, 2);
    const card = page.locator(".m3-agent-task");
    await expect(card).toContainText(name);
    await page.screenshot({ path: join(out, `${width}-1-card.png`) });

    await card.getByRole("button", { name: "Free time", exact: true }).click();
    await settle(page, 1);
    await expect(card.locator(".ca-freetime")).toContainText(`Where should ${name} go?`);
    await page.screenshot({ path: join(out, `${width}-2-picker.png`) });
    await card.getByRole("button", { name: "Yacht ride", exact: true }).click();
    await settle(page, 2);
    await expect(card.locator(".free-note")).toContainText(`${name} is off to a yacht ride`);
    await page.screenshot({ path: join(out, `${width}-3-sent.png`) });
  });
}
