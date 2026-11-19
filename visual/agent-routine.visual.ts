import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// The agents' daily routine (routine/routine.ts, map3d/NamedAgents.tsx): one scheduled run of a real
// n8n workflow, Priya Raman's Data Inventory (daily at 7:20 New York), shown at four moments:
// heading to the office ahead of it, working at his desk in the Inside view, task completed, and free
// time afterwards. n8n is answered from a saved summary (no live n8n, nothing is run). The live
// workflow doesn't keep successful runs yet (n8n setting, awaiting Khaneil's OK); the fixture shows
// them as it will once it does. Her desk is in Atlas Command Center, which opens in Inside. Review shots,
// not baselines: ROUTINE_SHOTS=<dir> npx playwright test -c visual visual/agent-routine.visual.ts
const out = process.env.ROUTINE_SHOTS ?? "";
test.skip(!out, "Set ROUTINE_SHOTS to a folder to take these review shots");
const AGENT = "atlas-health-monitor", NAME = "Priya Raman", OFFICE = "project:ai-ops-atlas";
const SCHEDULED = Date.parse("2026-10-28T11:20:00Z"); // 7:20 in New York (daylight time)
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

type Run = { id: string; status: string; mode: string; startedAt: string; stoppedAt: string | null };
function snapshot(at: number, runs: Run[]) {
  // Yesterday's 11:00 run, so the workflow shows as verified by a real run.
  const yesterday: Run = { id: "900", status: "success", mode: "trigger", startedAt: iso(SCHEDULED - 24 * 60 * MIN + 2000), stoppedAt: iso(SCHEDULED - 24 * 60 * MIN + 95_000) };
  return {
    state: "ok",
    instance: "https://khancam15.app.n8n.cloud",
    fetchedAt: iso(at),
    window: 250,
    workflows: [{ id: "Hua0wdGB5WSDjSGB", name: "Atlas · Data Inventory", active: true, runs: [...runs, yesterday], failures24h: 0, schedules: [{ label: "Daily at 7:20", cron: "20 7 * * *" }], timezone: "America/New_York", savesSuccess: true }],
  };
}

const MOMENTS: { name: string; at: number; runs: Run[]; office?: boolean; expect: RegExp }[] = [
  { name: "1-heading-to-office", at: SCHEDULED - 75_000, runs: [], expect: /Heading to office|Entering building|Going to desk|At desk|Finishing up/i },
  { name: "2-working-at-desk", at: SCHEDULED + 70_000, runs: [{ id: "901", status: "running", mode: "trigger", startedAt: iso(SCHEDULED + 2000), stoppedAt: null }], office: true, expect: /Working/ },
  { name: "3-task-completed", at: SCHEDULED + 130_000, runs: [{ id: "901", status: "success", mode: "trigger", startedAt: iso(SCHEDULED + 2000), stoppedAt: iso(SCHEDULED + 124_000) }], office: true, expect: /Task completed|Leaving office/ },
  { name: "4-free-time", at: SCHEDULED + 25 * MIN, runs: [{ id: "901", status: "success", mode: "trigger", startedAt: iso(SCHEDULED + 2000), stoppedAt: iso(SCHEDULED + 124_000) }], expect: /Relaxing|Walking|Riding|Visiting|At home/ },
];

async function routineOf(page: Page) {
  return page.evaluate(async (id) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const fiber: typeof import("@react-three/fiber") = await import(source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1]);
    const canvas = document.querySelector("canvas")!, state = fiber._roots.get(canvas)!.store.getState();
    const badges = state.scene.getObjectByName("named-agent-badges") as import("three").InstancedMesh;
    const all = badges.userData.routine as { id: string; seg: { phase: string | null; activity: string; note: string } | null; place: string }[];
    return { ...(all.find((a) => a.id === id) ?? null), open: badges.userData.open as string[] };
  }, AGENT);
}

