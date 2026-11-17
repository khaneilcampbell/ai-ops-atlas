import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// Pointing at an AI agent walking on the map shows who it is, its live state, and its home and work
// building (map3d/AgentTag.tsx). Frames the camera on a walking agent the way agent-commute.visual.ts
// does, then moves the real mouse onto it. Shot: visual/out/agent-tag-<tag>.png.
const OUT = join(import.meta.dirname, "out");

async function aimAtAgent(page: Page) {
  return page.evaluate(async () => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
    if (!url) throw new Error("Fiber import not found");
    const fiber: typeof import("@react-three/fiber") = await import(url);
    const canvas = document.querySelector("canvas")!;
    const state = fiber._roots.get(canvas)?.store.getState();
    if (!state) throw new Error("Map renderer not found");
    const mesh = state.scene.getObjectByName("rail-commuters") as import("three").InstancedMesh | undefined;
    if (!mesh) throw new Error("Crowd mesh not found");
    // AI agents' heads are tinted apart from everyone else's (HillsCommunity.tsx): the odd colour out.
    const heads = mesh.parent!.children[mesh.parent!.children.indexOf(mesh) + 1] as import("three").InstancedMesh;
    const col = heads.instanceColor!.array, e = mesh.instanceMatrix.array, key = (i: number) => `${col[i * 3].toFixed(3)},${col[i * 3 + 1].toFixed(3)},${col[i * 3 + 2].toFixed(3)}`;
    const tally = new Map<string, number>();
    for (let i = 0; i < mesh.count; i++) tally.set(key(i), (tally.get(key(i)) ?? 0) + 1);
    const common = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    // The agent nearest the camera that is on screen, at the map's own view.
    const r = canvas.getBoundingClientRect();
    let best: { x: number; y: number; d: number } | null = null;
    for (let i = 0; i < mesh.count; i++) {
      const k = i * 16;
      if (key(i) === common || Math.hypot(e[k], e[k + 1], e[k + 2]) < 1e-3) continue;
      const w = state.camera.position.clone().set(e[k + 12], e[k + 13] + 0.1, e[k + 14]);
      const d = w.distanceTo(state.camera.position), v = w.project(state.camera);
      const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
      if (v.z < 1 && x > r.left + 260 && x < r.right - 260 && y > r.top + 220 && y < r.bottom - 120 && document.elementFromPoint(x, y) === canvas && (!best || d < best.d)) best = { x, y, d };
    }
    if (!best) throw new Error("No agents walking on screen");
    return { x: best.x, y: best.y };
  });
}

test("agent tag, desktop", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1512, height: 900 });
  await openAtlas(page);
  await waitForScene(page);
  await settle(page, 6);
  const p = await aimAtAgent(page);
  await page.mouse.move(p.x - 8, p.y - 8);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await settle(page, 4);
  await expect(page.locator(".m3-agent-tag")).toContainText("Home");
  await expect(page.locator(".m3-agent-tag")).toContainText("Work");
  await page.screenshot({ path: join(OUT, "agent-tag-1512.png") });
});
