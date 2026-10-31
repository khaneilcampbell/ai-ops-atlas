import { test, expect, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { openAtlas, settle, waitForScene } from "./atlas";

/** Airport takeoff stages and airline liveries (KC, 2026-10-31). Not a baseline check: it writes
 * close-up screenshots to SHOT_DIR for before/after comparison. Reduced motion keeps the airport
 * clock still, so each shot sets that clock directly and lets one frame place the aircraft. */
const out = process.env.SHOT_DIR ?? "artifacts/planes";

/** Simulation seconds at which departure slot 0 is at the given stage (same mapping before and after). */
const atDeparture = (departureSeconds: number) => 51 + departureSeconds / 1.15 - 45;
const SHOTS: { name: string; clock: number; offset: [number, number, number]; look?: [number, number, number] }[] = [
  { name: "1-roll", clock: atDeparture(7), offset: [4.2, 1.6, 2.4] },
  { name: "2-rotation", clock: atDeparture(9.9), offset: [4.2, 1.4, 1.2] },
  { name: "3-climb", clock: atDeparture(14), offset: [6, 1.2, 3] },
  { name: "4-turn", clock: atDeparture(23), offset: [-6, 2.5, 7] },
];

/** Finds the airport's clock and the departure aircraft through React Three Fiber's tree, sets the clock,
 * draws a frame, then renders each camera view. */
async function shoot(page: Page, clock: number, views: { name: string; offset: [number, number, number]; look?: [number, number, number]; target: "slot0" | "gates" }[]) {
  await page.evaluate(
    async ({ clock, views }) => {
      const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
      const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
      if (!url) throw new Error("Fiber import not found");
      const fiber: typeof import("@react-three/fiber") = await import(url);
      const canvas = document.querySelector("canvas")!;
      const root = fiber._roots.get(canvas);
      const state = root?.store.getState();
      if (!root || !state) throw new Error("Map renderer not found");
      type F = { type?: { name?: string }; memoizedProps?: Record<string, unknown>; memoizedState?: { memoizedState?: unknown; next?: unknown }; child?: F; sibling?: F };
      const found: F[] = [];
      const walk = (f?: F) => { while (f) { if (f.type?.name === "Airport" || f.type?.name === "Aircraft") found.push(f); walk(f.child); f = f.sibling; } };
      walk((root as unknown as { fiber: { current: F } }).fiber.current);
      const airport = found.find((f) => f.type?.name === "Airport");
      if (!airport) throw new Error("Airport not found");
      (airport.memoizedState!.memoizedState as { current: number }).current = clock;
      const groupOf = (f: F) => (f.memoizedState!.memoizedState as { current: import("three").Group }).current;
      const flying = found.filter((f) => f.type?.name === "Aircraft" && !f.memoizedProps?.parked && f.memoizedProps?.slot === 0);
      const parked = found.filter((f) => f.type?.name === "Aircraft" && f.memoizedProps?.parked);
      if (views.length < 0) return null;
      (window as unknown as { __planes: () => unknown }).__planes = () => ( { flying: flying.length, parked: parked.length, groups: [groupOf(flying[0]), ...parked.map(groupOf)].map((g) => { const v = g.getWorldPosition(new (g.position.constructor as typeof import("three").Vector3)()); return [v.x, v.y, v.z]; }) });
      return null;
    },
    { clock, views },
  );
  // Let the frame loop pose every aircraft from the new clock, then read where they are.
  await page.clock.runFor(50);
  return page.evaluate(() => (window as unknown as { __planes: () => { flying: number; parked: number; groups: number[][] } }).__planes());
}

async function render(page: Page, list: { name: string; eye: number[]; target: number[] }[]) {
  return page.evaluate(async (list) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1]!;
    const fiber: typeof import("@react-three/fiber") = await import(url);
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

for (const light of ["day", "night"] as const) test(`airport takeoff and liveries, ${light}`, async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(out, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openAtlas(page, { light });
  await waitForScene(page);
  await settle(page, 2);
  for (const shot of SHOTS) {
    const at = await shoot(page, shot.clock, []);
    const [x, y, z] = at.groups[0];
    save(await render(page, [{ name: shot.name, eye: [x + shot.offset[0], y + shot.offset[1], z + shot.offset[2]], target: [x, y + 0.3, z] }]), `-${light}`);
  }
  // Queue and parked jets with their liveries, before any departure.
  const at = await shoot(page, atDeparture(-3), []);
    const [qx, qy, qz] = at.groups[0];
  save(await render(page, [
    { name: "5-fleet-east", eye: [qx + 9, qy + 6, qz - 5], target: [qx, qy + 0.3, qz - 5] },
    { name: "5-fleet-west", eye: [qx - 9, qy + 6, qz - 5], target: [qx, qy + 0.3, qz - 5] },
    { name: "6-queue", eye: [qx + 3, qy + 2.2, qz - 6], target: [qx - 1.5, qy + 0.3, qz + 2] },
  ]), `-${light}`);
  expect(errors).toEqual([]);
});

test("airport on a phone", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  await settle(page, 2);
  const at = await shoot(page, atDeparture(9.9), []);
  const [x, y, z] = at.groups[0];
  save(await render(page, [{ name: "phone-rotation", eye: [x + 7, y + 4, z + 7], target: [x, y + 0.5, z - 1] }]));
});
