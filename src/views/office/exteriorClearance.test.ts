import {it,expect} from "vitest";
import {catalog} from "../../catalog";
import {layoutMap} from "../mapLayout";
import {buildScene,LAND_TOP,TERRACE_H} from "../map3d/scene";
import {clearInteriorFootprint,interiorGroundY} from "./exteriorClearance";
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
it("puts every lobby, Financial District included, on the map's ground plane",()=>{
  // Financial District exteriors stand on TERRACE_H (FinancialDistrict.tsx), and land tops out at LAND_TOP since the
  // one-ground-plane change; a lobby at map height 0 would sit under the land outside.
  expect(interiorGroundY()).toBe(TERRACE_H);
  expect(Math.abs(LAND_TOP-interiorGroundY())).toBeLessThan(.01);
});
it("keeps the street palms out of Atlas HQ's cutaway, so none stands up through its floors",async()=>{
  const {avenuePlanting}=await import("../map3d/models");
  const {planOffice}=await import("./model");
  const {hqClearSpan}=await import("./atlasHqInteriorPlan");
  const project=catalog.projects.find(p=>p.id==="ai-ops-atlas")!,plan=planOffice(project,catalog.agents.filter(a=>a.projectId===project.id));
  const source=buildScene(layoutMap(catalog)),t=source.towers.find(t=>t.projectId==="ai-ops-atlas")!;
  // As CityOutside sizes it: interior units per map unit, and the cleared half-width in map units.
  const scale=Math.max(4,Math.max(plan.w,plan.d)/4),r=(hqClearSpan(plan.w,plan.d)/2+2)/scale;
  const inside=(p:{x:number;z:number})=>Math.abs(p.x-t.x)<=r&&Math.abs(p.z-t.z)<=r;
  // The city has street palms there (the one Khaneil saw through the floors, 2026-11-17)...
  expect(avenuePlanting(source).some(inside)).toBe(true);
  // ...and none once the interior clears its ground.
  expect(avenuePlanting(clearInteriorFootprint(source,t.x,t.z,r)).some(inside)).toBe(false);
});
