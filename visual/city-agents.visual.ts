import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// The map's City agents panel (views/map3d/CityAgentsPanel.tsx): the toolbar button with the real
// agent count, the roster, search and filters, a selected agent's details and actions, the phone
// sheet, and the honest "Status unavailable" view when live n8n isn't readable. n8n is answered
// from a saved summary of four real workflow ids (nothing is run). Review shots, not baselines:
// CITY_AGENTS_SHOTS=<dir> npx playwright test -c visual visual/city-agents.visual.ts
const out = process.env.CITY_AGENTS_SHOTS ?? "";
test.skip(!out, "Set CITY_AGENTS_SHOTS to a folder to take these review shots");

const AT = Date.parse("2026-10-28T11:21:10Z"); // 7:21 in New York, during Data Inventory's 7:20 run
const iso = (t: number) => new Date(t).toISOString();
const MIN = 60_000;
const snapshot = {
  state: "ok",
  instance: "https://khancam15.app.n8n.cloud",
  fetchedAt: iso(AT - 30_000),
  window: 250,
  workflows: [
    { id: "Hua0wdGB5WSDjSGB", name: "Atlas · Data Inventory", active: true, runs: [{ id: "901", status: "running", mode: "trigger", startedAt: iso(AT - 70_000), stoppedAt: null }], failures24h: 0, schedules: [{ label: "Daily at 7:20", cron: "20 7 * * *" }], timezone: "America/New_York", savesSuccess: true },
    { id: "JCjTTvb7qZLpVXhs", name: "Agent Registry sync", active: true, runs: [{ id: "711", status: "error", mode: "trigger", startedAt: iso(AT - 80 * MIN), stoppedAt: iso(AT - 79 * MIN) }], failures24h: 1, schedules: [{ label: "Every 4 hours", cron: "0 */4 * * *" }], timezone: "America/New_York", savesSuccess: false },
    { id: "FTCanpGAYPIr3OGe", name: "Agent Factory", active: true, runs: [], failures24h: 0, schedules: [{ label: "Mondays at 8:00", cron: "0 8 * * 1" }], timezone: "America/New_York", savesSuccess: true },
    { id: "bgebM33jnVhLPSTF", name: "Top 10 Agent Ideas", active: true, runs: [], failures24h: 0, schedules: [{ label: "Sundays at 9:00", cron: "0 9 * * 0" }], timezone: "America/New_York", savesSuccess: true },
  ],
};

async function open(page: Page, width: number, live = true) {
  const phone = width < 600;
  await page.setViewportSize({ width, height: phone ? 844 : 900 });
  await openAtlas(page, { time: AT, storage: { ...(live ? { "routine-n8n-snapshot": snapshot } : {}), mapInside: false } });
  await waitForScene(page);
  await settle(page, 4);
}

for (const width of [1512, 390]) {
  test(`City agents panel ${width}`, async ({ page }) => {
    test.setTimeout(600_000);
    mkdirSync(out, { recursive: true });
    await open(page, width);
    const btn = page.getByRole("button", { name: /^Agents, \d+ active$/ });
    await expect(btn).toBeVisible();
    await page.screenshot({ path: join(out, `${width}-1-toolbar.png`) });
    await btn.click();
    await settle(page, 3);
    const panel = page.getByRole("dialog", { name: "City agents" });
    await expect(panel).toBeVisible();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    const count = Number((await btn.getAttribute("aria-label"))!.match(/\d+/)![0]);
    await expect(panel.locator("button.ca-row")).toHaveCount(count);
    await page.screenshot({ path: join(out, `${width}-2-roster.png`) });

    // Selecting a row opens the details and selects the same agent on the map (no camera move).
    await panel.locator("button.ca-row", { hasText: "Priya Raman" }).first().click();
    await settle(page, 3);
    await expect(panel.locator(".ca-detail")).toContainText("Running");
    await expect(panel.locator(".ca-detail")).toContainText(/EDT|EST/);
    await page.screenshot({ path: join(out, `${width}-3-selected.png`) });

    // Locate glides to her; Schedule shows the read-only schedule.
    await panel.getByRole("button", { name: "Locate", exact: true }).click();
    for (let i = 0; i < 3; i++) await settle(page, 2);
    await panel.getByRole("button", { name: "Schedule", exact: true }).click();
    await settle(page, 2);
    await expect(panel.locator(".ca-schedule")).toContainText("Read-only");
    await panel.locator(".ca-detail").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.screenshot({ path: join(out, `${width}-4-located-schedule.png`) });

    // Follow, then a pick on the map (the same call a tap on a character makes) moves the roster's selection.
    await panel.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Stop following" })).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => (window as unknown as { __atlasOpenAgent(id: string): void }).__atlasOpenAgent("benjaire-shop-manager"));
    await settle(page, 2);
    await expect(panel.locator(".ca-detail .ca-name")).toHaveText("Mateo Rossi");
    await expect(page.locator(".m3-agent-task")).toHaveCount(0);

    // Search and the Attention filter; arrow keys move between rows.
    await panel.getByRole("button", { name: "Back to the list" }).click();
    await panel.locator("button.ca-row").first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(panel.locator("button.ca-row").nth(1)).toBeFocused();
    await panel.getByRole("button", { name: /^Attention/ }).click();
    await settle(page, 1);
    await page.screenshot({ path: join(out, `${width}-5-attention.png`) });
    await panel.getByRole("button", { name: /^All/ }).click();
    await panel.getByPlaceholder("Search name, role or building").fill("zzz");
    await expect(panel.locator(".ca-empty")).toContainText("No agents match");
    await page.screenshot({ path: join(out, `${width}-6-empty-search.png`) });

    // Escape closes the panel and gives focus back to the toolbar button.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test(`City agents panel without live n8n ${width}`, async ({ page }) => {
    test.setTimeout(600_000);
    mkdirSync(out, { recursive: true });
    await open(page, width, false);
    await page.getByRole("button", { name: /^Agents, \d+ active$/ }).click();
    await settle(page, 3);
    const panel = page.getByRole("dialog", { name: "City agents" });
    await panel.locator("button.ca-row", { hasText: "Priya Raman" }).first().click();
    await settle(page, 2);
    await expect(panel.locator(".ca-detail")).toContainText("Status unavailable");
    await expect(panel.locator(".ca-detail")).toContainText("Schedule unavailable");
    await page.screenshot({ path: join(out, `${width}-7-unavailable.png`) });
  });
}
