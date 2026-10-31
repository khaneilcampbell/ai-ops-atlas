import { test, expect, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { openAtlas, settle, waitForScene } from "./atlas";

/** Airport ground crew (KC, 2026-10-31). Not a baseline check: it writes close-ups of the apron to
 * SHOT_DIR for before/after comparison. Works on builds without the crew too (same cameras).
 * Reduced motion keeps the airport clock still, so the script sets that clock and lets frames run. */
const out = process.env.SHOT_DIR ?? "artifacts/ground-crew";

/** Sets the airport clock, then returns where the served-gate jets and the front of the queue are. */
async function locate(page: Page, clock: number) {
  await page.evaluate(async (clock) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Fiber import not found");
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const root = fiber._roots.get(document.querySelector("canvas")!);
    type F = { type?: { name?: string }; memoizedProps?: Record<string, unknown>; memoizedState?: { memoizedState?: unknown }; child?: F; sibling?: F };
    const found: F[] = [];
    const walk = (f?: F) => { while (f) { if (f.type?.name === "Airport" || f.type?.name === "Aircraft") found.push(f); walk(f.child); f = f.sibling; } };
    walk((root as unknown as { fiber: { current: F } }).fiber.current);
    const airport = found.find((f) => f.type?.name === "Airport");
    if (!airport) throw new Error("Airport not found");
    (airport.memoizedState!.memoizedState as { current: number }).current = clock;
    const group = (f: F) => (f.memoizedState!.memoizedState as { current: import("three").Group }).current;
    const parked = found.filter((f) => f.type?.name === "Aircraft" && f.memoizedProps?.parked);
    // West-facing airports are drawn mirrored, so the runway side is -x in world space.
    const east = (airport.memoizedProps?.plan as { west?: boolean } | undefined)?.west ? -1 : 1;
    (window as unknown as { __crew: () => number[][] }).__crew = () => [...[parked[2], parked[3]].map((f) => { const g = group(f); const v = g.getWorldPosition(new (g.position.constructor as typeof import("three").Vector3)()); return [v.x, v.y, v.z]; }), [east]];
  }, clock);
  await page.clock.runFor(50);
  return page.evaluate(() => (window as unknown as { __crew: () => number[][] }).__crew());
}

async function render(page: Page, list: { name: string; eye: number[]; target: number[] }[]) {
  return page.evaluate(async (list) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    const fiber: typeof import("@react-three/fiber") = await import(url!);
    const canvas = document.querySelector("canvas")!;
    const state = fiber._roots.get(canvas)!.store.getState();
    const shots: { name: string; png: string }[] = [];
    for (const v of list) {
      state.camera.position.set(v.eye[0], v.eye[1], v.eye[2]);
      state.camera.lookAt(v.target[0], v.target[1], v.target[2]);
      state.camera.updateMatrixWorld();
      state.gl.shadowMap.needsUpdate = true;
      state.gl.render(state.scene, state.camera);
      shots.push({ name: v.name, png: canvas.toDataURL("image/png") });
    }
    return shots;
  }, list);
}
const save = (shots: { name: string; png: string }[], suffix = "") => { for (const s of shots) writeFileSync(`${out}/${s.name}${suffix}.png`, Buffer.from(s.png.split(",")[1], "base64")); };

/** Camera views around the apron. `east` is +1 when the runway is east of the gates in world space. */
function views(gate0: number[], gate3: number[], [east]: number[]) {
  const y = gate0[1];
  // Front of the takeoff queue: taxiway 4.5 east of the gates, a jet length past gate 3.
  const queue = [gate0[0] + east * 4.5, y, gate3[2] + 1];
  const mid = [(gate0[0] + gate3[0]) / 2, y, (gate0[2] + gate3[2]) / 2];
  return [
    { name: "gate", eye: [gate0[0] + east * 3.2, y + 1.6, gate0[2] - 2.6], target: [gate0[0] + east * .6, y + .1, gate0[2] + .2] },
    { name: "baggage", eye: [gate3[0] + east * 3, y + 1.4, gate3[2] + 3.2], target: [gate3[0] + east * .7, y + .1, gate3[2] + .9] },
    { name: "apron", eye: [mid[0] - east * 4, y + 11, mid[2] - 13], target: [mid[0] + east * 1.5, y, mid[2] + 1] },
    { name: "marshaller", eye: [queue[0] - east * 3.5, y + 1.3, queue[2] + 4.5], target: [queue[0] - east * 1.6, y + .2, queue[2] + 1.5] },
    { name: "cargo", eye: [gate3[0] - east * 1, y + 2.2, gate3[2] + 8], target: [gate3[0] - east * 2, y, gate3[2] + 4.5] },
  ];
}

for (const light of ["day", "night"] as const) test(`airport ground crew, ${light}`, async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(out, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openAtlas(page, { light });
  await waitForScene(page);
  await settle(page, 2);
  // A moment with a train parked at gate 0 and one driving at gate 3.
  const [g0, g3, q] = await locate(page, 30);
  save(await render(page, views(g0, g3, q)), `-${light}`);
  expect(errors).toEqual([]);
});

test("airport ground crew on a phone", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  await settle(page, 2);
  const [g0, g3, q] = await locate(page, 30);
  save(await render(page, views(g0, g3, q).filter((v) => v.name === "apron").map((v) => ({ ...v, name: "phone-apron" }))));
});
