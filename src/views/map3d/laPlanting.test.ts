import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';import {layoutMap,type GroupBy} from '../mapLayout';import {buildScene} from './scene';
import {laPlanting,laShrubKind,laTreeKind,fanPalm,datePalm,emptyParts} from './laPlanting';
import {airportFootprint} from './airport';
import {planStreetLights,lightingObstacles} from './streetLighting';
import {planStreetPalms,STREET_PALMS} from './streetPalms';
import {distanceToRoad} from './highway';

describe('Los Angeles planting',()=>{
 const s=buildScene(layoutMap(catalog,[],'district'));
 it('thins the lawns and keeps palms as specimens among olive, ficus, cypress and jacaranda (luxury, not jungle)',()=>{
  const drawn=s.trees.filter(t=>t.kind!=='palm'),kinds=drawn.map(laTreeKind).filter(k=>k!==null),share=(k:string)=>kinds.filter(x=>x===k).length/kinds.length;
  expect(kinds.length).toBeGreaterThan(80);
  expect(kinds.length/drawn.length).toBeLessThan(.8);
  expect(share('fan')+share('date')).toBeGreaterThan(.15);
  expect(share('fan')+share('date')).toBeLessThan(.4);
  for(const k of ['fan','date','olive','ficus','jacaranda','cypress'])expect(share(k),k).toBeGreaterThan(0);
 });
 it('leaves the stadium palms to the stadium and keeps old blossom trees flowering, now jacaranda',()=>{
  expect(laTreeKind({x:1,z:1,kind:'palm'})).toBeNull();
  expect(laTreeKind({x:1,z:1,kind:'blossom'})).toBe('jacaranda');
  expect(['cypress',null]).toContain(laTreeKind({x:3.2,z:7.1,kind:'cone'}));
  expect(laTreeKind({x:3.2,z:7.1,kind:'avenue'})).toBe('avenue');
 });
 it('picks the same plant for the same spot every time',()=>{
  const a=laPlanting(s.trees,s.bushes),b=laPlanting(s.trees,s.bushes);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  const shrubs=s.bushes.map(laShrubKind);
  expect(new Set(shrubs)).toEqual(new Set(['hedge','agave','paradise','bougainvillea']));
  expect(shrubs.filter(k=>k==='hedge').length/shrubs.length).toBeGreaterThan(.4);
 });
 it('stands avenue palms upright at one height',()=>{
  const a=emptyParts(),b=emptyParts();fanPalm(a,1,0,2,.26,true);fanPalm(b,7.3,0,-4.1,.26,true);
  expect(a.trunks[0].s[1]).toBe(b.trunks[0].s[1]);expect(a.trunks[0].rx).toBe(0);
 });
 it('builds a fan palm tall and thin and a date palm short and full',()=>{
  const fan=emptyParts(),date=emptyParts();fanPalm(fan,0,0,0,.3);datePalm(date,0,0,0,.3);
  const fanH=fan.trunks[0].s[1],dateH=date.trunks[0].s[1];
  expect(fanH).toBeGreaterThan(dateH*1.5);
  expect(fan.trunks[0].s[0]).toBeLessThan(date.trunks[0].s[0]);
  const reach=(o:typeof fan)=>Math.max(...o.leaves.map(f=>Math.hypot(f.p[0],f.p[2])+f.s[2]/2));
  expect(reach(date)).toBeGreaterThan(reach(fan));
  // A leaning fan palm's crown still sits on top of its trunk.
  const top=fan.clumps[0].p;expect(Math.hypot(top[0],top[2])).toBeLessThan(fanH*.07);
 });
 it('draws a palm in far fewer triangles than the round tree it replaces',()=>{
  const o=emptyParts();fanPalm(o,0,0,0,.3);
  const palm=o.trunks.length*24+o.leaves.length*4+o.fronds.length*12+o.clumps.length*80,round=24+4*80;
  // Even against the round tree's far (overview) canopies.
  expect(palm).toBeLessThan(round*.6);
 });
});

for(const group of ['none','district','status','tag'] as GroupBy[])it(`plants formal palm avenues on the streets only, clear of the airport, lamps and buildings in ${group}`,()=>{
 const s=buildScene(layoutMap(catalog,[],group)),palms=planStreetPalms(s),lamps=planStreetLights(s),boxes=lightingObstacles(s),walks=s.transportConnections.map(c=>c.walk);
 expect(palms.length).toBeGreaterThan(20);expect(palms.length).toBeLessThanOrEqual(STREET_PALMS.max);
 const a=s.airport&&airportFootprint(s.airport);
 for(const p of palms){
  expect(laTreeKind(p)).toBe('avenue');
  expect(boxes.some(b=>Math.abs(p.x-b.x)<b.w/2+.12&&Math.abs(p.z-b.z)<b.d/2+.12)).toBe(false);
  expect(lamps.some(l=>Math.hypot(l.x-p.x,l.z-p.z)<STREET_PALMS.lampClear)).toBe(false);
  expect(walks.some(w=>distanceToRoad([p.x,p.z],w)<.4)).toBe(false);
  if(a)expect(p.x>a.x-STREET_PALMS.airportMargin&&p.x<a.x+a.w+STREET_PALMS.airportMargin&&p.z>a.z-STREET_PALMS.airportMargin&&p.z<a.z+a.d+STREET_PALMS.airportMargin,`palm at ${p.x},${p.z} on the airport`).toBe(false);
 }
});
