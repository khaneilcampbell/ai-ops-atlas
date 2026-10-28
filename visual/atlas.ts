import { expect, type Page } from "@playwright/test";
import { answer, NOW } from "./github";

export interface Prep {
  light?: "day" | "night";
  /** Extra `atlas:` localStorage entries, values as JSON. */
  storage?: Record<string, unknown>;
}

/**
 * Opens the app the way the screenshots need it: GitHub answered from fixtures, the clock
 * frozen at NOW so animation and "x minutes ago" text are the same every run, and map
 * preferences set up front. Nothing desktop-only runs: in a plain browser the app already
 * skips Tauri (Keychain, updater, vault) and reads GitHub anonymously, which we intercept.
 */
export async function openAtlas(page: Page, prep: Prep = {}) {
  const storage: Record<string, unknown> = { mapMode: "3d", mapLight: prep.light ?? "day", mapTraffic: true, ...prep.storage };
  await page.addInitScript((entries) => {
    if (sessionStorage.getItem("atlas:visual-seeded")) return;
    localStorage.clear();
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(`atlas:${k}`, JSON.stringify(v));
    sessionStorage.setItem("atlas:visual-seeded", "1");
  }, storage);
  await page.route("https://api.github.com/**", async (route) => {
    const u = new URL(route.request().url());
    const body = answer(u.pathname + u.search);
    await route.fulfill({
      status: body == null ? 404 : 200,
      contentType: "application/json",
      headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "59", "x-ratelimit-reset": String(Math.floor(NOW / 1000) + 3600) },
      body: JSON.stringify(body ?? { message: "Not Found" }),
    });
  });
  // Paused from the start: timers and animation frames only run when we step the clock.
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW);
  await page.goto("/");
  await expect(page.locator(".nav-item").first()).toBeVisible();
  await settle(page);
}

/**
 * Lets the app finish its GitHub sync and the scene draw, then stops time. Each step jumps the
 * fake clock, then draws a few animation frames, so moving things land in the same place every
 * run. Software WebGL takes most of a second per frame at 2x, hence a few steps, not 60 a second.
 */
export async function settle(page: Page, steps = 3) {
  for (let i = 0; i < steps; i++) {
    await page.waitForLoadState("networkidle");
    await page.clock.fastForward(200);
    // A few real frames in a row: scenes that draw on demand need more than one tick.
    await page.clock.runFor(34);
  }
}

export async function goTo(page: Page, label: string) {
  await page.locator(".nav-item", { hasText: label }).first().click();
  await settle(page);
}

/** Selects a building on the 3D map by its nameplate text. */
export async function selectBuilding(page: Page, name: string) {
  await page.locator(".m3-plaque", { hasText: name }).first().dispatchEvent("click");
  await settle(page, 4);
}
