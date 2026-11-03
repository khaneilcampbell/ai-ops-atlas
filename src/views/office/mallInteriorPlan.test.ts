import {describe,expect,it} from 'vitest';
import {MALL_SHOPS} from '../map3d/mallPlan';
import {MALL_IN,MALL_LEVELS,mallUnits} from './mallInteriorPlan';

describe('Atlas Marketplace interior', () => {
  const units=mallUnits();

  it('has eight units on each of the four floors', () => {
    expect(units).toHaveLength(MALL_IN.levels*MALL_IN.unitsPerFloor);
    for(const l of MALL_LEVELS)expect(units.filter(u=>u.level===l.level)).toHaveLength(MALL_IN.unitsPerFloor);
  });

  it('never shows a shop as selling', () => {
    for(const u of units){
      const note=u.note.toLowerCase();
      expect(note.replace(/not selling/g,'')).not.toMatch(/selling|now open|live sales/);
    }
    const shops=units.filter(u=>u.kind==='shop');
    expect(shops.map(u=>u.name)).toEqual(MALL_SHOPS.filter(s=>s.status==='planned').map(s=>s.name));
    for(const u of shops)expect(u.note).toMatch(/^Planned · not selling yet/);
  });

  it('puts every ground-floor shop from the map on the ground floor', () => {
    const ground=units.filter(u=>u.level===0).map(u=>u.name);
    for(const s of MALL_SHOPS)expect(ground).toContain(s.name);
    expect(ground.filter(n=>n==='Information desk')).toHaveLength(2);
  });

  it('gives each unit a shop front and back wall of the same length', () => {
    for(const u of units){
      expect(u.front.length).toBe(MALL_IN.segmentsPerUnit+1);
      expect(u.back.length).toBe(u.front.length);
    }
    expect(new Set(units.map(u=>u.id)).size).toBe(units.length);
  });
});

describe('Atlas Marketplace escalators', () => {
  it('zigzag: each lands on the bridge the next one leaves from', async () => {
    const {bridgeSide,escalatorFor}=await import('./mallInteriorPlan');
    for(let l=0;l<MALL_IN.levels-1;l++){
      const e=escalatorFor(l);
      expect(Math.sign(e.from)).toBe(bridgeSide(l));
      expect(Math.sign(e.to)).toBe(bridgeSide(l+1));
      expect(Math.atan2(e.rise,e.run)*180/Math.PI).toBeCloseTo(30,0);
      expect(e.steps).toBeGreaterThan(10);
    }
  });
});

describe('Marketplace production workspaces',()=>{
 it('reuses six distinct registered Commerce workers without inventing agents',async()=>{
  const {MARKETPLACE_WORKSPACES}=await import('./marketplaceWorkspaces');
  const {catalog}=await import('../../catalog');
  expect(new Set(MARKETPLACE_WORKSPACES.map(w=>w.agentId)).size).toBe(6);
  for(const w of MARKETPLACE_WORKSPACES){
   expect(catalog.agents.find(a=>a.id===w.agentId)?.projectId).toBe('commerce-pipeline');
   const room=unitsFor(w.unitId);expect(room?.level).toBe(1);expect(room?.note).toContain('Planned · Not connected');
  }
 });
 it('keeps stable floor IDs and no car park destination',()=>{
  expect(MALL_LEVELS.map(l=>l.level)).toEqual([0,1,2,3]);
  expect(MALL_LEVELS[0].title).toMatch(/^Lobby/);
  expect(JSON.stringify(MALL_LEVELS)).not.toMatch(/car park|basement/i);
 });
 it('has upward-facing, solid floor surfaces in ground view',async()=>{
  const THREE=await import('three');const {ribbon}=await import('../map3d/mallShapes');
  for(const level of [0,1,2,3]){
   const {mallInteriorFloor:mallFloor}=await import('./mallInteriorPlan');const {MALL_SHAPE}=await import('./mallInteriorPlan');
   const {outer,inner}=mallFloor(MALL_SHAPE,level);const geo=ribbon(outer,inner,-.25,.25);
   const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial());mesh.updateMatrixWorld();
   const i=20,x=(outer[i][0]+inner[i][0])/2,z=(outer[i][1]+inner[i][1])/2;
   const hits=new THREE.Raycaster(new THREE.Vector3(x,4,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh);
   expect(hits.length).toBeGreaterThan(0);expect(hits[0].point.y).toBeCloseTo(0,5);expect(hits[0].face!.normal.y).toBeGreaterThan(.99);
   geo.dispose();(mesh.material as THREE.MeshBasicMaterial).dispose();
  }
 });
});
function unitsFor(id:string){return mallUnits().find(u=>u.id===id);}

