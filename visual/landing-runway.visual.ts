import { test, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { openAtlas, settle, waitForScene } from "./atlas";

/** Landing runway and arrivals (Khaneil, 2026-11-07). Writes screenshots to SHOT_DIR; no baseline compare.
 * Reduced motion keeps the airport clock still, so each shot sets that clock (the Airport component's first
 * ref) to the moment slot 0 reaches a stage of its landing, lets the frame loop pose the jets, then renders
 * cameras given relative to that jet, in airport-local coordinates (mirror applied for west airports). */
const out = process.env.SHOT_DIR ?? "artifacts/landing-runway";
type Stage = "final" | "flare" | "rollout" | "stand" | "pushback";
type Shot = { name: string; stage: Stage; eye: [number, number, number]; target?: [number, number, number] };
const SHOTS: Shot[] = [
  { name: "final", stage: "final", eye: [-5, 2.5, 7] },
  { name: "flare", stage: "flare", eye: [-4.5, 1.2, -3] },
  { name: "rollout", stage: "rollout", eye: [-6, 3, 5] },
  { name: "stand", stage: "stand", eye: [6, 5, 6] },
  { name: "pushback", stage: "pushback", eye: [5, 5, 7] },
];

async function shoot(page: Page, shots: Shot[]) {
  return page.evaluate(async (shots) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Fiber import not found");
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const schedule = await import("/src/views/map3d/flightSchedule.ts" as string);
    const arrivals = await import("/src/views/map3d/airportArrivals.ts" as string);
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
    const plan = props.plan;
    const circuit = clearance.airportFlightCircuit(plan, props.bounds, props.flightAltitude, props.obstacles);
    const timing = schedule.loopTiming(circuit), legs = arrivals.arrivalLegs(timing.approach), f = schedule.FLIGHT_SCHEDULE;
    const afterLeave: Record<Stage, number> = {
      final: legs.approach + legs.final * 0.35,
      flare: legs.approach + legs.final - 0.4,
      rollout: legs.approach + legs.final + 6,
      stand: legs.approach + legs.final + legs.rollout + 5,
      pushback: legs.approach + legs.final + legs.rollout + timing.dwell + legs.push * 0.6,
    };
    const world = ([x, y, z]: number[]) => [plan.x + (plan.west ? 8 - x : x), 0.66 + y, plan.z + z] as const;
    const clock = airport.memoizedState!.memoizedState as { current: number };
    const list: { name: string; png: string }[] = [];
    for (const s of shots) {
      clock.current = timing.leave + afterLeave[s.stage] - f.start;
      const pose = schedule.fleetPose(clock.current, 0, circuit);
      // One frame so every Aircraft picks up the new clock.
      state.advance(performance.now());
      const eye = [pose.x + s.eye[0], pose.y + s.eye[1], pose.z + s.eye[2]], target = s.target ?? [pose.x, pose.y + 0.3, pose.z];
      state.camera.position.set(...world(eye));
      state.camera.lookAt(...world(target));
      state.camera.updateMatrixWorld();
      state.gl.shadowMap.needsUpdate = true;
      state.gl.render(state.scene, state.camera);
      list.push({ name: s.name, png: canvas.toDataURL("image/png") });
    }
    return list;
  }, shots);
}
const save = (list: { name: string; png: string }[], suffix: string) => { for (const s of list) writeFileSync(`${out}/${s.name}${suffix}.png`, Buffer.from(s.png.split(",")[1], "base64")); };

for (const light of ["day", "night"] as const) test(`landing runway, ${light}`, async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(out, { recursive: true });
  await openAtlas(page, { light });
  await waitForScene(page);
  await settle(page, 2);
  save(await shoot(page, SHOTS), `-${light}`);
});
