import { WORKSPACE, isMerged, type AtlasWorkspace } from "../../modules/workspace";
import { financialKey } from "./financialPlan";
import { DEALERSHIP_KEY } from "./dealershipPlan";
import { GALLERIA_KEY } from "./galleriaPlan";
import { MALL_KEY } from "./mallPlan";
import { PLAZA_KEY } from "./plazaPlan";
import { STADIUM_KEY } from "./stadiumPlan";
import type { Scene3D } from "./scene";

// The map draws the eight core buildings (Khaneil, 2026-11-24). Buildings folded into one of them
// (catalog/workspace/workspace.yaml `merged`) are planned exactly as before, so streets, rail,
// traffic and every other planner keep the same ground, and then left out of what is drawn. Their
// modules, agents and records are untouched and listed in the building that houses them.

/** The scene as drawn: folded buildings left out. The planned scene is not changed. */
export function presentScene(scene: Scene3D, workspace: Pick<AtlasWorkspace, "merged"> = WORKSPACE): Scene3D {
  if (!workspace.merged) return scene;
  const gone = (key: string) => isMerged(key, workspace);
  const financial = scene.financial && { ...scene.financial, buildings: scene.financial.buildings.filter((b) => !gone(financialKey(b.id))) };
  return {
    ...scene,
    towers: scene.towers.filter((t) => !gone(t.key)),
    ...(financial ? { financial } : {}),
    dealership: gone(DEALERSHIP_KEY) ? undefined : scene.dealership,
    galleria: gone(GALLERIA_KEY) ? undefined : scene.galleria,
    mall: gone(MALL_KEY) ? undefined : scene.mall,
    plaza: gone(PLAZA_KEY) ? undefined : scene.plaza,
    stadium: gone(STADIUM_KEY) ? undefined : scene.stadium,
    stadiumSite: gone(STADIUM_KEY) ? undefined : scene.stadiumSite,
  };
}
