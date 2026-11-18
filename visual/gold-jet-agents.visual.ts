import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, settle, waitForScene } from "./atlas";

// Agents ride the Atlas Gold Jet in their free time (routinePlaces.ts flight, routinePose.ts): this waits for the
// first agent aboard, opens its card and follows it. Motion is switched on, since the jet only flies with it.
// Review shots, not baselines: JET_SHOTS=<dir> npx playwright test -c visual/local-chromium.config.ts visual/gold-jet-agents.visual.ts
const out = process.env.JET_SHOTS ?? "";
test.skip(!out, "Set JET_SHOTS to a folder to take these review shots");
// Just before Yusuf Demir (agent-operations-lead) heads out for a flight in its free time.
const AT = Date.parse("2026-11-18T12:00:30Z");

async function routine(page: Page) {
  return page.evaluate(async () => {
    const source = await (await fetch("/src/views/map3d/HillsCommunity.tsx")).text();
    const fiber: typeof import("@react-three/fiber") = await import(source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1]);
    const canvas = document.querySelector("canvas")!, state = fiber._roots.get(canvas)!.store.getState();
    const badges = state.scene.getObjectByName("named-agent-badges") as import("three").InstancedMesh;
    return (badges.userData.routine ?? []) as { id: string; place: string; at: { x: number; y: number; z: number } | null }[];
  });
}

for (const width of [1512, 390])
  test(`Agent aboard the Atlas Gold Jet ${width}`, async ({ page }) => {
    test.setTimeout(1_700_000);
    mkdirSync(out, { recursive: true });
    const phone = width < 600;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width, height: phone ? 844 : 900 });
    await openAtlas(page, { time: AT, storage: { mapInside: false } });
    await waitForScene(page);
    let rider: { id: string; place: string } | undefined;
    await expect
      .poll(
        async () => {
          await settle(page, 10);
          rider = (await routine(page)).find((a) => a.place.startsWith("Aboard the Atlas Gold Jet"));
          return rider?.id ?? null;
        },
        { timeout: 1_500_000, intervals: [0] },
      )
      .not.toBeNull();
    console.log(`${width}: ${rider!.id} · ${rider!.place}`);
    await page.evaluate((id) => (window as unknown as { __atlasOpenAgent(id: string): void }).__atlasOpenAgent(id), rider!.id);
    await settle(page, 2);
    const card = page.locator(".m3-agent-task");
    await expect(card).toContainText("Atlas Gold Jet");
    await card.getByRole("button", { name: "Follow agent" }).click();
    for (let i = 0; i < 6; i++) await settle(page, 2);
    await page.screenshot({ path: join(out, `${width}-aboard-gold-jet.png`) });
    await card.screenshot({ path: join(out, `${width}-card.png`) });
  });
