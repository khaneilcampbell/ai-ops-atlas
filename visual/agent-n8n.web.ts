import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas, settle } from "./atlas";
import { NOW } from "./github";
import { sampleGithub } from "./propertiesFixtures";

// An owning agent shows the runs of the n8n workflows its automations link (docs/live-telemetry.md).
// The n8n summary below uses the real workflow ids with sample runs at the frozen clock.
// Screenshots go to SHOT_DIR when set.
const out = process.env.SHOT_DIR ?? "";
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const run = (id: string, minAgo: number, status = "success") => ({ id, status, mode: "trigger", startedAt: ago(minAgo), stoppedAt: ago(minAgo - 1) });
const N8N = {
  state: "ok",
  instance: "https://khancam15.app.n8n.cloud",
  fetchedAt: ago(1),
  window: 50,
  workflows: [
    { id: "JCjTTvb7qZLpVXhs", name: "Atlas · Agent Registry", active: true, failures24h: 0, runs: [run("9101", 55), run("9001", 295)] },
    { id: "iY7mu26VL0xYElAP", name: "Atlas · Business Structure", active: true, failures24h: 0, runs: [run("8901", 480)] },
    { id: "FTCanpGAYPIr3OGe", name: "Atlas · Agent Factory", active: true, failures24h: 0, runs: [] },
    { id: "tGYMec2rp0twZFxv", name: "Atlas · Step Runner", active: true, failures24h: 0, runs: [run("8801", 1300)] },
  ],
};

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/n8n") return route.fulfill({ json: { ...N8N, fetchedAt: new Date(Date.now() - 60_000).toISOString() } });
    if (u.pathname.startsWith("/api/github")) {
      const body = sampleGithub(u.pathname.slice("/api/github".length) + u.search, NOW);
      return route.fulfill({ status: body == null ? 404 : 200, json: body ?? { message: "Not Found" } });
    }
    return route.fulfill({ status: 404, json: { message: "Not in this check." } });
  });
  await openAtlas(page, { storage: { "registry-prefs-agents": { view: "all" } } });
  await settle(page, 4);
  await goTo(page, "Agents");
  await page.getByRole("textbox", { name: "Search agents", exact: true }).fill("agent-operations-lead");
  await settle(page, 1);
  await page.locator('.reg-row[data-id="agent-operations-lead"]').click();
  await settle(page, 1);
}
const save = async (page: Page, name: string) => {
  if (!out) return;
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: `${out}/${name}.png` });
};

for (const [label, width] of [["desktop", 1512], ["phone", 390]] as const) {
  test(`Agent Operations Lead runs through its n8n workflows, ${label}`, async ({ page }) => {
    await open(page, width);
    await save(page, `overview-${width}`);
    await page.getByRole("tab", { name: "Workday", exact: true }).click();
    await settle(page, 1);
    const activity = page.getByTestId("presence-activity");
    await activity.scrollIntoViewIfNeeded();
    if (!process.env.BEFORE) {
      await expect(activity).toContainText("Idle");
      await expect(activity).toContainText("Last run succeeded");
      await expect(activity).not.toContainText("No live telemetry source");
    }
    await save(page, `workday-${width}`);
  });
}
