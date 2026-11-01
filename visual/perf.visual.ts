import { test, type Browser, type Page } from "@playwright/test";
import { answer, NOW } from "./github";

// Performance probe for the 3D map: what one frame asks of the GPU (draw calls, triangles,
// shadow and offscreen passes), what the scene keeps on the GPU (geometry bytes, textures, shader
// programs), CPU time per frame, and whether leaving the map and coming back leaks anything.
// Not a screenshot test; runs only with PERF=1 (npm run measure:perf). Counts don't depend on how
// fast this machine's software WebGL is, so they compare across machines and branches.
// Each result is printed as a `PERF {json}` line; with PERF_BUDGET=1 the test also fails when the
// map goes over the budget below.
const PERF = !!process.env.PERF;

/**
 * Budget for one map frame at the default (Balanced) setting, by day, on a desktop window. Measured
 * on 2026-10-31: main (#153) draws about 560 calls and 0.79M triangles a frame with 52 shader
 * programs and 2 MB of geometry; the open map drafts add at most a few percent each. #148 showed
 * what happens past this: software WebGL (CI, and a Mac that falls back to it) stopped finishing
 * frames and the map went blank. Raise a number only with a measured reason in the pull request.
 */
export const BUDGET = { drawsPerFrame: 800, trianglesPerFrame: 1_200_000, programs: 80, geometryMB: 8, contextsAlive: 1 } as const;

type Probe = { draws: number; screenDraws: number; tris: number; frames: number; bufferBytes: number; liveBuffers: number; liveTextures: number; programs: number };

async function open(browser: Browser, baseURL: string, vp: { width: number; height: number }, storage: Record<string, unknown>) {
  const ctx = await browser.newContext({ baseURL, viewport: vp, deviceScaleFactor: 1, reducedMotion: "no-preference", locale: "en-US", timezoneId: "UTC" });
  const page = await ctx.newPage();
  await page.addInitScript((entries) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(`atlas:${k}`, JSON.stringify(v));
    // Totals across the page, plus what each WebGL context still holds (a context that's left
    // alive after the map unmounts is a leak, whatever it holds).
    const w = window as unknown as { __perf: Probe; __ctx: { gl: WebGLRenderingContext; buffers: number; textures: number; programs: number }[] };
    const P: Probe = (w.__perf = { draws: 0, screenDraws: 0, tris: 0, frames: 0, bufferBytes: 0, liveBuffers: 0, liveTextures: 0, programs: 0 });
    w.__ctx = [];
    const ctxOf = (gl: object) => {
      let c = w.__ctx.find((x) => x.gl === gl);
      if (!c) w.__ctx.push((c = { gl: gl as WebGLRenderingContext, buffers: 0, textures: 0, programs: 0 }));
      return c;
    };
    const sizes = new WeakMap<object, number>();
    for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
      const p = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
      const fbs = new WeakMap<object, unknown>();
      const bufs = new WeakMap<object, unknown>();
      const wrap = (name: string, after: (self: object, a: unknown[], r: unknown) => void) => {
        const orig = p[name];
        if (!orig) return;
        p[name] = function (this: object, ...a: unknown[]) {
          const r = orig.apply(this, a);
          after(this, a, r);
          return r;
        };
      };
      wrap("bindFramebuffer", (self, a) => fbs.set(self, a[1]));
      wrap("bindBuffer", (self, a) => bufs.set(self, a[1]));
      wrap("createBuffer", (self) => { P.liveBuffers++; ctxOf(self).buffers++; });
      wrap("deleteBuffer", (self, a) => { if (a[0]) { P.liveBuffers--; ctxOf(self).buffers--; P.bufferBytes -= sizes.get(a[0] as object) ?? 0; } });
      wrap("createTexture", (self) => { P.liveTextures++; ctxOf(self).textures++; });
      wrap("deleteTexture", (self, a) => { if (a[0]) { P.liveTextures--; ctxOf(self).textures--; } });
      wrap("linkProgram", (self) => { P.programs++; ctxOf(self).programs++; });
      wrap("deleteProgram", (self, a) => { if (a[0]) { P.programs--; ctxOf(self).programs--; } });
      wrap("bufferData", (self, a) => {
        const b = bufs.get(self) as object | undefined;
        if (!b) return;
        const n = typeof a[1] === "number" ? a[1] : ((a[1] as ArrayBufferView | null)?.byteLength ?? 0);
        P.bufferBytes += n - (sizes.get(b) ?? 0);
        sizes.set(b, n);
      });
      let inFrame = false;
      const draw = (self: object, tris: number) => {
        P.draws++;
        P.tris += tris;
        if (!fbs.get(self)) {
          P.screenDraws++;
          if (!inFrame) {
            inFrame = true;
            P.frames++;
            void Promise.resolve().then(() => (inFrame = false));
          }
        }
      };
      const TRI = 4;
      wrap("drawElements", (self, a) => draw(self, a[0] === TRI ? (a[1] as number) / 3 : 0));
      wrap("drawArrays", (self, a) => draw(self, a[0] === TRI ? (a[2] as number) / 3 : 0));
      wrap("drawElementsInstanced", (self, a) => draw(self, a[0] === TRI ? ((a[1] as number) / 3) * (a[4] as number) : 0));
      wrap("drawArraysInstanced", (self, a) => draw(self, a[0] === TRI ? ((a[2] as number) / 3) * (a[3] as number) : 0));
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
  await page.locator(".map3d canvas").first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(8000);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  return page;
}

const read = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __perf: Probe }).__perf }));

