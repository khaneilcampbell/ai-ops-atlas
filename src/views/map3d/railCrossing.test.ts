import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {railCrossings,railCrossingParts,RAIL_CROSSING} from './railCrossing';
import {marinaSite,marinaFootprint} from './marinaPlan';
import {COMMUNITY as C} from './hillsCommunityPlan';
import {loopPoint} from './perimeterRailPlan';

describe('ground-level shore railway and its level crossings',()=>{
 for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`crosses the walk to the yacht dock on the ground: ${grouping}`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),p=s.communityRail!.loop!;
  const walks=s.walks.map(w=>[[w.x0,w.z0],[w.x1,w.z1]] as [[number,number],[number,number]]);
  const crossings=railCrossings(p.route,walks,s.transportConnections.flatMap(c=>c.road.slice(1).map((b,k)=>[c.road[k],b] as [[number,number],[number,number]])));
  // No street meets the shore track; the walks that do cross it all cross on land.
  expect(crossings.filter(c=>c.kind==='road')).toEqual([]);
  for(const c of crossings)expect(s.land.some(r=>c.at[0]>=r.x&&c.at[0]<=r.x+r.w&&c.at[1]>=r.z&&c.at[1]<=r.z+r.d)).toBe(true);
  if(grouping!=='district')return;
  // The Events Arena forecourt's walk to the marina stair crosses once, clear of the stair, pier and dock.
  const harbor=marinaSite(s,.6),dock=crossings.filter(c=>Math.abs(c.at[0]-harbor.x)<.05);
  expect(dock).toHaveLength(1);
  // Every part stands on land, short of the stair head at the shore, and the stair, pier and dock stay where they were.
  const parts=railCrossingParts(dock[0],false);
  for(const part of parts)expect(part.p[2]+part.s[2]/2,`crossing part over the shore at ${part.p}`).toBeLessThan(harbor.shoreZ-.05);
  expect(marinaFootprint(harbor)).toEqual({x:2.5-2.5,z:harbor.pierZ-2.6,w:5,d:4.2});expect(harbor.x).toBeCloseTo(2.5,5);
 });
 it('lays a flush deck between the rails with a signal post on each approach',()=>{
  const c={at:[0,0] as [number,number],dir:[0,1] as [number,number],width:RAIL_CROSSING.walkWidth,kind:'walk' as const},parts=railCrossingParts(c,true);
  const deck=parts[0];expect(deck.p[1]+deck.s[1]).toBeCloseTo(C.railRise+.07,5);expect(deck.s[1]+deck.p[1]).toBeLessThan(C.railRise+.045+.05);
  expect(parts.filter(p=>p.light)).toHaveLength(2);expect(parts.filter(p=>p.light).every(p=>p.c==='#ff5a4a')).toBe(true);
  // The posts stand off the walk, one each side, beyond the deck.
  const poles=parts.filter(p=>p.s[0]===.04);expect(poles).toHaveLength(2);for(const pole of poles){expect(Math.abs(pole.p[0])).toBeGreaterThan(c.width/2);expect(Math.abs(pole.p[2])).toBeGreaterThan(RAIL_CROSSING.span/2);}
 });
 it('keeps the stations where they were on the shore',()=>{
  const p=buildScene(layoutMap(catalog,[],'district')).communityRail!.loop!,stadium=p.stops.find(s=>s.id==='service:stadium-station')!;
  expect(stadium.point[0]).toBeCloseTo(-6.322,2);expect(stadium.point[1]).toBeCloseTo(57.957,2);expect(loopPoint(p,stadium.distance).x).toBeCloseTo(stadium.point[0]);
 });
});
