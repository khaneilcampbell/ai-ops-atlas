import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { openAtlas, settle, waitForScene } from "./atlas";

/**
 * Gold private jet screenshots (Khaneil, 2026-11-13). Written only when SHOT_DIR is set; no baseline compare.
 * Reduced motion holds the airport clock still, so each shot sets that clock (the Airport component's first ref) to a
 * moment in the gold jet's loop, lets one frame pose the jets, then renders cameras placed relative to the jet in
 * airport-local coordinates. Then it selects the jet from the airport panel, enters it and shoots the cabin.
 */
const out = process.env.SHOT_DIR;
type Stage = "boarding" | "flight" | "taxi";
type Shot = { name: string; stage: Stage; eye: [number, number, number]; target?: [number, number, number] };
const SHOTS: Shot[] = [
  { name: "gate", stage: "boarding", eye: [3.2, 2.6, 4.2] },
  { name: "gate-wide", stage: "boarding", eye: [7, 6, 9] },
  { name: "taxi", stage: "taxi", eye: [-3.5, 1.6, -4] },
  { name: "flight", stage: "flight", eye: [-4, 1.5, 4] },
];

/** Sets the airport clock to `stage` and returns its seconds, or renders the shots when `shots` is given. */
async function shoot(page: Page, shots: Shot[], phone: boolean) {
  return page.evaluate(async ({ shots, phone }) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Fiber import not found");
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const schedule = await import("/src/views/map3d/flightSchedule.ts" as string);
    const arrivals = await import("/src/views/map3d/airportArrivals.ts" as string);
    const clearance = await import("/src/views/map3d/flightClearance.ts" as string);
    const jet = await import("/src/views/map3d/goldJetPlan.ts" as string);
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
    const timing = schedule.loopTiming(circuit), legs = arrivals.arrivalLegs(timing.approach), f = schedule.FLIGHT_SCHEDULE;
    const phase: Record<Stage, number> = {
      boarding: timing.leave + legs.approach + legs.final + legs.rollout + timing.dwell * 0.78,
      taxi: f.taxi * 0.5,
      flight: timing.leave * 0.55,
    };
    const toClock = (p: number) => p - f.start + jet.GOLD_JET_SLOT * f.interval;
    const world = ([x, y, z]: number[]) => [plan.x + (plan.west ? 8 - x : x), 0.66 + y, plan.z + z] as const;
    const clock = airport.memoizedState!.memoizedState as { current: number };
    const list: { name: string; png: string }[] = [];
    const k = phone ? 1.6 : 1;
    for (const s of shots) {
      clock.current = toClock(phase[s.stage]);
      state.advance(performance.now());
      const pose = schedule.fleetPose(clock.current, jet.GOLD_JET_SLOT, circuit);
      const eye = [pose.x + s.eye[0] * k, pose.y + s.eye[1] * k, pose.z + s.eye[2] * k], target = s.target ?? [pose.x, pose.y + 0.3, pose.z];
      state.camera.position.set(...world(eye));
      state.camera.lookAt(...world(target));
      state.camera.updateMatrixWorld();
      state.gl.shadowMap.needsUpdate = true;
      state.gl.render(state.scene, state.camera);
      list.push({ name: s.name, png: canvas.toDataURL("image/png") });
    }
    // Leave the clock in flight, so the cabin opens with everyone on board and the jet over the city.
    clock.current = toClock(phase.flight);
    state.advance(performance.now());
    return list;
  }, { shots, phone });
}

for (const width of [1512, 390]) for (const light of ["day", "night"] as const) test(`gold jet ${width} ${light}`, async ({ page }) => {
  test.skip(!out, "Set SHOT_DIR to write the gold jet screenshots");
  test.setTimeout(600_000);
  mkdirSync(out!, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await openAtlas(page, { light });
  await waitForScene(page);
  await settle(page, 2);
  const tag = width === 390 ? "phone" : "desktop";
  for (const s of await shoot(page, SHOTS, width === 390)) writeFileSync(`${out}/${tag}-${s.name}-${light}.png`, Buffer.from(s.png.split(",")[1], "base64"));
  const plaque = page.locator('.m3-plaque[title^="Atlas Airport"]');
  await plaque.first().dispatchEvent("click");
  await settle(page, 3);
  await page.getByRole("button", { name: /Atlas Gold Jet/ }).first().click();
  await settle(page, 3);
  await page.screenshot({ path: `${out}/${tag}-panel-${light}.png` });
  await page.getByRole("button", { name: "Enter aircraft" }).first().click();
  await page.locator(".gold-jet-interior").waitFor();
  await settle(page, 8);
  await page.screenshot({ path: `${out}/${tag}-interior-${light}.png` });
  await page.getByRole("button", { name: "Window seat view" }).click();
  await settle(page, 4);
  await page.screenshot({ path: `${out}/${tag}-window-${light}.png` });
  expect(errors).toEqual([]);
});
