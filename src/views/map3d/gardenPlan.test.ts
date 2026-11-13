import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {GARDEN,gardenParts,gardenRect,planGardens} from './gardenPlan';
import {distanceToRoad} from './highway';

const overlaps=(a:{x:number;z:number;w:number;d:number},b:{x:number;z:number;w:number;d:number})=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.z<b.z+b.d&&a.z+a.d>b.z;

describe('topiary gardens',()=>{
 for(const grouping of ['district','tag','status','none'] as const)it(`stand on open lawn, clear of buildings and streets (${grouping})`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),gardens=s.gardens??[];
  // A few well-placed gardens, not shrubs everywhere (Khaneil, 2026-11-13).
  expect(gardens.length).toBeGreaterThan(0);
  expect(gardens.length).toBeLessThanOrEqual(GARDEN.max);
  for(const [i,g]of gardens.entries()){
   const r=gardenRect(g);
   for(const h of gardens.slice(i+1))expect(Math.hypot(g.x-h.x,g.z-h.z)).toBeGreaterThanOrEqual(GARDEN.spacing);
   for(const t of [...s.towers,...s.kiosks])expect(overlaps(r,{x:t.x-t.size/2,z:t.z-t.size/2,w:t.size,d:t.size})).toBe(false);
   for(const p of s.paving)expect(overlaps(r,p)).toBe(false);
   for(const lot of [s.mall,s.galleria?.rect,s.commons?.rect,s.stationPlaza?.bounds,s.financial,s.financial?.circa,s.dealership])if(lot)expect(overlaps(r,lot)).toBe(false);
   for(const c of s.transportConnections)for(const road of [c.road,c.walk])expect(distanceToRoad([g.x,g.z],road)).toBeGreaterThan(GARDEN.size/2);
   for(const b of s.carBridges)for(const road of b.roads)expect(distanceToRoad([g.x,g.z],road)).toBeGreaterThan(GARDEN.size/2);
   // The lawn's loose trees and shrubs give way to the garden.
   for(const t of [...s.trees,...s.bushes])expect(t.x>r.x&&t.x<r.x+r.w&&t.z>r.z&&t.z<r.z+r.d).toBe(false);
  }
 });
 it('finds no garden without open ground, and keeps the pieces cheap',()=>{
  expect(planGardens({ground:[],obstacles:[],paths:[]})).toEqual([]);
  expect(planGardens({ground:[{x:0,z:0,w:40,d:40}],obstacles:[{x:0,z:0,w:40,d:40}],paths:[]})).toEqual([]);
  const open=planGardens({ground:[{x:0,z:0,w:80,d:80}],obstacles:[],paths:[]});
  expect(open.map(g=>g.centre)).toEqual(['knight','tiered','ball']);
  const parts=gardenParts(open,.6),count=Object.values(parts).reduce((n,l)=>n+l.length,0);
  expect(count).toBeLessThan(450);
 });
});
