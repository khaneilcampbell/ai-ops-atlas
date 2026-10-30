import { test, type Browser, type Page } from "@playwright/test";
import { answer, NOW } from "./github";

// Power check: how many frames and draw calls the map asks the GPU for while it sits idle, the
// main cost in battery. Not a screenshot test; runs only with POWER=1 (npm run measure:power).
// The page clock is stepped through one second of time with real animation (no reduced
// motion), so the counts don't depend on how fast this machine's software WebGL is.
const POWER = !!process.env.POWER;

/** A fresh page per run, small and at 1x so software WebGL gets through a second of frames. */
async function open(browser: Browser, baseURL: string, storage: Record<string, unknown>) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 800, height: 500 }, deviceScaleFactor: 1, reducedMotion: "no-preference", locale: "en-US", timezoneId: "UTC" });
  const page = await ctx.newPage();
  await page.addInitScript((entries) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(`atlas:${k}`, JSON.stringify(v));
    // Count WebGL draw calls, and frames: runs of draws to the screen within one task. (The page
    // clock replaces requestAnimationFrame, so frames can't be counted there.)
    const w = window as unknown as { __draws: number; __frames: number };
    w.__draws = 0;
    w.__frames = 0;
    for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
      const p = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
      const fbs = new WeakMap<object, unknown>();
      const bind = p.bindFramebuffer;
      p.bindFramebuffer = function (this: object, target: unknown, fb: unknown) {
        fbs.set(this, fb);
        return bind.call(this, target, fb);
      };
      let inFrame = false;
      for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"] as const) {
        const orig = p[name];
        if (!orig) continue;
        p[name] = function (this: object, ...a: unknown[]) {
          w.__draws++;
          if (!fbs.get(this) && !inFrame) {
            inFrame = true;
            w.__frames++;
            void Promise.resolve().then(() => (inFrame = false));
          }
          return orig.apply(this, a);
        };
      }
    }
  }, { mapMode: "3d", mapTraffic: true, ...storage });
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
  await page.clock.install();
  await page.goto("/");
  await page.locator(".map3d canvas").first().waitFor();
  // Let models load and the first heavy frames pass.
  await page.waitForTimeout(6000);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.mouse.move(400, 250);
  return page;
}

async function sample(page: Page, label: string, before?: () => Promise<void>) {
  const read = () => page.evaluate(() => ({ draws: (window as unknown as { __draws: number }).__draws, frames: (window as unknown as { __frames: number }).__frames }));
  await page.clock.runFor(500);
  await before?.();
  const a = await read();
  await page.clock.runFor(1000);
  const b = await read();
  const fps = b.frames - a.frames;
  const dps = b.draws - a.draws;
  console.log(`POWER ${label.padEnd(34)} frames/s ${String(fps).padStart(3)}  draw calls/s ${String(dps).padStart(6)}`);
}

test.describe("power", () => {
  test.skip(!POWER, "Set POWER=1 to measure.");

  test("map idle", async ({ browser, baseURL }) => {
    test.setTimeout(900_000);
    for (const light of ["day", "night"] as const) {
      for (const power of [undefined, "saver"] as const) {
        const page = await open(browser, baseURL!, { mapLight: light, ...(power ? { powerMode: power } : {}) });
        const name = `${light}${power ? `, ${power}` : ""}`;
        await sample(page, `${name}, at rest`);
        await sample(page, `${name}, scrolled to zoom`, () => page.mouse.wheel(0, -40));
        if (power) await sample(page, `${name}, window in background`, () => page.evaluate(() => void window.dispatchEvent(new Event("blur"))));
        await page.context().close();
      }
    }
  });
});