async function cpu(page: Page) {
  const s = await page.context().newCDPSession(page);
  await s.send("Performance.enable");
  return async () => {
    const { metrics } = await s.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    return { script: m.ScriptDuration * 1000, task: m.TaskDuration * 1000, heapMB: m.JSHeapUsedSize / 1e6, nodes: m.Nodes };
  };
}

/** Frames drawn back to back (the camera zooming), so every frame is a full frame. */
async function measure(page: Page) {
  const c = await cpu(page);
  await page.mouse.move(page.viewportSize()!.width / 2, page.viewportSize()!.height / 2);
  const a = await read(page), ca = await c();
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, i % 2 ? 30 : -30);
    await page.clock.runFor(100);
  }
  const b = await read(page), cb = await c();
  const f = Math.max(1, b.frames - a.frames);
  return {
    frames: b.frames - a.frames,
    drawsPerFrame: Math.round((b.draws - a.draws) / f),
    offscreenDrawsPerFrame: Math.round((b.draws - a.draws - (b.screenDraws - a.screenDraws)) / f),
    trianglesPerFrame: Math.round((b.tris - a.tris) / f),
    cpuMsPerFrame: +((cb.task - ca.task) / f).toFixed(1),
    programs: b.programs,
    textures: b.liveTextures,
    buffers: b.liveBuffers,
    geometryMB: +(b.bufferBytes / 1e6).toFixed(1),
    heapMB: +cb.heapMB.toFixed(1),
  };
}

const contexts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ctx: { gl: WebGLRenderingContext; buffers: number; textures: number; programs: number }[] }).__ctx.map((c) => ({ alive: !c.gl.isContextLost(), buffers: c.buffers, textures: c.textures, programs: c.programs })));

/**
 * Leave the map for another view and come back, three times. Old WebGL contexts still alive
 * afterwards are a leak; so is the current context holding more than the first one did.
 */
async function leak(page: Page) {
  const before = (await contexts(page)).filter((c) => c.alive);
  const drawsBefore = (await read(page)).draws;
  for (let i = 0; i < 3; i++) {
    await page.locator(".nav-item").nth(1).click();
    await page.clock.runFor(500);
    await page.locator(".nav-item").first().click();
    await page.locator(".map3d canvas").first().waitFor();
    for (let j = 0; j < 4; j++) {
      await page.waitForTimeout(1500);
      await page.clock.runFor(500);
    }
  }
  if ((await read(page)).draws === drawsBefore) throw new Error("The map didn't draw again after coming back to it.");
  const after = await contexts(page);
  const alive = after.filter((c) => c.alive);
  const first = before[before.length - 1], last = after[after.length - 1];
  return { contextsCreated: after.length, contextsAlive: alive.length, extraBuffers: last.buffers - first.buffers, extraTextures: last.textures - first.textures, extraPrograms: last.programs - first.programs };
}

test.describe("perf", () => {
  test.skip(!PERF, "Set PERF=1 to measure.");

  test("map frame cost", async ({ browser, baseURL }) => {
    test.setTimeout(1_500_000);
    const runs = [
      { name: "desktop day", vp: { width: 1280, height: 800 }, storage: { mapLight: "day" } },
      { name: "desktop night", vp: { width: 1280, height: 800 }, storage: { mapLight: "night" } },
      { name: "desktop saver", vp: { width: 1280, height: 800 }, storage: { mapLight: "day", powerMode: "saver" } },
      { name: "iphone day", vp: { width: 390, height: 844 }, storage: { mapLight: "day" } },
    ];
    const only = process.env.PERF_ONLY;
    const out: Record<string, unknown> = {};
    for (const r of runs) {
      if (only && !r.name.includes(only)) continue;
      const page = await open(browser, baseURL!, r.vp, r.storage);
      const m = await measure(page);
      const l = r.name === "desktop day" && process.env.PERF_LEAK !== "0" ? await leak(page) : {};
      out[r.name] = { ...m, ...l };
      console.log(`PERF ${JSON.stringify({ run: r.name, ...m, ...l })}`);
      await page.context().close();
    }
    if (process.env.PERF_BUDGET) {
      const d = out["desktop day"] as ReturnType<typeof measure> extends Promise<infer T> ? T & { contextsAlive: number } : never;
      if (!d) return;
      const over = (Object.keys(BUDGET) as (keyof typeof BUDGET)[]).filter((k) => (d[k] as number) > BUDGET[k]);
      if (over.length) throw new Error(`Map is over its performance budget: ${over.map((k) => `${k} ${d[k]} > ${BUDGET[k]}`).join(", ")}`);
    }
  });
});
