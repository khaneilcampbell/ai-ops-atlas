import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene,FLOOR_H} from './scene';
import {headquartersEnvelope} from './financialPlan';
import {SOC_LAB,planSocLab,socLabHeight,socLabReach,socLabTop,socLabTriangles} from './socLabPlan';
import {towerTop} from './models';
import {towerRing} from './roads';
import {TRANSPORT} from './transportScale';

const scene=buildScene(layoutMap(catalog));
const tower=scene.towers.find(t=>t.projectId===SOC_LAB.projectId)!;
const plan=planSocLab(tower.customHeight!);

describe('SOC Lab',()=>{
 it('stands among the Financial towers, under Atlas HQ, without moving their reference height',()=>{
  const reference=scene.financial!.referenceHeight;
  expect(tower.customHeight).toBeCloseTo(socLabHeight(reference));
  expect(tower.customHeight!).toBeGreaterThan(tower.height);
  expect(socLabTop(tower.customHeight!)).toBeLessThan(reference);
  expect(headquartersEnvelope(scene.towers)).toBeCloseTo(reference);
  // The shared nameplate sits on the disc crown.
  expect(towerTop(tower)).toBeGreaterThan(plan.top);
 });

 it('has storeys of a believable height and more floors than the generic tower it replaces',()=>{
  expect(plan.storeys).toBeGreaterThan(tower.floors);
  expect(plan.storey).toBeGreaterThan(FLOOR_H*.85);
  expect(plan.storey).toBeLessThan(FLOOR_H*1.15);
 });

 it('has three terraces, each with cyan strips and a planted roof, clear of the lobby and roof',()=>{
  expect(plan.terraces).toHaveLength(3);
  const bandH=SOC_LAB.terraces.storeys*plan.storey;
  for(const [i,y] of plan.terraces.entries()){
   expect(y).toBeGreaterThan(SOC_LAB.lobby.h+1);
   expect(y+bandH).toBeLessThan(plan.height-.5);
   if(i)expect(y-plan.terraces[i-1]).toBeGreaterThan(bandH+plan.storey);
  }
  expect(plan.boxes.filter(b=>b.kind==='cyan')).toHaveLength(12);
  expect(plan.boxes.filter(b=>b.kind==='hedge')).toHaveLength(6);
  expect(plan.boxes.filter(b=>b.kind==='lawn')).toHaveLength(3);
  expect(plan.discs.filter(d=>d.kind==='cyan')).toHaveLength(1);
  for(const b of plan.boxes){expect(b.x1).toBeGreaterThan(b.x0);expect(b.y1).toBeGreaterThan(b.y0);expect(b.z1).toBeGreaterThan(b.z0);}
 });

 it('fills its glass front to the spine line from the lobby roof to the roof, so both faces line up',()=>{
  const front=plan.boxes.find(b=>b.kind==='curtain'&&b.z1===SOC_LAB.front)!;
  expect(front).toBeDefined();
  expect(front.y0).toBe(SOC_LAB.lobby.h);
  expect(front.y1).toBeCloseTo(plan.height);
  expect(SOC_LAB.front).toBeCloseTo(SOC_LAB.spine.z1-.02);
  // The terraces still stand out of it, with room for their gardens.
  expect(SOC_LAB.terraces.z1-SOC_LAB.front).toBeGreaterThan(.1);
 });

 it('braces its steel spine in a zigzag from the ground to the roof',()=>{
  expect(plan.braces.length).toBeGreaterThanOrEqual(4);
  expect(plan.braces[0].y0).toBe(0);
  expect(plan.braces.at(-1)!.y1).toBeCloseTo(plan.height);
  for(const [i,b] of plan.braces.entries())if(i){expect(b.y0).toBeCloseTo(plan.braces[i-1].y1);expect(b.z0).toBeCloseTo(plan.braces[i-1].z1);}
 });

 it('keeps its footprint inside the ring road around it',()=>{
  const reach=socLabReach(plan);
  expect(reach).toBeLessThanOrEqual(.53);
  const ring=towerRing({x:0,z:0,size:tower.size},(tower.size/.92)*1.25+1)!;
  expect(reach*tower.size).toBeLessThan(ring.x1-TRANSPORT.cityWidth/2);
 });

 it('stays light: under 12k triangles and a few hundred instanced parts',()=>{
  expect(socLabTriangles(plan)).toBeLessThan(12000);
  expect(plan.boxes.length+plan.braces.length).toBeLessThan(160);
  expect(plan.plants.filter(p=>p.kind==='tree')).toHaveLength(6);
 });

 it('is drawn in every map grouping',()=>{
  for(const grouping of ['none','district','status','tag'] as GroupBy[]){
   const t=buildScene(layoutMap(catalog,[],grouping)).towers.find(t=>t.projectId===SOC_LAB.projectId);
   expect(t?.customHeight,grouping).toBeGreaterThan(0);
  }
 });
});