/** A close-up of the agent, rendered straight from the map's camera (the page view stays as it is). */
async function closeUp(page: Page, phone: boolean) {
  return page.evaluate(
    async ({ id, phone }) => {
      const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
      const fiber: typeof import("@react-three/fiber") = await import(source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1]);
      const canvas = document.querySelector("canvas")!, state = fiber._roots.get(canvas)!.store.getState();
      const badges = state.scene.getObjectByName("named-agent-badges") as import("three").InstancedMesh;
      const me = (badges.userData.routine as { id: string; at: { x: number; y: number; z: number } | null }[]).find((a) => a.id === id);
      if (!me?.at) return null;
      const cam = state.camera as import("three").PerspectiveCamera, keep = { near: cam.near, pos: cam.position.clone(), q: cam.quaternion.clone() };
      cam.near = 0.02;
      cam.updateProjectionMatrix();
      const { x, y, z } = me.at, d = phone ? 2.4 : 1.7;
      cam.position.set(x + d * 0.35, y + d * 1.6, z + d * 0.6);
      cam.lookAt(x, y - 0.25, z);
      cam.updateMatrixWorld();
      state.gl.shadowMap.needsUpdate = true;
      state.gl.render(state.scene, cam);
      const png = canvas.toDataURL("image/png");
      cam.near = keep.near;
      cam.position.copy(keep.pos);
      cam.quaternion.copy(keep.q);
      cam.updateProjectionMatrix();
      return png;
    },
    { id: AGENT, phone },
  );
}

for (const width of [1512, 390])
  for (const m of MOMENTS)
    test(`Agent routine ${m.name} ${width}`, async ({ page }) => {
      test.setTimeout(600_000);
      mkdirSync(out, { recursive: true });
      const phone = width < 600;
      await page.setViewportSize({ width, height: phone ? 844 : 900 });
      await openAtlas(page, { time: m.at, storage: { "routine-n8n-snapshot": snapshot(m.at, m.runs), mapInside: false } });
      await waitForScene(page);
      await settle(page, 4);
      // The card, opened the way a tap opens it.
      await page.evaluate((id) => (window as unknown as { __atlasOpenAgent(id: string): void }).__atlasOpenAgent(id), AGENT);
      await settle(page, 2);
      const card = page.locator(".m3-agent-task");
      await expect(card).toContainText(NAME);
      if (m.office) {
        await card.getByRole("button", { name: "View office" }).click();
        await settle(page, 6);
        const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
        if (await zoom.isVisible()) for (let i = 0; i < 3; i++) await zoom.click();
        else {
          // The phone toolbar has no zoom buttons: the map's + key does the same.
          await page.locator(".map-stage").focus();
          for (let i = 0; i < 4; i++) await page.keyboard.press("+");
        }
        // Inside picks which buildings open on its own frame clock: keep the clock running until his opens.
        await expect.poll(async () => { await settle(page, 2); return (await routineOf(page))?.open ?? []; }, { timeout: 90_000 }).toContain(OFFICE);
        await page.evaluate((id) => (window as unknown as { __atlasOpenAgent(id: string): void }).__atlasOpenAgent(id), AGENT);
      } else {
        await card.getByRole("button", { name: "Follow agent" }).click();
        for (let i = 0; i < 6; i++) await settle(page, 2);
      }
      await settle(page, 3);
      const r = await routineOf(page);
      const label = `${r?.seg?.phase ?? r?.seg?.activity} · ${r?.seg?.note} · ${r?.place}`;
      console.log(`${m.name} ${width}: ${label} · open ${JSON.stringify(r?.open)}`);
      await expect(page.locator(".m3-agent-task")).toContainText(m.expect);
      if (m.office) await expect(page.locator(".m3-agent-task")).toContainText(m.runs[0].status === "running" ? "Running" : "Succeeded");
      await page.screenshot({ path: join(out, `${width}-${m.name}.png`) });
      const png = await closeUp(page, phone);
      if (png) writeFileSync(join(out, `${width}-${m.name}-closeup.png`), Buffer.from(png.split(",")[1], "base64"));
    });
