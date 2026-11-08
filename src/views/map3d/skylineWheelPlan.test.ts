import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { layoutMap } from "../mapLayout";
import { buildScene } from "./scene";
import { CITY_SCALE } from "./cityScale";
import { SKYLINE_WHEEL, skylineWheelPosition } from "./skylineWheelPlan";

describe("Skyline front wheel plaza", () => {
  it("fits in the district and clears buildings, the lobby, promenade, water and trees", () => {
    for (const grouping of ["none", "district", "status", "tag"] as const) {
      const scene = buildScene(layoutMap(catalog, [], grouping));
      const park = scene.parks.find(p => p.label === "Skyline")!;
      const wheel = skylineWheelPosition(park), cx = park.x + park.w / 2, cz = park.z + park.d / 2;
      const hw = SKYLINE_WHEEL.width / 2, hd = SKYLINE_WHEEL.depth / 2;
      const overlaps = (x: number, z: number, w: number, d: number) => Math.abs(x-wheel.x) < hw+w/2 && Math.abs(z-wheel.z) < hd+d/2;
      expect(wheel.z).toBeGreaterThan(cz);
      expect(wheel.x-hw).toBeGreaterThan(park.x);
      expect(wheel.x+hw).toBeLessThan(park.x+park.w);
      expect(wheel.z+hd).toBeLessThan(cz+3.9-0.1);
      expect(Math.abs(wheel.x-cx)-hw).toBeGreaterThan(0.4);
      for (const shop of scene.retail.filter(k => k.projectId === park.id)) expect(overlaps(shop.x,shop.z,shop.size,shop.size)).toBe(false);
      expect(overlaps(cx,cz-0.475*CITY_SCALE.skyline,3.4*CITY_SCALE.skyline,1.5*CITY_SCALE.skyline)).toBe(false);
      for (const tree of scene.trees) expect(overlaps(tree.x,tree.z,0.3,0.3)).toBe(false);
      for (const fountain of scene.fountains) expect(overlaps(fountain.x,fountain.z,0.8*(fountain.k??1),0.8*(fountain.k??1))).toBe(false);
      expect(scene.paving.some(p => Math.abs(p.x+p.w/2-wheel.x)<0.01 && p.z <= wheel.z+hd+0.01 && p.z+p.d >= cz+3.9-0.01)).toBe(true);
    }
  });
});
