import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle, waitForScene } from "./atlas";

// One building, outside and inside (buildings/buildingDefinition.ts): Atlas Command Center while
// Priya Raman's Data Inventory run is working (the same saved n8n summary as agent-routine.visual.ts,
// nothing is run). Review shots, not baselines:
// BUILDING_SHOTS=<dir> npx playwright test -c visual visual/building-interiors.visual.ts
const out = process.env.BUILDING_SHOTS ?? "";
test.skip(!out, "Set BUILDING_SHOTS to a folder to take the building shots");

const SCHEDULED = Date.parse("2026-10-28T11:20:00Z");
const iso = (t: number) => new Date(t).toISOString();
const AT = SCHEDULED + 70_000;
const SNAPSHOT = {
  state: "ok",
  instance: "https://khancam15.app.n8n.cloud",
  fetchedAt: iso(AT),
  window: 250,
  workflows: [
    {
      id: "Hua0wdGB5WSDjSGB",
      name: "Atlas · Data Inventory",
      active: true,
      runs: [
        { id: "901", status: "running", mode: "trigger", startedAt: iso(SCHEDULED + 2000), stoppedAt: null },
        { id: "900", status: "success", mode: "trigger", startedAt: iso(SCHEDULED - 86_400_000 + 2000), stoppedAt: iso(SCHEDULED - 86_400_000 + 95_000) },
      ],
      failures24h: 0,
      schedules: [{ label: "Daily at 7:20", cron: "20 7 * * *" }],
      timezone: "America/New_York",
      savesSuccess: true,
    },
  ],
};

const ONLY = process.env.BUILDING_ONLY?.split(",");
const BUILDINGS: [string, string][] = ([
  ["Atlas Command Center", "project:ai-ops-atlas"],
  ["Business Operations HQ", "project:benjaire-site"],
  ["Product & Growth Tower", "project:commerce-pipeline"],
  ["Security & Infrastructure Center", "project:soc-lab"],
  ["Projects & Portfolio Studio", "project:portfolio-site"],
  ["AI Engineering & Research Center", "project:github-profile"],
  ["Agent Operations Center", "project:intelligence-hub"],
] as [string, string][]).filter(([, k]) => !ONLY || ONLY.includes(k.slice(8)));

/** A fixed camera on the building's front corner, rendered straight from the map's renderer. */
async function frame(page: Page, key: string, close: boolean) {
  return page.evaluate(
    async ({ key, close }) => {
      const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
      const fiber: typeof import("@react-three/fiber") = await import(source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1]);
      const canvas = document.querySelector("canvas")!, state = fiber._roots.get(canvas)!.store.getState();
      const [data, layout, planner] = await Promise.all(["/src/catalog/index.ts", "/src/views/mapLayout.ts", "/src/views/map3d/scene.ts"].map((u) => import(u)));
      const grouping = JSON.parse(localStorage.getItem("atlas:mapProjectGrouping") ?? '"district"');
      const t = planner.buildScene(layout.layoutMap(data.catalog, [], grouping)).towers.find((x: { key: string }) => x.key === key);
      const cam = state.camera as import("three").PerspectiveCamera, keep = { near: cam.near, pos: cam.position.clone(), q: cam.quaternion.clone() };
      cam.near = 0.02;
      cam.updateProjectionMatrix();
      // Close: level with the open floor (buildings/buildingDefinition.ts).
      const defs = (await import("/src/buildings/buildingDefinition.ts")).defineBuildings([t], data.catalog.projects, data.catalog.agents);
      const floors = await import("/src/buildings/insideFloors.ts");
      const def = defs.get(key);
      const surface = def ? def.floors.find((f: { index: number }) => f.index === floors.openFloor(key, Math.max(...def.desks.map((x: { floor: number }) => x.floor)))).surface : 3.75;
      const d = close ? 2.4 : 7.5, look = close ? surface : 2.6;
      cam.position.set(t.x + d * 0.7, look + d * (close ? 0.85 : 0.55), t.z + d);
      cam.lookAt(t.x - (close ? 0.3 : 0), look, t.z);
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
    { key, close },
  );
}

const save = (name: string, png: string) => writeFileSync(join(out, `${name}.png`), Buffer.from(png.split(",")[1], "base64"));

