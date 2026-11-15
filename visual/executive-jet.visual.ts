import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { openAtlas, settle, waitForScene } from "./atlas";

/**
 * Executive jet screenshots (Khaneil, 2026-11-15: wheels + design upgrade, then cockpit lights, headlights, gear in and out). Written only when SHOT_DIR is set; no
 * baseline compare. Like gold-jet.visual.ts, it sets the airport clock to a moment in the executive jet's loop (at its
 * stand, taxiing, climbing out, on final) and renders a camera placed beside the jet in airport-local coordinates.
 */
const out = process.env.SHOT_DIR;
type Stage = "stand" | "taxi" | "climb" | "land";
const SHOTS: { name: string; stage: Stage; eye: [number, number, number] }[] = [
  { name: "stand", stage: "stand", eye: [2.2, 1.0, 2.6] },
  { name: "stand-low", stage: "stand", eye: [-1.6, 0.35, -2.2] },
  { name: "taxi", stage: "taxi", eye: [-2.4, 1.1, 2.4] },
  { name: "climb", stage: "climb", eye: [-2.6, 0.6, 2.6] },
  { name: "land", stage: "land", eye: [-2.2, -0.2, -2.6] },
];

async function shoot(page: Page, phone: boolean) {
  return page.evaluate(async ({ shots, phone }) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Fiber import not found");
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const schedule = await import("/src/views/map3d/flightSchedule.ts" as string);
    const clearance = await import("/src/views/map3d/flightClearance.ts" as string);
    const canvas = document.querySelector("canvas")!;
    const root = fiber._roots.get(canvas)!;
    const state = root.store.getState();
    type F = { type?: { name?: string }; memoizedProps?: Record<string, unknown>; memoizedState?: { memoizedState?: unknown }; child?: F; sibling?: F };
    let airport: F | undefined;
    const walk = (f?: F) => { while (f && !airport) { if (f.type?.name === "Airport") airport = f; walk(f.child); f = f.sibling; } };
    walk((root as unknown as { fiber: { current: F } }).fiber.current);
    if (!airport) throw new Error("Airport not found");
    const props = airport.memoizedProps as { plan: { x: number; z: number; west?: boolean }; bounds: unknown; flightAltitude?: number; obstacles?: unknown[] };
    const plan = props.plan, circuit = clearance.airportFlightCircuit(plan, props.bounds, props.flightAltitude, props.obstacles);
    const f = schedule.FLIGHT_SCHEDULE, base = schedule.SHARED_SLOT * f.interval - f.start;
    const pose = (t: number) => schedule.executiveJetPose(t, circuit);
    // Find the moments: parked (not moving for 10 s), taxiing (moving on the ground), climbing (gear partly up).
    const at: Partial<Record<Stage, number>> = {};
    for (let t = base; t < base + 2 * f.cycle && !(at.stand && at.taxi && at.climb && at.land); t += 0.5) {
      const a = pose(t), b = pose(t + 10), moving = Math.hypot(a.x - b.x, a.z - b.z) > 0.5;
      if (!at.stand && a.y === 0 && !moving) at.stand = t;
      if (!at.taxi && a.y === 0 && moving && Math.hypot(a.x - pose(t + 1).x, a.z - pose(t + 1).z) > 0.3) at.taxi = t;
      if (!at.climb && a.y > 0.4 && a.gear > 0.3 && a.gear < 0.9) at.climb = t;
      // Final approach: back down low with the gear lowered again, well after the climb.
      if (at.climb && !at.land && t > at.climb + 30 && a.y > 0.3 && a.y < 1.2 && a.gear > 0.98) at.land = t;
    }
    const world = ([x, y, z]: number[]) => [plan.x + (plan.west ? 8 - x : x), 0.66 + y, plan.z + z] as const;
    const clock = airport.memoizedState!.memoizedState as { current: number };
    const list: { name: string; png: string }[] = [];
    const k = phone ? 1.6 : 1;
    for (const s of shots) {
      const t = at[s.stage];
      if (t === undefined) throw new Error(`No ${s.stage} moment`);
      clock.current = t;
      state.advance(performance.now());
      const p = pose(t), c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      // Camera offset turns with the jet, so each shot frames the same side of it.
      const ex = s.eye[0] * c + s.eye[2] * sn, ez = -s.eye[0] * sn + s.eye[2] * c;
      state.camera.position.set(...world([p.x + ex * k, p.y + s.eye[1] * k, p.z + ez * k]));
      state.camera.lookAt(...world([p.x, p.y + 0.2, p.z]));
      state.camera.updateMatrixWorld();
      state.gl.shadowMap.needsUpdate = true;
      state.gl.render(state.scene, state.camera);
      list.push({ name: s.name, png: canvas.toDataURL("image/png") });
    }
    return list;
  }, { shots: SHOTS, phone });
}

for (const width of [1512, 390]) for (const light of ["day", "night"] as const) test(`executive jet ${width} ${light}`, async ({ page }) => {
  test.skip(!out, "Set SHOT_DIR to write the executive jet screenshots");
  test.setTimeout(600_000);
  mkdirSync(out!, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await openAtlas(page, { light });
  await waitForScene(page);
  await settle(page, 2);
  const tag = width === 390 ? "phone" : "desktop";
  for (const s of await shoot(page, width === 390)) writeFileSync(`${out}/${tag}-${s.name}-${light}.png`, Buffer.from(s.png.split(",")[1], "base64"));
  expect(errors).toEqual([]);
});
