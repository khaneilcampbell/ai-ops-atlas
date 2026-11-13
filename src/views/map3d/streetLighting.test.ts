import {it,expect} from 'vitest';
import {catalog} from '../../catalog';import {layoutMap,type GroupBy} from '../mapLayout';import {buildScene} from './scene';
import {planStreetLights,lightingObstacles,KERB_LAMP,STREET_LIGHT,WALK_CLEAR} from './streetLighting';
import {poolFalloff} from './StreetLights';
import {distanceToRoad} from './highway';
for(const group of ['none','district','status','tag'] as GroupBy[])it(`lights streets without blocking buildings in ${group}`,()=>{
 const s=buildScene(layoutMap(catalog,[],group)),lights=planStreetLights(s),boxes=lightingObstacles(s);
 expect(s.hills).toBeUndefined();
 expect(lights.length).toBeGreaterThan(40);expect(lights.length).toBeLessThanOrEqual(STREET_LIGHT.maxFixtures);expect(lights.some(p=>p.highway)).toBe(false);
 expect(lights.some(p=>p.x>s.financial!.x&&p.x<s.financial!.x+s.financial!.w&&p.z>s.financial!.z&&p.z<s.financial!.z+s.financial!.d),'Financial District has street lighting').toBe(true);
 for(const [i,p]of lights.entries()){expect(Number.isFinite(p.yaw)).toBe(true);expect(boxes.some(b=>Math.abs(p.x-b.x)<b.w/2+.12&&Math.abs(p.z-b.z)<b.d/2+.12)).toBe(false);for(const q of lights.slice(i+1))expect(Math.hypot(p.x-q.x,p.z-q.z)).toBeGreaterThanOrEqual(STREET_LIGHT.minSeparation);}
});
it('stands street lamps on the sidewalk at the kerb, never in the middle of the walk or out on the lawn',()=>{
 // Khaneil, 2026-11-13: fewer lamps, none in the grass, mostly on the sidewalks beside the streets.
 const s=buildScene(layoutMap(catalog,[],'district')),walks=s.transportConnections.map(c=>c.walk),streets=[...s.carBridges.flatMap(b=>b.roads),...s.transportConnections.map(c=>c.road),...(s.financial?[s.financial.street]:[]),...(s.community?.streets??[])];
 const lamps=planStreetLights(s),kerb=lamps.filter(p=>streets.some(r=>distanceToRoad([p.x,p.z],r)<.5));
 expect(kerb.length/lamps.length).toBeGreaterThan(.7);
 for(const p of kerb){
  expect(streets.some(r=>distanceToRoad([p.x,p.z],r)<.32+.08),`lamp at ${p.x.toFixed(2)},${p.z.toFixed(2)} on the carriageway`).toBe(false);
  // The walk is .48 wide on a centre line .6 out: a kerb lamp keeps out of its middle.
  expect(walks.some(w=>distanceToRoad([p.x,p.z],w)<KERB_LAMP.walkMiddle-.01),`lamp at ${p.x.toFixed(2)},${p.z.toFixed(2)} in the walk`).toBe(false);
 }
 // Lawn footpaths are no longer lit.
 expect(lamps.length).toBeLessThan(planStreetLights(s,{lawnWalks:true}).length);
 expect(WALK_CLEAR).toBeGreaterThan(.48/2+.1);
});
it('fades a light pool out to nothing at its rim',()=>{
 const t=poolFalloff(16),d=t.image.data as Uint8Array,at=(x:number,y:number)=>d[(y*16+x)*4];
 expect(at(8,8)).toBeGreaterThan(200);expect(at(0,8)).toBeLessThan(10);expect(at(0,0)).toBe(0);
});
