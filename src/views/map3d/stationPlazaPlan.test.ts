import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {PLAZA_ROAD_CLEARANCE,PLAZA_WALK_CLEARANCE,planStationPlaza,wheelBase} from './stationPlazaPlan';
import {distanceToRoad} from './highway';

describe('Stadium Station wheel plaza',()=>{
 it('requires an existing stadium and station',()=>expect(planStationPlaza({})).toBeUndefined());
 for(const mode of ['none','district','status','tag'] as const)it(`keeps the wheel and pavilion on clear meadow, off every street, in ${mode}`,()=>{
  const s=buildScene(layoutMap(catalog,[],mode)),p=s.stationPlaza!,st=s.stadium!,stop=s.communityRail!.loop!.stops.find(st=>st.id==='service:stadium-station')!;
  expect(p).toBeDefined();
  const roads=s.transportConnections.map(c=>c.road),stationWalk=stop.walk.map(q=>[q[0],q[2]] as [number,number]);
  const buildings=[...s.towers,...s.kiosks].map(b=>({x:b.x-b.size/2,z:b.z-b.size/2,w:b.size,d:b.size}));
  for(const b of [wheelBase(p),p.building]){
   for(let x=b.x;x<=b.x+b.w;x+=.2)for(let z=b.z;z<=b.z+b.d;z+=.2){
    expect(s.land.some(l=>x>=l.x-.001&&x<=l.x+l.w+.001&&z>=l.z-.001&&z<=l.z+l.d+.001)).toBe(true);
    for(const r of roads)expect(distanceToRoad([x,z],r)).toBeGreaterThanOrEqual(PLAZA_ROAD_CLEARANCE);
    expect(distanceToRoad([x,z],stationWalk)).toBeGreaterThan(.5);
   }
   // Clear of the stadium's own lot and of every other building.
   expect(b.x>st.x+st.w+2||b.x+b.w<st.x-2||b.z>st.z+st.d+2||b.z+b.d<st.z-2).toBe(true);
   for(const o of buildings)expect(b.x<o.x+o.w&&o.x<b.x+b.w&&b.z<o.z+o.d&&o.z<b.z+b.d).toBe(false);
   for(const tree of s.trees)expect(tree.x>=b.x-.3&&tree.x<=b.x+b.w+.3&&tree.z>=b.z-.3&&tree.z<=b.z+b.d+.3).toBe(false);
  }
  // The walks reach the station's ground-level stair without crossing a street.
  for(const path of [p.walk,p.entranceWalk])for(let i=1;i<path.length;i++)for(let t=0;t<=1;t+=.05){
   const q:[number,number]=[path[i-1][0]+(path[i][0]-path[i-1][0])*t,path[i-1][1]+(path[i][1]-path[i-1][1])*t];
   for(const r of roads)expect(distanceToRoad(q,r)).toBeGreaterThanOrEqual(PLAZA_WALK_CLEARANCE);
  }
  const ground=[...stop.walk].reverse().find(q=>q[1]===0)!;
  expect(p.walk.at(-1)).toEqual([ground[0],ground[2]]);
 });
});
