import {describe,expect,it} from "vitest";
import {catalog} from "../../catalog";
import {layoutMap,type GroupBy} from "../mapLayout";
import {buildScene} from "./scene";
import {openLot} from "./openLot";
import {MALL,MALL_SHOPS,mallFloor,mallPieceCount,planMall} from "./mallPlan";
import {distanceToRoad} from "./highway";
import {ROAD_W} from "./roads";

/** The mall is a few draw calls of merged meshes plus instanced fins; keep it far under the highway's 7,000. */
const BUDGET=1_000;
const sceneFor=(g:GroupBy="district")=>buildScene(layoutMap(catalog,[],g));

describe("Atlas Marketplace mall", () => {
 const s=sceneFor(),m=s.mall!;
 it("sits between the open lot (once the Skyline park) and the Hills boulevard", () => {
  expect(m).toBeDefined();
  const park=openLot(s.parks)!;
  expect(m.x).toBeGreaterThan(park.x+park.w);
  expect(m.z+m.d).toBeCloseTo(s.transportConnections.find(c=>c.id==="marketplace-city-boulevard")!.road[0][1]-1.95);
 });
 it("keeps clear of every building", () => {
  for(const b of [...s.towers,...s.kiosks])
   expect(b.x+b.size/2<=m.x||b.x-b.size/2>=m.x+m.w||b.z+b.size/2<=m.z||b.z-b.size/2>=m.z+m.d).toBe(true);
 });
 it("keeps clear of every road, including the highway's local road", () => {
  const roads=[...s.transportConnections.map(c=>c.road),...(s.freight?[s.freight.highway,s.freight.route,s.freight.cityAccess,...s.freight.access.flatMap(a=>[a.collector,...a.ramps])]:[])];
  for(let l=0;l<MALL.levels;l++)for(const p of mallFloor(m,l).outer)for(const road of roads)expect(distanceToRoad(p,road)).toBeGreaterThan(.6);
  for(const road of roads)expect(distanceToRoad([m.fountain.x,m.fountain.z],road)).toBeGreaterThan(.6+m.fountain.r);
 });
 it("opens its plaza onto the existing sidewalk, so walkers can reach it", () => {
  // One forecourt rectangle runs square to the street sidewalk in front (Khaneil, 2026-11-13), no strips in the grass.
  const z1=m.forecourtZ1!;
  expect(z1).toBeGreaterThan(m.plaza.z+m.plaza.d);
  expect(s.transportConnections.some(c=>c.road.slice(1).some((b,i)=>{const a=c.road[i];return Math.abs(a[1]-b[1])<1e-6&&Math.abs(a[1]-ROAD_W/2-.18-z1)<1e-6&&Math.min(Math.max(a[0],b[0]),m.plaza.x+m.plaza.w)-Math.max(Math.min(a[0],b[0]),m.plaza.x)>m.plaza.w/2;}))).toBe(true);
  for(const t of [...s.trees,...s.bushes,...s.rocks])expect(t.x>m.plaza.x&&t.x<m.plaza.x+m.plaza.w&&t.z>m.plaza.z+m.plaza.d&&t.z<z1).toBe(false);
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
  expect(planMall({parks:[],land:[],towers:[],kiosks:[],links:[]})).toBeUndefined();
 });
});

describe("Atlas Marketplace scale", () => {
 it("is one step (0.8) smaller than its first size, on the same lot (KC, 2026-11-08)", async () => {
  const {HILLS}=await import("./hillsPlan");
  const m=buildScene(layoutMap(catalog,[],"district")).mall!;
  expect(MALL.size).toBeCloseTo(.8);
  expect(MALL.levels*MALL.floor).toBeCloseTo(4*1.6*.8);
  // Still clearly taller than the mansion, and the lot (plaza, neighbours) is unchanged.
  expect(MALL.levels*MALL.floor).toBeGreaterThan(HILLS.mansion.h*1.5);
  expect(m.rx).toBeCloseTo((m.w/2-.1)*.8);
  expect(m.rz).toBeCloseTo((m.plaza.z-m.z)/2*.8-.04);
  // The open side of the horseshoe still meets the plaza.
  expect(m.cz+m.rz).toBeCloseTo(m.plaza.z-.05);
  expect(m.cz-m.rz).toBeGreaterThan(m.z);
 });
});

describe("Atlas Marketplace when a project leaves the map", () => {
 // An archived or deleted repository drops its project from the live catalog, which moves the
 // open lot. The Marketplace and the railway must follow it (the garden behind it only when there is room), not vanish.
 const without=(id:string)=>({...catalog,projects:catalog.projects.filter(p=>p.id!==id),agents:catalog.agents.filter(a=>a.projectId!==id)});
 for(const id of ["soc-lab","ai-ops-atlas","career-optimizer","portfolio-site","intelligence-hub","commerce-pipeline"])
  for(const g of ["district","tag"] as GroupBy[])it(`keeps the Marketplace and railway without ${id} (${g})`,()=>{
   const s=buildScene(layoutMap(without(id),[],g)),m=s.mall;
   expect(m).toBeDefined();expect(s.communityRail?.loop).toBeDefined();
   for(const b of [...s.towers,...s.kiosks])
    expect(b.x+b.size/2<=m!.x||b.x-b.size/2>=m!.x+m!.w||b.z+b.size/2<=m!.z||b.z-b.size/2>=m!.z+m!.d).toBe(true);
   if(s.agency)expect(m!.x+m!.w<=s.agency.cx-s.agency.w/2||m!.x>=s.agency.cx+s.agency.w/2||m!.z+m!.d<=s.agency.cz-s.agency.d/2||m!.z>=s.agency.cz+s.agency.d/2).toBe(true);
  });
});
