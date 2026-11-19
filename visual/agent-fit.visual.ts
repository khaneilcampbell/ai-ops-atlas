import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// Do the named agents fit the places they use (agentBody.ts)? Close-ups of each step of a ride or a
// working visit, drawn by the real pipeline (routine segments -> routinePose -> NamedAgents). Each
// step is a segment the app itself planned, moved in time so it is happening now: nothing is posed
// by hand. Review shots, not baselines:
// FIT_SHOTS=<dir> npx playwright test -c visual/local-chromium.config.ts visual/agent-fit.visual.ts
const out = process.env.FIT_SHOTS ?? "";
test.skip(!out, "Set FIT_SHOTS to a folder to take these review shots");
// The wheel and the yacht move, as they do for most people (reduced motion holds the wheel still).
test.use({ reducedMotion: "no-preference" });
const SCHEDULED = Date.parse("2026-10-28T11:20:00Z"); // Priya Raman's Data Inventory, 7:20 New York
const OFFICE = "project:ai-ops-atlas", PRIYA = "atlas-health-monitor";
const iso = (t: number) => new Date(t).toISOString();

type View = "side" | "high" | "office" | "door";
/** One step: which kind of segment, the moment within it (share of its length, or ms past its end), and the camera. */
type Step = { name: string; kind: "wheel" | "train" | "yacht" | "inside" | "office"; phase?: string; share?: number; after?: number; before?: number; view: View; d: number; id?: string };

const RIDES: Step[] = [
  { name: "wheel-1-queue", kind: "wheel", before: 2500, view: "side", d: 1.8 },
  { name: "wheel-2-boarded", kind: "wheel", share: 0.004, view: "side", d: 1.5 },
  { name: "wheel-3-riding", kind: "wheel", share: 0.3, view: "side", d: 1.5 },
  { name: "wheel-4-off", kind: "wheel", after: 1500, view: "side", d: 1.8 },
  { name: "train-1-platform", kind: "train", before: 2500, view: "side", d: 1.4 },
  { name: "train-2-aboard", kind: "train", share: 0.4, view: "high", d: 3 },
  { name: "train-3-off", kind: "train", after: 1000, view: "side", d: 1.4 },
  { name: "yacht-1-gangway", kind: "yacht", before: 2500, view: "high", d: 2 },
  { name: "yacht-2-aboard", kind: "yacht", share: 0.02, view: "high", d: 2.2 },
  { name: "yacht-3-sailing", kind: "yacht", share: 0.5, view: "high", d: 2.4 },
  { name: "yacht-4-off", kind: "yacht", after: 3000, view: "high", d: 2 },
];
const OFFICE_STEPS: Step[] = [
  { name: "office-1-entering", kind: "inside", phase: "entering", share: 0.5, view: "office", d: 1.6, id: PRIYA },
  { name: "office-2-to-desk", kind: "inside", phase: "to_desk", share: 0.85, view: "office", d: 1.6, id: PRIYA },
  { name: "office-3-working", kind: "inside", phase: "working", share: 0.5, view: "office", d: 1.2, id: PRIYA },
  { name: "office-4-leaving", kind: "inside", phase: "leaving", share: 0.12, view: "office", d: 1.6, id: PRIYA },
];

/**
 * Finds a planned segment of this kind (any agent, or `step.id`), takes it with the segments either
 * side, shifts them so the step's moment is now, and draws that agent from them (routineOverride). Returns the agent.
 */
async function stage(page: Page, step: Step): Promise<string | null> {
  return page.evaluate(async (step) => {
    type Seg = { kind: string; phase: string | null; t0: number; t1: number; option?: { kind: string }; times?: { board: number; alight: number } };
    type R = { personaId: string; segments: Seg[]; validUntil: number };
    const ops = (await import("/src/routine/useRoutineOps.ts" as string)) as { routinesSnapshot(): ReadonlyMap<string, R>; routineOverride: Map<string, R> };
    const plans = ops.routinesSnapshot();
    ops.routineOverride.clear();
    const now = Date.now();
    for (const [id, r] of plans) {
      if (step.id && id !== step.id) continue;
      const i = r.segments.findIndex((s) => (step.kind === "inside" ? s.kind === "inside" && s.phase === step.phase : step.kind === "office" ? s.kind === "stay" && s.option?.kind === "office" : s.kind === "ride" && s.option?.kind === step.kind));
      if (i < 0) continue;
      const s = r.segments[i];
      const anchor = step.before !== undefined ? s.t0 - step.before : step.after !== undefined ? s.t1 + step.after : s.t0 + (s.t1 - s.t0) * (step.share ?? 0.5);
      const d = now + 400 - anchor;
      const shift = (x: Seg): Seg => ({ ...x, t0: x.t0 + d, t1: x.t1 + d, ...(x.times ? { times: { ...x.times, board: x.times.board + d, alight: x.times.alight + d } } : {}) });
      const segs = r.segments.slice(Math.max(0, i - 1), i + 2).map(shift);
      ops.routineOverride.set(id, { ...r, segments: segs, validUntil: now + 3600_000 });
      return id;
    }
    return null;
  }, step);
}

