import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene,TERRACE_H} from './scene';
import {towerTop} from './models';
import {HQ,core,entrance,footprint,hqPieceCount,hqTop,outline,plateScale,storey} from './atlasHqPlan';
import {hqGeometry,hqTriangles} from './atlasHqGeometry';
import {planOffice} from '../office/model';
import {HQ_INTERIOR,shellAxes,shellOutline} from '../office/atlasHqInteriorPlan';

describe('Atlas HQ',()=>{
 it('fits inside the old square footprint, so the plaza, fountain, roads and links stay put',()=>{
  for(const k of [.8,1,1.5])for(const [x,z] of footprint(k)){
   expect(Math.abs(x)).toBeLessThanOrEqual(HQ.refSize*k/2);
   expect(Math.abs(z)).toBeLessThanOrEqual(HQ.refSize*k/2);
  }
 });
 it('is the interior floor plate at map scale: same outline, mullions, level spacing and floors',()=>{
  const project=catalog.projects.find(p=>p.id==='ai-ops-atlas')!,plan=planOffice(project,catalog.agents.filter(a=>a.projectId===project.id));
  const {a,b}=shellAxes(plan.w,plan.d);
  // The plate HQ.plate records is the current interior's (within a desk's width as the plan grows).
  expect(Math.abs(HQ.plate.a-a)).toBeLessThan(.8);expect(Math.abs(HQ.plate.b-b)).toBeLessThan(.8);
  expect(Math.abs(HQ.plate.a/HQ.plate.b-a/b)).toBeLessThan(.05);
  const s=plateScale(1.5),inside=shellOutline(plan.w,plan.d),out=outline(1.5);
  expect(out).toHaveLength(inside.length);expect(HQ_INTERIOR.points).toBe(HQ.plate.points);
  out.forEach(([x,z],i)=>{expect(x/(HQ.plate.a*s)).toBeCloseTo(inside[i][0]/a,6);expect(z/(HQ.plate.b*s)).toBeCloseTo(inside[i][1]/b,6);});
  // A lobby and four office floors at the interior's 3.4 level spacing; the entrance on the +z front, like inside.
  expect(HQ.plate.levels).toBe(HQ_INTERIOR.floors);expect(hqTop(1.5)/storey(1.5)).toBe(5);
  expect(entrance(1.5).z0).toBeLessThan(HQ.plate.b*s);expect(entrance(1.5).z1).toBeGreaterThan(HQ.plate.b*s);
  // The lift core stands at the back, inside the glass, and rises through the roof.
  const c=core(1.5);expect(c.z-c.d/2).toBeGreaterThan(-HQ.plate.b*s);expect(c.z).toBeLessThan(0);expect(c.h).toBeGreaterThan(hqTop(1.5));
 });
 it('stands as tall as its floors in every grouping, with the label and hit area on top of it',()=>{
  for(const grouping of ['none','district','status','tag'] as GroupBy[]){
   const scene=buildScene(layoutMap(catalog,[],grouping)),hq=scene.towers.find(t=>t.projectId==='ai-ops-atlas')!;
   expect(hq.identity.landmark).toBe(true);
   const k=hq.size/HQ.refSize;
   expect(hq.customHeight).toBeCloseTo(core(k).h);
   expect(towerTop(hq)).toBeGreaterThan(TERRACE_H+hqTop(k));
  }
 });
 it('stays inside its performance budget: under a dozen merged meshes, few instances, no lights',()=>{
  const pieces=hqPieceCount(),geo=hqGeometry(2);
  expect(pieces.meshes).toBeLessThanOrEqual(12);
  expect(pieces.instances).toBeLessThan(20);
  expect(hqTriangles(geo)).toBeLessThan(6000);
  const source=readFileSync(join(__dirname,'AtlasHq.tsx'),'utf8');
  expect(source).not.toMatch(/<(point|spot|directional|ambient|hemisphere|rectArea)Light/);
  expect(source).not.toMatch(/useFrame/);
 });
 it('has file names that stay distinct on a case-insensitive Mac disk',()=>{
  const seen=new Map<string,string>();
  for(const f of readdirSync(__dirname)){const low=f.toLowerCase();expect(seen.get(low)??f).toBe(f);seen.set(low,f);}
 });
});
