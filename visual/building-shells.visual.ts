import { expect, test } from "@playwright/test";
import { openAtlas, waitForScene } from "./atlas";

/**
 * Guards src/buildings/shellPlates.ts: each headquarters' office floors must sit inside the shell the
 * map draws. For every desk floor (and the lobby) it measures the shell's outline at that storey (rays
 * from outside toward the centre, the way the table was measured) and checks the plate in the table,
 * as the building definition uses it, stays inside. Change a tower's shape and this fails until its
 * plates are measured again: MEASURE=1 prints each building's plates for shellPlates.ts instead
 * (the largest level rectangle inside the outline, any centre, a few aspect ratios).
 */
const MEASURE = !!process.env.MEASURE;
// About a minute of software WebGL, and the visual CI shards are full: run it after changing a tower's
// shape (SHELLS=1 npx playwright test -c visual visual/building-shells.visual.ts), or MEASURE=1.
test.skip(!process.env.SHELLS && !MEASURE, "Set SHELLS=1 to check, or MEASURE=1 to measure, the office floor plates");
test.use({ deviceScaleFactor: 1 });
test("office floors fit inside their buildings' shells", async ({ page }) => {
  test.setTimeout(900_000);
  await openAtlas(page, { light: "day" });
  await waitForScene(page);
  const misses = await page.evaluate(async (measure) => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const fiber = await import(source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1]);
    const state = fiber._roots.get(document.querySelector("canvas"))!.store.getState();
    const THREE = await import(source.match(/from\s*["']([^"']*\/three\.js[^"']*)["']/)?.[1] ?? "/node_modules/.vite/deps/three.js");
    const [data, layout, planner, defs] = await Promise.all(["/src/catalog/index.ts", "/src/views/mapLayout.ts", "/src/views/map3d/scene.ts", "/src/buildings/buildingDefinition.ts"].map((u) => import(u)));
    const grouping = JSON.parse(localStorage.getItem("atlas:mapProjectGrouping") ?? '"district"');
    const scene = planner.buildScene(layout.layoutMap(data.catalog, [], grouping));
    const buildings = defs.defineBuildings(scene.towers, data.catalog.projects, data.catalog.agents);
    state.scene.updateMatrixWorld(true);
    const all: import("three").Mesh[] = [];
    state.scene.traverse((o: import("three").Object3D) => {
      if ((o as import("three").Mesh).isMesh && o.name !== "atlas-inside-view") all.push(o as import("three").Mesh);
    });
    const rc = new THREE.Raycaster();
    const out: string[] = [];
    for (const t of scene.towers) {
      const def = buildings.get(t.key);
      if (!def?.desks.length) continue;
      const R = t.size * 0.62;
      const zone = new THREE.Box3(new THREE.Vector3(t.x - R, 0, t.z - R), new THREE.Vector3(t.x + R, 30, t.z + R));
      const meshes = all.filter((m) => {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        return (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh || new THREE.Box3().copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld).intersectsBox(zone);
      });
      const hit = (o: import("three").Vector3, d: import("three").Vector3) => {
        rc.set(o, d);
        rc.far = R;
        const hits: import("three").Intersection[] = [];
        for (const m of meshes) {
          try {
            ((m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh ? THREE.InstancedMesh : THREE.Mesh).prototype.raycast.call(m, rc, hits);
          } catch {
            /* a mesh with no position attribute */
          }
        }
        return hits.length ? Math.min(...hits.map((h) => h.distance)) : null;
      };
      const outline = (y: number) => {
        const pts: [number, number][] = [];
        for (let a = 0; a < 72; a++) {
          const ang = (a / 72) * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
          const d = hit(new THREE.Vector3(t.x + dx * R, y, t.z + dz * R), new THREE.Vector3(-dx, 0, -dz));
          if (d != null) pts.push([t.x + dx * (R - d), t.z + dz * (R - d)]);
        }
        return pts;
      };
      const inside = (poly: [number, number][], x: number, z: number) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, zi] = poly[i], [xj, zj] = poly[j];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
        }
        return c;
      };
      if (measure) {
        const top = def.exterior.top - def.exterior.base, storey = top / t.floors, rows: string[] = [];
        for (let n = 0; n < 9; n++) {
          const y0 = def.exterior.base + n * storey;
          const polys = [outline(y0 + 0.03), outline(y0 + storey * 0.55)].filter((p) => p.length > 8);
          const fits = (cx: number, cz: number, hw: number, hd: number) => {
            for (let i = 0; i <= 4; i++)
              for (const [px, pz] of [[cx - hw + (2 * hw * i) / 4, cz - hd], [cx - hw + (2 * hw * i) / 4, cz + hd], [cx - hw, cz - hd + (2 * hd * i) / 4], [cx + hw, cz - hd + (2 * hd * i) / 4]])
                if (polys.some((p) => !inside(p, t.x + px * t.size, t.z + pz * t.size))) return false;
            return true;
          };
          let best = [0, 0, 0, 0], area = 0;
          for (const aspect of [1, 1.4, 2, 1 / 1.4, 1 / 2])
            for (let cx = -0.3; cx <= 0.3001; cx += 0.025)
              for (let cz = -0.3; cz <= 0.3001; cz += 0.025) {
                let lo = 0, hi = 0.6;
                for (let it = 0; it < 14; it++) {
                  const m = (lo + hi) / 2;
                  if (fits(cx, cz, aspect >= 1 ? m : m * aspect, aspect >= 1 ? m / aspect : m)) lo = m;
                  else hi = m;
                }
                const hw = aspect >= 1 ? lo : lo * aspect, hd = aspect >= 1 ? lo / aspect : lo;
                if (4 * hw * hd > area + 1e-6) [best, area] = [[cx, cz, hw, hd], 4 * hw * hd];
              }
          rows.push(`[${best.map((v) => +v.toFixed(3)).join(", ")}]`);
        }
        const front = hit(new THREE.Vector3(t.x, def.exterior.base + 0.2, t.z + R), new THREE.Vector3(0, 0, -1));
        out.push(`"${t.projectId}": { front: ${front == null ? 0.5 : +((R - front) / t.size).toFixed(3)}, plates: [${rows.join(", ")}] },`);
        continue;
      }
      for (const f of def.floors) {
        if (f.index !== 0 && !f.agents.length) continue;
        const polys = [outline(f.y + 0.03), outline(f.y + def.exterior.storeyH * 0.55)].filter((p) => p.length > 8);
        const { x0, x1, z0, z1 } = f.plate;
        for (let i = 0; i <= 4; i++)
          for (const [x, z] of [[x0 + ((x1 - x0) * i) / 4, z0], [x0 + ((x1 - x0) * i) / 4, z1], [x0, z0 + ((z1 - z0) * i) / 4], [x1, z0 + ((z1 - z0) * i) / 4]])
            if (polys.some((p) => !inside(p, x, z))) out.push(`${def.name} ${f.label}: plate corner ${x.toFixed(2)}, ${z.toFixed(2)} is outside the shell`);
      }
    }
    return out;
  }, MEASURE);
  if (MEASURE) return console.log(misses.join("\n"));
  expect(misses).toEqual([]);
});
