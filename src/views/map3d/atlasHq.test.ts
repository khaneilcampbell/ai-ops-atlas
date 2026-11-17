import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene,TERRACE_H} from './scene';
import {headquartersEnvelope} from './financialPlan';
import {CUSTOM_TOWER_SHARE} from './customTowers';
import {towerTop} from './models';
import {HQ,canopyAt,entrance,footprint,hqPieceCount,lobby,towerOutline,towerRoof,wingSway} from './atlasHqPlan';
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
 it('stays the tallest project building, among the Financial District towers',()=>{
  for(const grouping of ['none','district','status','tag'] as GroupBy[]){
   const scene=buildScene(layoutMap(catalog,[],grouping)),hq=scene.towers.find(t=>t.projectId==='ai-ops-atlas')!;
   expect(hq.identity.landmark).toBe(true);
   const top=towerTop(hq);
   for(const t of scene.towers.filter(t=>t!==hq))expect(top).toBeGreaterThan(towerTop(t));
   // Financial towers stand on the terrace; their heights are measured from it.
   // Since the district came down to the map's scale (2026-11-09) Atlas HQ stands among its towers:
   // above its shortest, under its tallest and under Ellipse Residences.
   const heights=(scene.financial?.buildings??[]).map(b=>b.height);
   if(scene.financial){expect(top-TERRACE_H).toBeGreaterThan(Math.min(...heights));expect(top-TERRACE_H).toBeLessThan(Math.max(...heights.slice(0,-1)));expect(top-TERRACE_H).toBeLessThan(Math.max(...heights));}
   expect(hq.customHeight).toBeCloseTo(headquartersEnvelope(scene.towers)*CUSTOM_TOWER_SHARE.atlas);
  }
 });
 it('stays inside its performance budget: a dozen merged meshes, few instances, no lights',()=>{
  // At the tallest the city scale can make it: twice the reference drawing's height.
  const pieces=hqPieceCount(),geo=hqGeometry(1,2);
  expect(pieces.meshes).toBeLessThanOrEqual(14);
  expect(pieces.instances).toBeLessThan(120);
  expect(geo.podiumFins.length+geo.trees.length*2).toBeLessThan(120);
  expect(hqTriangles(geo)).toBeLessThan(26000);
  const source=readFileSync(join(__dirname,'AtlasHq.tsx'),'utf8');
  expect(source).not.toMatch(/<(point|spot|directional|ambient|hemisphere|rectArea)Light/);
  expect(source).not.toMatch(/useFrame/);
 });
 it('dresses the front door like the Financial District entrances, under the canopy and on the lobby front',()=>{
  const k=1,{boxes,lamps}=entrance(k),L=lobby(k);
  const top=Math.max(...boxes.map(([,y,,,h])=>y+h)),door=boxes.filter(b=>b[6]==='#bcd6dc');
  // A double glass door, centred under the ATLAS HQ lettering, standing on the lobby glass line.
  expect(door).toHaveLength(2);expect((door[0][0]+door[1][0])/2).toBeCloseTo(-.32*k);
  for(const b of door){expect(b[2]).toBeGreaterThanOrEqual(L.z);expect(b[1]+b[4]).toBeLessThan(L.h);}
  // Everything sits below the wavy canopy and inside the lobby's width.
  expect(top).toBeLessThan(Math.min(...Array.from({length:11},(_,i)=>canopyAt(i/10,k).y)));
  for(const [x,,,w] of [...boxes,...lamps]){expect(x-w/2).toBeGreaterThanOrEqual(L.x0-1e-9);expect(x+w/2).toBeLessThanOrEqual(L.x1+1e-9);}
  // The planters stand clear of the landing, so the way in stays open.
  const landing=boxes.find(b=>b[6]==='#e5dfd0')!;
  for(const p of boxes.filter(b=>b[6]==='#3f6b4f'))expect(Math.abs(p[0]-landing[0])).toBeGreaterThan((p[3]+landing[3])/2);
  expect(lamps).toHaveLength(2);
 });
 it('has file names that stay distinct on a case-insensitive Mac disk',()=>{
  const seen=new Map<string,string>();
  for(const f of readdirSync(__dirname)){const low=f.toLowerCase();expect(seen.get(low)??f).toBe(f);seen.set(low,f);}
 });
});
