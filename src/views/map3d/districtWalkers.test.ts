import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {financialDimensions} from './financialArchitecture';
import {pathClear,type Pt} from './roads';
import {DISTRICT_WALKERS,crowdLimit,planDistrictWalkers,walkerAt,walkerPeriod} from './districtWalkers';

describe('Financial District sidewalk walkers',()=>{
 for(const group of ['none','district','status','tag'] as GroupBy[])it(`walk between real tower doors on the sidewalk: ${group}`,()=>{
  const f=buildScene(layoutMap(catalog,[],group)).financial!,walkers=planDistrictWalkers(f);
  expect(walkers.length).toBeGreaterThanOrEqual(DISTRICT_WALKERS.count-2);
  expect(new Set(walkers.flatMap(w=>[w.from,w.to])).size,'many towers used').toBeGreaterThanOrEqual(6);
  const offices=f.buildings.map(b=>({x:f.x+b.x,z:f.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d}));
  for(const w of walkers){
   expect(w.from).not.toBe(w.to);
   expect(pathClear(w.route.points.map(p=>[p[0],p[2]] as Pt),offices,.05),w.id).toBe(true);
   // They go inside both towers between walks, and move smoothly without jumps while outside.
   const seen=new Set<string>();let last:{x:number;z:number}|undefined;
   for(let t=0;t<walkerPeriod(w)+1;t+=.1){const at=walkerAt(w,t);if(at.visible){if(last)expect(Math.hypot(at.x-last.x,at.z-last.z)).toBeLessThan(w.pace*.1+.02);last=at;}else{seen.add(at.inside);last=undefined;}}
   expect(seen).toEqual(new Set([w.from,w.to]));
  }
  // Staggered: at any moment some are out on the sidewalk and some are indoors.
  const out=walkers.filter(w=>walkerAt(w,30).visible).length;expect(out).toBeGreaterThan(2);expect(out).toBeLessThan(walkers.length);
 });
 it('draws fewer people as quality drops or on Battery saver, never fewer than KC\'s twelve commuters',()=>{
  expect(crowdLimit(60,{qualityLevel:0,saver:false})).toBe(60);
  expect(crowdLimit(60,{qualityLevel:2,saver:false})).toBe(36);
  expect(crowdLimit(60,{qualityLevel:0,saver:true})).toBe(36);
  expect(crowdLimit(60,{qualityLevel:3,saver:true})).toBe(18);
  expect(crowdLimit(8,{qualityLevel:3,saver:true})).toBe(8);
 });
});