async function closeUp(page: Page, id: string, step: Step) {
  return page.evaluate(
    async ({ id, step }) => {
      const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
      const fiber: typeof import("@react-three/fiber") = await import(source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1]);
      const canvas = document.querySelector("canvas")!, state = fiber._roots.get(canvas)!.store.getState();
      const badges = state.scene.getObjectByName("named-agent-badges") as import("three").InstancedMesh;
      const all = (badges.userData.routine ?? []) as { id: string; at: { x: number; y: number; z: number } | null; seg: { activity: string; note: string; phase: string | null } | null; place: string }[];
      const me = all.find((a) => a.id === id);
      const label = `${me?.seg?.phase ?? me?.seg?.activity} · ${me?.seg?.note} · ${me?.place}`;
      if (!me?.at) return { png: null, label: `${label} (badge only)` };
      const cam = state.camera as import("three").PerspectiveCamera, keep = { near: cam.near, pos: cam.position.clone(), q: cam.quaternion.clone() };
      cam.near = 0.02;
      cam.updateProjectionMatrix();
      const { x, y, z } = me.at, d = step.d;
      if (step.view === "side") cam.position.set(x + d * 0.15, y + d * 0.25, z + d);
      else if (step.view === "office") cam.position.set(x + d * 0.45, y + d * 0.9, z + d * 0.75);
      else if (step.view === "door") cam.position.set(x + d * 0.35, y + d * 0.3, z + d);
      else cam.position.set(x + d * 0.35, y + d * 1.1, z + d * 0.8);
      if (step.view === "door") cam.lookAt(x, y + 0.2, z - 0.35);
      else cam.lookAt(x, y + 0.15, z);
      cam.updateMatrixWorld();
      state.gl.shadowMap.needsUpdate = true;
      state.gl.render(state.scene, cam);
      const png = canvas.toDataURL("image/png");
      cam.near = keep.near;
      cam.position.copy(keep.pos);
      cam.quaternion.copy(keep.q);
      cam.updateProjectionMatrix();
      return { png, label };
    },
    { id, step },
  );
}

async function shoot(page: Page, steps: Step[]) {
  for (const step of steps) {
    const id = await stage(page, step);
    if (!id) {
      console.log(`${step.name}: nothing planned of this kind`);
      continue;
    }
    await settle(page, 2);
    const r = await closeUp(page, id, step);
    console.log(`${step.name} (${id}): ${r.label}`);
    if (r.png) writeFileSync(join(out, `${step.name}.png`), Buffer.from(r.png.split(",")[1], "base64"));
  }
}

test("Agents fit the rides", async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1512, height: 900 });
  await openAtlas(page, { time: Date.parse("2026-10-28T13:00:00Z"), storage: { mapInside: false } });
  await waitForScene(page);
  await settle(page, 4);
  await shoot(page, RIDES);
});

test("Agents fit the office: walk in, sit, work, leave", async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1512, height: 900 });
  const at = SCHEDULED + 70_000;
  const run = { id: "901", status: "running", mode: "trigger", startedAt: iso(SCHEDULED + 2000), stoppedAt: null };
  const snapshot = { state: "ok", instance: "https://khancam15.app.n8n.cloud", fetchedAt: iso(at), window: 250, workflows: [{ id: "Hua0wdGB5WSDjSGB", name: "Atlas · Data Inventory", active: true, runs: [run], failures24h: 0, schedules: [{ label: "Daily at 7:20", cron: "20 7 * * *" }], timezone: "America/New_York", savesSuccess: true }] };
  await openAtlas(page, { time: at, storage: { "routine-n8n-snapshot": snapshot, mapInside: false } });
  await waitForScene(page);
  await settle(page, 4);
  // Open her office in Inside the way a tap does: her card, View office, zoom in.
  await page.evaluate((id) => (window as unknown as { __atlasOpenAgent(id: string): void }).__atlasOpenAgent(id), PRIYA);
  await settle(page, 2);
  await page.locator(".m3-agent-task").getByRole("button", { name: "View office" }).click();
  await settle(page, 6);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(async () => {
      await settle(page, 2);
      return page.evaluate(async () => {
        const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
        const fiber: typeof import("@react-three/fiber") = await import(source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1]);
        const state = fiber._roots.get(document.querySelector("canvas")!)!.store.getState();
        return (state.scene.getObjectByName("named-agent-badges")?.userData.open ?? []) as string[];
      });
    }, { timeout: 90_000 })
    .toContain(OFFICE);
  await shoot(page, OFFICE_STEPS);
});

// Each agent outside its own headquarters, next to the door it walks in by (buildings face +z, so
// the camera looks back at the facade over the agent's shoulder).
test("Headquarters doors fit an agent", async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1512, height: 900 });
  await openAtlas(page, { time: Date.parse("2026-10-28T13:00:00Z"), storage: { mapInside: false } });
  await waitForScene(page);
  await settle(page, 4);
  const ids = await page.evaluate(async () => {
    const ops = (await import("/src/routine/useRoutineOps.ts" as string)) as { routinesSnapshot(): ReadonlyMap<string, unknown> };
    return [...ops.routinesSnapshot().keys()];
  });
  const seen = new Set<string>();
  for (const id of ids) {
    const step: Step = { name: `door-${id}`, kind: "office", share: 0.5, view: "door", d: 1.1, id };
    const got = await stage(page, step);
    if (!got) continue;
    await settle(page, 2);
    const r = await closeUp(page, id, step);
    if (!r.png || seen.has(r.label)) continue;
    seen.add(r.label);
    console.log(`${step.name}: ${r.label}`);
    writeFileSync(join(out, `${step.name}.png`), Buffer.from(r.png.split(",")[1], "base64"));
  }
});
