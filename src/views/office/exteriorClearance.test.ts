import {it,expect} from "vitest";
import {catalog} from "../../catalog";
import {layoutMap} from "../mapLayout";
import {buildScene} from "../map3d/scene";
import {clearInteriorFootprint} from "./exteriorClearance";
it("excludes exterior walkers and fountains from rooms without changing the city source",()=>{
  const source=buildScene(layoutMap(catalog));
  const park=source.parks[0],x=park.x+park.w/2,z=park.z+park.d/2;
  const before=source.walks.length;
  const scene=clearInteriorFootprint(source,x,z,2.5);
  expect(source.walks.length).toBe(before);
  expect(scene.fountains.every(f=>Math.abs(f.x-x)>3.1||Math.abs(f.z-z)>3.1)).toBe(true);
  for(const w of scene.walks){const route=w.route??[{gx:w.x0,gy:w.z0},{gx:w.x1,gy:w.z1}];expect(route.every(p=>Math.abs(p.gx-x)>2.5||Math.abs(p.gy-z)>2.5)).toBe(true);}
  expect(scene.towers).toBe(source.towers);
});
