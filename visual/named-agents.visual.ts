import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// The named agents in the city (map3d/NamedAgents.tsx): a close-up of every character from the
// front, a shot of each workplace group, and the profile card opened by a real click on a
// character. Review shots only, not baselines: NAMED_SHOTS=<dir> npx playwright test -c visual visual/named-agents.visual.ts
const out = process.env.NAMED_SHOTS ?? "";
test.skip(!out, "Set NAMED_SHOTS to a folder to take the named agent shots");

/** Read the characters' places from the badge mesh, then render camera views of them. */
async function shoot(page: Page, views: "each" | "groups", phone: boolean) {
  return page.evaluate(
    async ({ views, phone }) => {
      const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
      const url = source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
      if (!url) throw new Error("Fiber import not found");
      const fiber: typeof import("@react-three/fiber") = await import(url);
      const canvas = document.querySelector("canvas")!;
      const state = fiber._roots.get(canvas)?.store.getState();
      if (!state) throw new Error("Map renderer not found");
      const badges = state.scene.getObjectByName("named-agent-badges") as import("three").InstancedMesh | undefined;
      if (!badges) throw new Error("Named agents not drawn");
      const [data, layout, planner, jobs, commute, named] = await Promise.all(["/src/catalog/index.ts", "/src/views/mapLayout.ts", "/src/views/map3d/scene.ts", "/src/catalog/agentJobs.ts", "/src/views/map3d/agentCommutes.ts", "/src/views/map3d/namedAgentPlan.ts"].map((u) => import(u)));
      const grouping = JSON.parse(localStorage.getItem("atlas:mapProjectGrouping") ?? '"district"');
      const scene = planner.buildScene(layout.layoutMap(data.catalog, [], grouping));
      const j = jobs.agentJobs(data.catalog);
      const plan = named.planNamedAgents(scene, data.catalog.agents, j, commute.planAgentCommutes(scene, j));
      const e = badges.instanceMatrix.array;
      const agents = plan.agents.map((a: { personaId: string; identity: { name: string }; spot: { x: number; z: number; yaw: number }; workLabel: string }, i: number) => {
        const k = i * 16;
        return { id: a.personaId, name: a.identity.name, work: a.workLabel, shown: Math.hypot(e[k], e[k + 1], e[k + 2]) > 1e-3, x: e[k + 12], y: e[k + 13], z: e[k + 14], yaw: (badges.userData.yaw as number[] | undefined)?.[i] ?? a.spot.yaw };
      });
      // The map fits near and far to its overview; close-ups need a nearer near plane.
      const cam = state.camera as import("three").PerspectiveCamera, near = cam.near;
      cam.near = 0.02;
      cam.updateProjectionMatrix();
      const render = (target: [number, number, number], eye: [number, number, number]) => {
        state.camera.position.set(...eye);
        state.camera.lookAt(...target);
        state.camera.updateMatrixWorld();
        state.gl.shadowMap.needsUpdate = true;
        state.gl.render(state.scene, state.camera);
        return canvas.toDataURL("image/png");
      };
      const shots: { name: string; png: string }[] = [];
      if (views === "each") {
        for (const a of agents) {
          if (!a.shown) continue;
          // From the front, a little to one side, the whole figure and its badge in frame.
          const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), y = a.y - 0.16;
          shots.push({ name: `agent-${a.id}`, png: render([a.x, y, a.z], [a.x + fx * 1.05 + fz * 0.2, y + 0.16, a.z + fz * 1.05 - fx * 0.2]) });
        }
      } else {
        const groups = new Map<string, typeof agents>();
        for (const a of agents) if (a.shown) groups.set(a.work, [...(groups.get(a.work) ?? []), a]);
        for (const [work, g] of groups) {
          const cx = g.reduce((s, a) => s + a.x, 0) / g.length, cz = g.reduce((s, a) => s + a.z, 0) / g.length, cy = g[0].y - 0.2;
          const fx = Math.sin(g[0].yaw), fz = Math.cos(g[0].yaw), d = phone ? 3.2 : 2.2;
          shots.push({ name: `group-${work.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, png: render([cx, cy, cz], [cx + fx * d, cy + d * 0.7, cz + fz * d]) });
        }
        shots.push({ name: "city", png: render([0, 0, 0], [8, 30, 34]) });
      }
      cam.near = near;
      cam.updateProjectionMatrix();
      return { shots, agents };
    },
    { views, phone },
  );
}

function save(shots: { name: string; png: string }[], prefix: string) {
  mkdirSync(out, { recursive: true });
  for (const s of shots) writeFileSync(join(out, `${prefix}${s.name}.png`), Buffer.from(s.png.split(",")[1], "base64"));
}

for (const width of [1512, 390])
  test(`Named agents ${width}`, async ({ page }) => {
    test.setTimeout(600_000);
    const phone = width < 600;
    await page.setViewportSize({ width, height: phone ? 844 : 900 });
    await openAtlas(page);
    await waitForScene(page);
    await settle(page, 4);
    const groups = await shoot(page, "groups", phone);
    save(groups.shots, `${width}-`);
    expect(groups.agents.length).toBe(17);
    if (!phone) save((await shoot(page, "each", false)).shots, "");

    // A real click on a character opens its profile, with its portrait, building and AI agent label.
    // At the map's own view, on the badge of the character nearest the camera that is on screen.
    await page.reload();
    await waitForScene(page);
    await settle(page, 4);
    const at = await page.evaluate(async () => {
      const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
      const fiber: typeof import("@react-three/fiber") = await import(source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1]);
      const canvas = document.querySelector("canvas")!, state = fiber._roots.get(canvas)!.store.getState();
      const badges = state.scene.getObjectByName("named-agent-badges") as import("three").InstancedMesh;
      const e = badges.instanceMatrix.array, r = canvas.getBoundingClientRect();
      let best: { i: number; x: number; y: number; d: number } | null = null;
      for (let i = 0; i < badges.count; i++) {
        const k = i * 16;
        if (Math.hypot(e[k], e[k + 1], e[k + 2]) < 1e-3) continue;
        const w = state.camera.position.clone().set(e[k + 12], e[k + 13], e[k + 14]), d = w.distanceTo(state.camera.position), v = w.project(state.camera);
        const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
        if (v.z < 1 && x > r.left + 160 && x < r.right - 160 && y > r.top + 260 && y < r.bottom - 80 && document.elementFromPoint(x, y) === canvas && (!best || d < best.d)) best = { i, x, y, d };
      }
      if (!best) throw new Error("No named agent on screen");
      return best;
    });
    const target = groups.agents[at.i];
    await settle(page, 2);
    await page.mouse.click(at.x, at.y);
    await settle(page, 2);
    const card = page.locator(".m3-agent-profile");
    await expect(card).toBeVisible();
    await expect(card).toContainText(target.name);
    await expect(card).toContainText("AI agent");
    await expect(card).toContainText(target.work);
    await page.screenshot({ path: join(out, `${width}-profile.png`) });
  });
