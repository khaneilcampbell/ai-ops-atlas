import {describe,expect,it} from "vitest";
import {catalog} from "../../catalog";
import {layoutMap,type GroupBy} from "../mapLayout";
import {buildScene} from "./scene";
import {MALL,MALL_SHOPS,mallFloor,mallPieceCount,planMall} from "./mallPlan";
import {distanceToRoad} from "./highway";

/** The mall is a few draw calls of merged meshes plus instanced fins; keep it far under the highway's 7,000. */
const BUDGET=1_000;
const sceneFor=(g:GroupBy="district")=>buildScene(layoutMap(catalog,[],g));

describe("Atlas Marketplace mall", () => {
 const s=sceneFor(),m=s.mall!;
 it("sits on the open lot between the Skyline park and the Hills boulevard", () => {
  expect(m).toBeDefined();
  const park=s.parks.find(p=>p.label==="Skyline")!;
  expect(m.x).toBeGreaterThan(park.x+park.w);
  expect(m.z+m.d).toBeLessThanOrEqual(s.hills!.z);
 });
 it("keeps clear of every building", () => {
  for(const b of [...s.towers,...s.kiosks,...s.retail])
   expect(b.x+b.size/2<=m.x||b.x-b.size/2>=m.x+m.w||b.z+b.size/2<=m.z||b.z-b.size/2>=m.z+m.d).toBe(true);
 });
 it("keeps clear of every road, including the highway's local road", () => {
  const roads=[...s.transportConnections.map(c=>c.road),...(s.freight?[s.freight.highway,s.freight.route,s.freight.cityAccess,...s.freight.access.flatMap(a=>[a.collector,...a.ramps])]:[])];
  for(let l=0;l<MALL.levels;l++)for(const p of mallFloor(m,l).outer)for(const road of roads)expect(distanceToRoad(p,road)).toBeGreaterThan(.6);
  for(const road of roads)expect(distanceToRoad([m.fountain.x,m.fountain.z],road)).toBeGreaterThan(.6+m.fountain.r);
 });
 it("opens its plaza onto the existing sidewalk, so walkers can reach it", () => {
  const plazaEdge=m.plaza.z+m.plaza.d+.3;
  expect(s.paving.some(p=>p.z<=plazaEdge&&p.z+p.d>=plazaEdge-.3&&p.x<m.plaza.x+m.plaza.w&&p.x+p.w>m.plaza.x)).toBe(true);
 });
 it("leaves no trees or rocks inside the building", () => {
  // The plaza in front is planted on purpose (Marketplace Gardens); the building footprint never is.
  for(const t of [...s.trees,...s.rocks,...s.bushes])expect(t.x>m.x&&t.x<m.x+m.w&&t.z>m.z&&t.z<m.plaza.z).toBe(false);
 });
 it("only shows a service as planned or vacant, never as selling", () => {
  expect(MALL_SHOPS.every(shop=>shop.status==="planned"||shop.status==="vacant")).toBe(true);
 });
 for(const g of ["district","status","tag","none"] as GroupBy[])it(`stays under ${BUDGET} pieces grouped by ${g}`, () => {
  const plan=sceneFor(g).mall;
  if(!plan)return;
  const n=mallPieceCount(plan);
  console.log(`mall pieces (${g}): ${n}`);
  expect(n).toBeLessThan(BUDGET);
 });
 it("draws nothing when the lot is missing", () => {
  expect(planMall({parks:[],land:[],towers:[],kiosks:[],retail:[],links:[]})).toBeUndefined();
 });
});

describe("Atlas Marketplace scale", () => {
 it("stands twice the height of Atlas Mansion on about its footprint", async () => {
  const {HILLS}=await import("./hillsPlan");
  const m=buildScene(layoutMap(catalog,[],"district")).mall!;
  expect(MALL.levels*MALL.floor).toBeGreaterThanOrEqual(HILLS.mansion.h*2);
  expect(m.rx*2).toBeGreaterThan(HILLS.mansion.w*.8);
  // Bounding volume at least twice the mansion's.
  expect(m.rx*2*m.rz*2*MALL.levels*MALL.floor).toBeGreaterThanOrEqual(HILLS.mansion.w*HILLS.mansion.d*HILLS.mansion.h*2);
 });
});
