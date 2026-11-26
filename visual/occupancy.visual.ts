import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForScene } from "./atlas";

// "Agents inside" markers over occupied buildings (map3d/occupancy.ts, OccupancyMarker.tsx).
// Review shots, not baselines:
// OCC_SHOTS=<dir> npx playwright test -c visual/local-chromium.config.ts visual/occupancy.visual.ts
// OCC_BEFORE=1 takes the same views without checking for markers, for the "before" side on main.
//
// The first marker comes from the real pipeline: an n8n run of Priya Raman's Data Inventory is
// running, so her routine has her inside Atlas Command Center. The crowded views then stand in a
// routine for every named agent (routineOverride, review shots only) with each one at its desk now,
// to show the portrait stack, the +N and several buildings at once.
const out = process.env.OCC_SHOTS ?? "";
const before = !!process.env.OCC_BEFORE;
test.skip(!out, "Set OCC_SHOTS to a folder to take these review shots");
test.use({ deviceScaleFactor: 2 });

const SCHEDULED = Date.parse("2026-10-28T11:20:00Z"); // Priya Raman's Data Inventory, 7:20 New York
const AT = SCHEDULED + 70_000;
const iso = (t: number) => new Date(t).toISOString();
const run = { id: "901", status: "running", mode: "trigger", startedAt: iso(SCHEDULED + 2000), stoppedAt: null };
const snapshot = { state: "ok", instance: "https://khancam15.app.n8n.cloud", fetchedAt: iso(AT), window: 250, workflows: [{ id: "Hua0wdGB5WSDjSGB", name: "Atlas · Data Inventory", active: true, runs: [run], failures24h: 0, schedules: [{ label: "Daily at 7:20", cron: "20 7 * * *" }], timezone: "America/New_York", savesSuccess: true }] };

/** Every named agent at its desk now (review shots only). */
async function everyoneAtWork(page: Page) {
  await page.evaluate(async () => {
    type R = { personaId: string; segments: unknown[]; validUntil: number; episodes: unknown[]; held: boolean };
    const ops = (await import("/src/routine/useRoutineOps.ts" as string)) as { routinesSnapshot(): ReadonlyMap<string, R>; routineOverride: Map<string, R> };
    const now = Date.now();
    for (const [id, r] of ops.routinesSnapshot()) {
      const seg = { kind: "inside", t0: now - 60_000, t1: now + 3_600_000, at: `office:${id}`, activity: "at_desk", phase: "working", note: "Review shot", work: { label: "Review shot", runs: [], scheduledAt: now, alreadyStarted: false, outcome: null } };
      ops.routineOverride.set(id, { ...r, segments: [seg], validUntil: now + 3_600_000 });
    }
  });
  // Occupancy is re-read every 10 seconds of the page's clock.
  await page.clock.fastForward(11_000);
  await settle(page, 4);
}

/** Agents spread over every kind of building: offices, homes, the arena and the airport terminal (review shots only). */
async function everyoneIndoors(page: Page) {
  await page.evaluate(async () => {
    type R = { personaId: string; segments: unknown[]; validUntil: number; episodes: unknown[]; held: boolean };
    const ops = (await import("/src/routine/useRoutineOps.ts" as string)) as { routinesSnapshot(): ReadonlyMap<string, R>; routineOverride: Map<string, R> };
    const now = Date.now(), t0 = now - 60_000, t1 = now + 3_600_000;
    [...ops.routinesSnapshot()].forEach(([id, r], i) => {
      const k = i % 4;
      const seg =
        k === 0
          ? { kind: "inside", t0, t1, at: `office:${id}`, activity: "at_desk", phase: "working", note: "Review shot", work: { label: "Review shot", runs: [], scheduledAt: now, alreadyStarted: false, outcome: null } }
          : { kind: "stay", t0, t1, at: k === 1 ? `home:${id}` : k === 2 ? "arena" : "flight", activity: k === 1 ? "at_home" : "visiting", phase: null, note: "Review shot" };
      ops.routineOverride.set(id, { ...r, segments: [seg], validUntil: t1 });
    });
  });
  await page.clock.fastForward(11_000);
  await settle(page, 4);
}

async function open(page: Page, light: "day" | "night", width: number, height: number) {
  await page.setViewportSize({ width, height });
  await openAtlas(page, { time: AT, light, storage: { "routine-n8n-snapshot": snapshot, mapInside: false } });
  await waitForScene(page);
  await settle(page, 4);
  await page.clock.fastForward(11_000);
  await settle(page, 4);
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`) });

for (const light of ["day", "night"] as const)
  test(`Agents inside markers on the desktop map (${light})`, async ({ page }) => {
    test.setTimeout(900_000);
    mkdirSync(out, { recursive: true });
    await open(page, light, 1512, 900);
    const markers = page.locator(".m3-occupancy");
    if (!before) {
      // Real pipeline: Priya's running Data Inventory puts one agent inside Atlas Command Center.
      await expect.poll(async () => markers.count(), { timeout: 60_000 }).toBeGreaterThan(0);
      await expect(page.locator('.m3-occupancy[aria-label^="Atlas Command Center: 1 agent inside"]')).toHaveCount(1);
    }
    await shot(page, `1512-${light}-1-real`);
    await everyoneAtWork(page);
    if (!before) await expect.poll(async () => markers.count(), { timeout: 60_000 }).toBeGreaterThan(2);
    await shot(page, `1512-${light}-2-overview`);
    await everyoneIndoors(page);
    if (!before) await expect(page.locator('.m3-occupancy[aria-label^="Atlas Commons Arena:"]')).toHaveCount(1);
    await shot(page, `1512-${light}-2b-every-building`);
    await everyoneAtWork(page);
    if (before || light === "night") return;

    // Hover: the tooltip names the building, the count and each agent with its status.
    const hq = page.locator('.m3-occupancy[aria-label^="Atlas Command Center:"]');
    await hq.hover();
    await settle(page, 1);
    await expect(hq.locator(".occ-tip")).toBeVisible();
    await shot(page, `1512-${light}-3-hover`);
    // Keyboard: Tab-reachable, visible focus ring, same tooltip.
    await page.mouse.move(5, 450);
    await page.keyboard.press("Shift+Tab");
    await hq.focus();
    await settle(page, 1);
    await expect(hq).toBeFocused();
    await shot(page, `1512-${light}-4-focus`);
    // Enter opens the building in the Inside view, the way "View office" does.
    await page.keyboard.press("Enter");
    await settle(page, 8);
    await expect(page.getByRole("button", { name: "Inside", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(hq).toHaveCount(0);
    await shot(page, `1512-${light}-5-entered`);
  });

test("Agents inside markers on a phone: tap to see who, tap again to go in", async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(out, { recursive: true });
  await open(page, "day", 390, 844);
  await everyoneAtWork(page);
  await selectBuilding(page, "Atlas Command Center");
  await page.keyboard.press("Escape");
  await settle(page, 4);
  await shot(page, "390-day-1-overview");
  if (before) return;
  const hq = page.locator('.m3-occupancy[aria-label^="Atlas Command Center:"]');
  await expect(hq).toHaveCount(1);
  // A touch tap (a click whose pointer is a finger) shows the tooltip first.
  await hq.evaluate((el) => el.dispatchEvent(new PointerEvent("click", { bubbles: true, cancelable: true, pointerType: "touch" })));
  await settle(page, 1);
  await expect(hq).toHaveClass(/open/);
  await shot(page, "390-day-2-tapped");
});
