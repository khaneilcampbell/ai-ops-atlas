import { test, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { openAtlas, settle, waitForScene } from "./atlas";

/** Atlas Airport redesign views (KC, 2026-10-31). Writes screenshots to SHOT_DIR; no baseline compare.
 * Cameras are given in airport-local coordinates (x across, z along the runway) and mapped to the world,
 * including the west-facing mirror, by reading the airport plan from the Airport component's props. */
const out = process.env.SHOT_DIR ?? "artifacts/airport";
type View = { name: string; eye: [number, number, number]; target: [number, number, number] };
const VIEWS: View[] = [
  { name: "overview", eye: [-14, 22, 34], target: [8, 0, 6] },
  { name: "terminal", eye: [-9, 7, 16], target: [3, 1, 6] },
  { name: "airside", eye: [14, 6, 12], target: [4, 1, 6] },
  { name: "tower", eye: [-5, 6, -9], target: [1.5, 3, -3] },
  { name: "top", eye: [8, 40, 6.5], target: [8, 0, 6] },
];

async function shots(page: Page, views: View[]) {
  return page.evaluate(async (views) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Fiber import not found");
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const canvas = document.querySelector("canvas")!;
    const root = fiber._roots.get(canvas)!;
    const state = root.store.getState();
    type F = { type?: { name?: string }; memoizedProps?: Record<string, unknown>; child?: F; sibling?: F };
    let plan: { x: number; z: number; west?: boolean } | undefined;
    const walk = (f?: F) => { while (f && !plan) { if (f.type?.name === "Airport") plan = f.memoizedProps?.plan as typeof plan; walk(f.child); f = f.sibling; } };
    walk((root as unknown as { fiber: { current: F } }).fiber.current);
    if (!plan) throw new Error("Airport not found");
    const world = ([x, y, z]: number[]) => [plan!.x + (plan!.west ? 8 - x : x), 0.6 + y, plan!.z + z] as const;
    const list: { name: string; png: string }[] = [];
    for (const v of views) {
      state.camera.position.set(...world(v.eye));
      state.camera.lookAt(...world(v.target));
      state.camera.updateMatrixWorld();
      state.gl.shadowMap.needsUpdate = true;
      state.gl.render(state.scene, state.camera);
      list.push({ name: v.name, png: canvas.toDataURL("image/png") });
    }
    return list;
  }, views);
}
const save = (list: { name: string; png: string }[], suffix: string) => { for (const s of list) writeFileSync(`${out}/${s.name}${suffix}.png`, Buffer.from(s.png.split(",")[1], "base64")); };

for (const light of ["day", "night"] as const) test(`airport, ${light}`, async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(out, { recursive: true });
  await openAtlas(page, { light });
  await waitForScene(page);
  await settle(page, 2);
  save(await shots(page, VIEWS), `-${light}`);
});

test("airport on a phone", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  await settle(page, 2);
  save(await shots(page, [{ name: "phone", eye: [-12, 26, 30], target: [6, 0, 5] }]), "");
});
