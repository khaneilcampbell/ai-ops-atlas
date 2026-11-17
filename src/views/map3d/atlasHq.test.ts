import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {FLOOR_BASE,towerTop} from './models';
import {HQ} from './atlasHqPlan';
import {CC,ccBay,ccDoor,ccEntrance,ccFootprint,ccLedges,ccRoof,ccTop} from './commandCenterPlan';
import {ccGeometry,ccTriangles} from './commandCenterGeometry';
import {HQ_INTERIOR} from '../office/atlasHqInteriorPlan';
import {HQ_PALETTE} from './atlasHqPalette';

describe('Atlas Command Center',()=>{
 it('fits inside the old square footprint, so the parcel, plaza, roads and links stay put',()=>{
  for(const k of [.8,1,1.3])for(const [x,z] of ccFootprint(k)){
   expect(Math.abs(x)).toBeLessThanOrEqual(HQ.refSize*k/2);
   expect(Math.abs(z)).toBeLessThanOrEqual(HQ.refSize*k/2);
  }
 });
 it('is the lobby and four office floors you walk through inside, at the interior\'s own storey heights',()=>{
  expect(CC.floors).toBe(HQ_INTERIOR.floors-1);
  expect(CC.lobby*HQ_INTERIOR.scale).toBeCloseTo(HQ_INTERIOR.lobbyHeight);
  expect(CC.storey*HQ_INTERIOR.scale).toBeCloseTo(HQ_INTERIOR.height);
  // A stone ledge over the lobby and over each office floor; the last one is the roof.
  const k=1.4,l=ccLedges(k);
  expect(l).toHaveLength(5);expect(l[0]).toBeCloseTo(CC.lobby*k);expect(l[4]).toBeCloseTo(ccRoof(k));
  // The plan keeps the floor plates' proportions: wider than deep, rounded corners.
  expect(CC.roundness).toBe(HQ_INTERIOR.roundness);
 });
 it('puts its nameplate, selection box and inside view on its real roof, for every grouping',()=>{
  for(const grouping of ['none','district','status','tag'] as GroupBy[]){
   const scene=buildScene(layoutMap(catalog,[],grouping)),hq=scene.towers.find(t=>t.projectId==='ai-ops-atlas')!;
   expect(hq.identity.landmark).toBe(true);
   expect(towerTop(hq)).toBeCloseTo(FLOOR_BASE+ccTop(hq.size/HQ.refSize)+.04);
   // The shared opening glass doors stand in the stone bay's face, centred on it.
   const door=ccDoor(hq,FLOOR_BASE),k=hq.size/HQ.refSize;
   expect(door.p[0]).toBeCloseTo(hq.x);expect(door.p[2]-hq.z).toBeGreaterThanOrEqual(ccBay(k).front);
   expect(door.s[0]).toBeLessThan(ccBay(k).w);
  }
 });
 it('stays inside its performance budget: a handful of merged meshes, few instances, no lights',()=>{
  const geo=ccGeometry(2),meshes=Object.values(geo).filter(v=>typeof v==='object'&&'isBufferGeometry' in v).length;
  expect(meshes).toBeLessThanOrEqual(8);
  const e=ccEntrance(2);
  expect(e.boxes.length+e.lamps.length+geo.trees.length*2+4).toBeLessThan(40);
  expect(ccTriangles(geo)).toBeLessThan(12000);
  const source=readFileSync(join(__dirname,'AtlasHq.tsx'),'utf8');
  expect(source).not.toMatch(/<(point|spot|directional|ambient|hemisphere|rectArea)Light/);
  expect(source).not.toMatch(/useFrame/);
 });
 it('keeps brass restrained: one hairline, the door header and canopy, the lettering',()=>{
  const brass=ccEntrance(1).boxes.filter(b=>b[6]===HQ_PALETTE.brass);
  expect(brass).toHaveLength(2);
  const source=readFileSync(join(__dirname,'AtlasHq.tsx'),'utf8');
  expect(source.match(/mats\.brass/g)).toHaveLength(1);
 });
 it('has file names that stay distinct on a case-insensitive Mac disk',()=>{
  const seen=new Map<string,string>();
  for(const f of readdirSync(__dirname)){const low=f.toLowerCase();expect(seen.get(low)??f).toBe(f);seen.set(low,f);}
 });
});
