import {expect,it} from "vitest";
import {catalog} from "./index";
import {BUILDING_INTERIORS,skylineBuildingId,skylineBuildingKey,skylineBuildingName} from "./buildings";
import {layoutMap} from "../views/mapLayout";
import {buildScene} from "../views/map3d/scene";

it("gives every Skyline business a resolvable inspector identity and personalized interior",()=>{
  const scene=buildScene(layoutMap(catalog));
  expect(scene.retail).toHaveLength(7);
  for(const shop of scene.retail){
    expect(skylineBuildingName(skylineBuildingId(shop.name))).toBe(shop.name);
    expect(skylineBuildingKey(shop.name)).toBe(`service:skyline:building:${shop.name}`);
    expect(BUILDING_INTERIORS[shop.name].rooms).toHaveLength(4);
  }
});
it("keeps ordinary tool IDs separate from Skyline businesses",()=>{
  expect(skylineBuildingName("commerce-pipeline:canva")).toBeUndefined();
  expect(skylineBuildingName("skyline:building:Unknown")).toBeUndefined();
  expect(skylineBuildingName("skyline:building:toString")).toBeUndefined();
});