/** Whether the Inside view has cut this building open down to a floor (materials.ts cut slots). */
async function isOpen(page: Page, key: string): Promise<boolean> {
  return page.evaluate(async (key) => {
    const [data, layout, planner, mats] = await Promise.all(["/src/catalog/index.ts", "/src/views/mapLayout.ts", "/src/views/map3d/scene.ts", "/src/views/map3d/materials.ts"].map((u) => import(u)));
    const grouping = JSON.parse(localStorage.getItem("atlas:mapProjectGrouping") ?? '"district"');
    const t = planner.buildScene(layout.layoutMap(data.catalog, [], grouping)).towers.find((x: { key: string }) => x.key === key);
    for (let i = 0; i < mats.cutCount.value; i++) {
      const r = mats.cutRects.value[i];
      if (Math.abs((r.x + r.z) / 2 - t.x) < 1e-3 && Math.abs((r.y + r.w) / 2 - t.z) < 1e-3 && mats.cutHeights.value[i] < t.height) return true;
    }
    return false;
  }, key);
}

async function openCount(page: Page) {
  return page.evaluate(async () => (await import("/src/views/map3d/materials.ts")).cutCount.value as number);
}

for (const width of [1512, 390])
  test(`Atlas Command Center outside and inside ${width}`, async ({ page }) => {
    test.setTimeout(600_000);
    mkdirSync(out, { recursive: true });
    const phone = width < 600;
    await page.setViewportSize({ width, height: phone ? 844 : 900 });
    await openAtlas(page, { time: AT, storage: { "routine-n8n-snapshot": SNAPSHOT, mapInside: false } } as Parameters<typeof openAtlas>[1]);
    await waitForScene(page);
    await settle(page, 4);
    await selectBuilding(page, "Atlas Command Center");
    // A phone has no zoom buttons (pinch instead), and its building sheet covers the toolbar, so
    // buttons are pressed directly. The review frames use their own fixed camera either way.
    const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
    if (await zoomIn.count()) for (let i = 0; i < 3; i++) await zoomIn.dispatchEvent("click");
    await settle(page, 6);
    await page.screenshot({ path: join(out, `${width}-outside-page.png`) });
    save(`${width}-outside`, await frame(page, "project:ai-ops-atlas", false));
    await page.getByRole("button", { name: "Inside", exact: true }).dispatchEvent("click");
    await expect.poll(async () => { await settle(page, 2); return openCount(page); }, { timeout: 90_000 }).toBeGreaterThan(0);
    await settle(page, 6);
    await page.screenshot({ path: join(out, `${width}-inside-page.png`) });
    save(`${width}-inside`, await frame(page, "project:ai-ops-atlas", false));
    save(`${width}-inside-close`, await frame(page, "project:ai-ops-atlas", true));
    // Locate agent, from the building's list of people (BuildingInside.tsx), when this build has it.
    const locate = page.getByRole("button", { name: "Locate Priya Raman" });
    if (await locate.count()) {
      await locate.first().dispatchEvent("click");
      for (let i = 0; i < 6; i++) await settle(page, 2);
      await page.screenshot({ path: join(out, `${width}-locate-page.png`) });
      save(`${width}-locate-close`, await frame(page, "project:ai-ops-atlas", true));
    }
    // Enter building (office/OfficeScene.tsx): the same floor, with the named agents at their own desks.
    const enter = page.getByRole("button", { name: "Enter building" });
    if (await enter.count()) {
      await enter.first().dispatchEvent("click");
      await page.locator(".office-layer canvas").waitFor({ timeout: 60_000 });
      for (let i = 0; i < 8; i++) await settle(page, 2);
      await page.screenshot({ path: join(out, `${width}-office-page.png`) });
      const floor4 = page.getByRole("button", { name: "Floor 4", exact: true });
      if (await floor4.count()) {
        await floor4.first().dispatchEvent("click");
        const zoom = page.locator(".office-layer").getByRole("button", { name: /zoom in/i });
        if (await zoom.count()) for (let i = 0; i < 3; i++) await zoom.first().dispatchEvent("click");
        for (let i = 0; i < 6; i++) await settle(page, 2);
        await page.screenshot({ path: join(out, `${width}-office-floor.png`) });
      }
    }
  });

test("Every building with a desk, inside", async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(out, { recursive: true });
  await openAtlas(page, { time: AT, storage: { "routine-n8n-snapshot": SNAPSHOT, mapInside: true } } as Parameters<typeof openAtlas>[1]);
  await waitForScene(page);
  for (const [name, key] of BUILDINGS) {
    await selectBuilding(page, name);
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    // Inside picks which buildings open on its own frame clock: keep it running until this one opens.
    await expect.poll(async () => { await settle(page, 2); return isOpen(page, key); }, { timeout: 120_000 }).toBe(true);
    await settle(page, 6);
    save(`all-${key.slice(8)}-inside`, await frame(page, key, true));
    save(`all-${key.slice(8)}-outside-far`, await frame(page, key, false));
  }
});
