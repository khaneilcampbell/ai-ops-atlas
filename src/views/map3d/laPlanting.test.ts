import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';import {layoutMap,type GroupBy} from '../mapLayout';import {buildScene} from './scene';
import {laPlanting,laShrubKind,laTreeKind,fanPalm,datePalm,emptyParts} from './laPlanting';
import {planStreetLights,lightingObstacles} from './streetLighting';
import {planStreetPalms,STREET_PALMS} from './streetPalms';
import {distanceToRoad} from './highway';

describe('Los Angeles planting',()=>{
 const s=buildScene(layoutMap(catalog,[],'district'));
 it('makes most of the trees palms, with a few ficus, jacaranda and cypress',()=>{
  const kinds=s.trees.map(laTreeKind).filter(k=>k!==null),share=(k:string)=>kinds.filter(x=>x===k).length/kinds.length;
  expect(kinds.length).toBeGreaterThan(100);
  expect(share('fan')+share('date')).toBeGreaterThan(.65);
  for(const k of ['fan','date','ficus','jacaranda','cypress'])expect(share(k),k).toBeGreaterThan(0);
 });
 it('leaves the stadium palms to the stadium and keeps old blossom trees flowering, now jacaranda',()=>{
  expect(laTreeKind({x:1,z:1,kind:'palm'})).toBeNull();
  expect(laTreeKind({x:1,z:1,kind:'blossom'})).toBe('jacaranda');
  expect(['cypress','fan']).toContain(laTreeKind({x:3.2,z:7.1,kind:'cone'}));
 });
 it('picks the same plant for the same spot every time',()=>{
  const a=laPlanting(s.trees,s.bushes),b=laPlanting(s.trees,s.bushes);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(new Set(s.bushes.map(laShrubKind))).toEqual(new Set(['hedge','agave','paradise','bougainvillea']));
 });
 it('builds a fan palm tall and thin and a date palm short and full',()=>{
  const fan=emptyParts(),date=emptyParts();fanPalm(fan,0,0,0,.3);datePalm(date,0,0,0,.3);
  const fanH=fan.trunks[0].s[1],dateH=date.trunks[0].s[1];
  expect(fanH).toBeGreaterThan(dateH*1.5);
  expect(fan.trunks[0].s[0]).toBeLessThan(date.trunks[0].s[0]);
  const reach=(o:typeof fan)=>Math.max(...o.fronds.map(f=>Math.hypot(f.p[0],f.p[2])+f.s[2]/2));
  expect(reach(date)).toBeGreaterThan(reach(fan));
  // A leaning fan palm's crown still sits on top of its trunk.
  const top=fan.clumps[0].p;expect(Math.hypot(top[0],top[2])).toBeLessThan(fanH*.07);
 });
 it('draws a palm in far fewer triangles than the round tree it replaces',()=>{
  const o=emptyParts();fanPalm(o,0,0,0,.3);
  const palm=o.trunks.length*24+o.fronds.length*12+o.clumps.length*160,round=24+4*320;
  expect(palm).toBeLessThan(round/2);
 });
});

for(const group of ['none','district','status','tag'] as GroupBy[])it(`lines the streets with palms clear of roads, walks, lamps and buildings in ${group}`,()=>{
 const s=buildScene(layoutMap(catalog,[],group)),palms=planStreetPalms(s),lamps=planStreetLights(s),boxes=lightingObstacles(s),walks=s.transportConnections.map(c=>c.walk);
 expect(palms.length).toBeGreaterThan(100);expect(palms.length).toBeLessThanOrEqual(STREET_PALMS.max);
 for(const p of palms){
  expect(['fan','date']).toContain(laTreeKind(p));
  expect(boxes.some(b=>Math.abs(p.x-b.x)<b.w/2+.12&&Math.abs(p.z-b.z)<b.d/2+.12)).toBe(false);
  expect(lamps.some(l=>Math.hypot(l.x-p.x,l.z-p.z)<STREET_PALMS.lampClear)).toBe(false);
  expect(walks.some(w=>distanceToRoad([p.x,p.z],w)<.4)).toBe(false);
 }
});
