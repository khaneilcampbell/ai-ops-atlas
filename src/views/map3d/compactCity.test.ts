import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {cityEnvelope} from './citySpacing';
import {squareCityBounds} from './cityPerimeter';
import {pathClear} from './roads';
import {railPoint,railState,stationAccessAreas,COMMUNITY} from './hillsCommunityPlan';

describe('compact city and Marketplace passenger service',()=>{
 for(const group of ['none','district','status','tag'] as GroupBy[])it(`keeps connected square infrastructure in ${group}`,()=>{
  const before=JSON.stringify(catalog),s=buildScene(layoutMap(catalog,[],group)),r=s.communityRail!,m=s.mall!;
  expect(s.hills).toBeUndefined();expect(s.community).toBeUndefined();expect(JSON.stringify(catalog)).toBe(before);
  expect(s.transportConnections.map(c=>c.id)).not.toContain('atlas-hills');
  expect(s.freight).toBeUndefined();
  const e=cityEnvelope(s.land)!;expect(e.w).toBeCloseTo(e.d,6);
  expect(r.route[0]).toEqual(r.hills);expect(r.route.at(-1)).toEqual(r.financial);
  expect(r.hillsWalk[0]).toEqual([m.cx,0,m.z+m.d]);
  const ground=r.hillsWalk.filter(p=>p[1]===0).map(p=>[p[0],p[2]] as [number,number]);
  expect(pathClear(ground,[{x:m.cx,z:m.cz,w:m.w,d:m.d-2.3}],.1)).toBe(true);
  expect(pathClear(r.route,[{x:m.cx,z:m.cz,w:m.w,d:m.d-2.3}],.6)).toBe(true);
  for(const area of stationAccessAreas(r.hills)){
   for(const p of [...s.trees,...s.bushes,...s.bollards])expect(p.x+.25>area.x&&p.x-.25<area.x+area.w&&p.z+.25>area.z&&p.z-.25<area.z+area.d).toBe(false);
   if(s.mallGarden)for(const b of s.mallGarden.boxes.filter(b=>b.h>.03))expect(b.x+b.w/2>area.x&&b.x-b.w/2<area.x+area.w&&b.z+b.d/2>area.z&&b.z-b.d/2<area.z+area.d).toBe(false);
  }
  const travel=r.length/COMMUNITY.speed;
  for(const [time,distance,doors] of [[0,0,1],[15+travel/2,r.length/2,0],[15+travel+1,r.length,1],[30+travel+travel/2,r.length/2,0],[30+travel*2,0,1]]){
   const state=railState(time,r.length);expect(state.distance).toBeCloseTo(distance);expect(state.doors).toBe(doors);const p=railPoint(r,state.distance);expect(Number.isFinite(p.x+p.z+p.yaw)).toBe(true);
  }
 });
 it('expands only the short perimeter axis and preserves the center',()=>{
  expect(squareCityBounds({left:0,right:10,top:0,bottom:6})).toEqual({left:0,right:10,top:-2,bottom:8});
  expect(squareCityBounds({left:0,right:6,top:0,bottom:10})).toEqual({left:-2,right:8,top:0,bottom:10});
 });
});