it('provides human-scale workspace doorways and a separate lift landing',async()=>{
 const {mallDoorway,MALL_LIFT,ESCALATOR}=await import('./mallInteriorPlan');
 for(const u of mallUnits().filter(u=>u.level===1&&u.kind==='studio')){
  expect(mallDoorway(u).width).toBeGreaterThanOrEqual(1.2);
  const i=2,depth=Math.hypot(u.back[i][0]-u.front[i][0],u.back[i][1]-u.front[i][1]);
  expect(depth).toBeGreaterThan(1.8);
 }
 expect(MALL_LIFT.opening).toBeGreaterThanOrEqual(1.2);
 expect(Math.abs(MALL_LIFT.z-ESCALATOR.z)).toBeGreaterThan(2.5);
 expect(MALL_LIFT.landingEnd).toBeLessThan(MALL_LIFT.z-MALL_LIFT.depth/2);
});

it('keeps identical floor plates and a continuous human-scale hallway',async()=>{
 const {mallInteriorFloor:mallFloor}=await import('./mallInteriorPlan');const {MALL_SHAPE,MALL_CIRCULATION}=await import('./mallInteriorPlan');
 const base=mallFloor(MALL_SHAPE,0);
 for(let level=0;level<4;level++){
  expect(mallFloor(MALL_SHAPE,level)).toEqual(base);
  for(const u of mallUnits().filter(u=>u.level===level))for(let j=0;j<u.front.length;j++){
   const edge=base.inner[u.index*MALL_IN.segmentsPerUnit+j];
   expect(Math.hypot(u.front[j][0]-edge[0],u.front[j][1]-edge[1])).toBeGreaterThanOrEqual(MALL_CIRCULATION.hallway-1e-6);
  }
 }
});
it('connects incoming and outgoing escalators to real floor edges',async()=>{
 const {mallLandings,landingEdge,ESCALATOR,MALL_SHAPE,escalatorFor}=await import('./mallInteriorPlan');const {mallInteriorFloor:mallFloor}=await import('./mallInteriorPlan');
 for(let level=0;level<4;level++){
  const landings=mallLandings(level);expect(landings).toHaveLength(level===0||level===3?1:2);
  for(const l of landings)for(const dz of [-.8,0,.8])expect(Math.abs(l.to)).toBeGreaterThan(Math.abs(landingEdge(mallFloor(MALL_SHAPE,level).inner,l.z+dz,l.side)));
  if(level<3){const e=escalatorFor(level),arrival=mallLandings(level+1).find(l=>Math.sign(l.from)===Math.sign(e.to));expect(arrival).toBeDefined();expect(Math.abs(arrival!.from)).toBeLessThan(Math.abs(e.to));}
 }
 expect(ESCALATOR.z-ESCALATOR.width/2).toBeGreaterThan(2.5);
});
it('sizes dining and event furniture to rooms instead of fixed rows',async()=>{
 const {mallFurniture}=await import('./mallInteriorPlan');
 for(const u of mallUnits()){
  const f=mallFurniture(u);expect(f.stageWidth).toBeLessThanOrEqual(f.width*.5);
  if(u.kind==='food')for(const side of f.tableOffsets)expect(Math.abs(side)+.78).toBeLessThan(f.width/2);
  expect(f.chairRows).toBeLessThanOrEqual(2);
 }
});

it('preserves the original stepped exterior separately from expanded interior plates',async()=>{
 const {MALL,mallFloor}=await import('../map3d/mallPlan');const {MALL_SHAPE,mallInteriorFloor}=await import('./mallInteriorPlan');
 expect([MALL.maxW,MALL.maxD,MALL.outerFinStep,MALL.innerFinStep]).toEqual([12.4,11.6,.15,.24]);
 expect(mallFloor(MALL_SHAPE,3)).not.toEqual(mallFloor(MALL_SHAPE,0));
 expect(mallInteriorFloor(MALL_SHAPE,3)).toEqual(mallInteriorFloor(MALL_SHAPE,0));
});
