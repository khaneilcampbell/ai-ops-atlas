import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {towerTop} from './models';
import {HQ,footprint,hqPieceCount,towerOutline,towerRoof,wingSway} from './atlasHqPlan';
import {hqGeometry,hqTriangles} from './atlasHqGeometry';

describe('Atlas HQ',()=>{
 it('fits inside the old square footprint, so the plaza, fountain, roads and links stay put',()=>{
  for(const k of [.8,1,1.3])for(const [x,z] of footprint(k)){
   expect(Math.abs(x)).toBeLessThanOrEqual(HQ.refSize*k/2);
   expect(Math.abs(z)).toBeLessThanOrEqual(HQ.refSize*k/2);
  }
 });
 it('keeps 21 storeys of 3.6 m under a roof sloping from 81 m to 74 m',()=>{
  expect(HQ.floors*HQ.floor).toBeLessThan(HQ.roofLow);
  const xs=towerOutline().map(([x])=>x);
  expect(towerRoof(Math.min(...xs))).toBeCloseTo(HQ.roofHigh,1);
  expect(towerRoof(Math.max(...xs))).toBeLessThan(HQ.roofHigh);
  // 81.2 m / 74 m in the elevations.
  expect(HQ.roofLow/HQ.roofHigh).toBeCloseTo(74/81.2,1);
  expect(HQ.wingTop).toBeLessThan(HQ.roofLow);
 });
 it('sways the gold wing in an S that leans into the tower and back out',()=>{
  const at=(t:number)=>wingSway(t).x;
  expect(at(.25)).toBeLessThan(at(0));
  expect(at(.75)).toBeGreaterThan(at(0));
  // At its deepest the wing overlaps the tower, so the two read as one building.
  const towerEast=Math.max(...towerOutline().map(([x])=>x));
  expect(at(.25)-.27).toBeLessThan(towerEast);
 });
 it('stays the tallest project building, under the Financial District towers',()=>{
  for(const grouping of ['none','district','status','tag'] as GroupBy[]){
   const scene=buildScene(layoutMap(catalog,[],grouping)),hq=scene.towers.find(t=>t.projectId==='ai-ops-atlas')!;
   expect(hq.identity.landmark).toBe(true);
   const top=towerTop(hq);
   for(const t of scene.towers.filter(t=>t!==hq))expect(top).toBeGreaterThan(towerTop(t));
   for(const b of scene.financial?.buildings??[])expect(b.height).toBeGreaterThan(top);
  }
 });
 it('stays inside its performance budget: a dozen merged meshes, few instances, no lights',()=>{
  const pieces=hqPieceCount(),geo=hqGeometry(1);
  expect(pieces.meshes).toBeLessThanOrEqual(14);
  expect(pieces.instances).toBeLessThan(120);
  expect(geo.podiumFins.length+geo.trees.length*2).toBeLessThan(120);
  expect(hqTriangles(geo)).toBeLessThan(16000);
  const source=readFileSync(join(__dirname,'AtlasHq.tsx'),'utf8');
  expect(source).not.toMatch(/<(point|spot|directional|ambient|hemisphere|rectArea)Light/);
  expect(source).not.toMatch(/useFrame/);
 });
 it('has file names that stay distinct on a case-insensitive Mac disk',()=>{
  const seen=new Map<string,string>();
  for(const f of readdirSync(__dirname)){const low=f.toLowerCase();expect(seen.get(low)??f).toBe(f);seen.set(low,f);}
 });
});
