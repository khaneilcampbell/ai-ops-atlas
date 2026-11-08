import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {PLAZA_WHEEL,planStationPlaza} from './stationPlazaPlan';
import {distanceToRoad} from './highway';

describe('Stadium Station wheel plaza',()=>{
 it('requires an existing stadium and station',()=>expect(planStationPlaza({})).toBeUndefined());
 for(const mode of ['none','district','status','tag'] as const)it(`keeps the wheel and pavilion on clear meadow in ${mode}`,()=>{
  const s=buildScene(layoutMap(catalog,[],mode)),p=s.stationPlaza!,st=s.stadium!,stop=s.communityRail!.loop!.stops.find(st=>st.id==='service:stadium-station')!;
  expect(p).toBeDefined();
  const boxes=[{x:p.wheel.x-PLAZA_WHEEL.width/2,z:p.wheel.z-PLAZA_WHEEL.depth/2,w:PLAZA_WHEEL.width,d:PLAZA_WHEEL.depth},p.building];
  for(const b of boxes){
   for(let x=b.x;x<=b.x+b.w;x+=.2)for(let z=b.z;z<=b.z+b.d;z+=.2)expect(s.land.some(l=>x>=l.x-.001&&x<=l.x+l.w+.001&&z>=l.z-.001&&z<=l.z+l.d+.001)).toBe(true);
   expect(b.x).toBeGreaterThan(st.x+st.w+.4);
   expect(b.z+b.d).toBeLessThan(stop.point[1]-3);
   for(const point of [[b.x,b.z],[b.x+b.w,b.z+b.d]] as [number,number][])expect(distanceToRoad(point,stop.walk.map(p=>[p[0],p[2]]))).toBeGreaterThan(.5);
   for(const tree of s.trees)expect(tree.x>=b.x-.3&&tree.x<=b.x+b.w+.3&&tree.z>=b.z-.3&&tree.z<=b.z+b.d+.3).toBe(false);
  }
  const ground=[...stop.walk].reverse().find(p=>p[1]===0)!;
  expect(p.walk.at(-1)).toEqual([ground[0],ground[2]]);
  expect(p.building.z).toBeGreaterThan(p.wheel.z+PLAZA_WHEEL.depth/2+2);
 });
});
