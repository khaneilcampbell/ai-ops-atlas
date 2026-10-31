import {financialDimensions} from './financialArchitecture';
import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {COMMUNITY as C,COMMUNITY_BUILDINGS,commuterStage,railState,railDeck,railPoint,walkPoint} from './hillsCommunityPlan';
import {distanceToRoad} from './highway';
import {pathClear} from './roads';
import {airportFootprint} from './airport';
import {HILLS} from './hillsPlan';
describe('Hills community and elevated service',()=>{
 for(const group of ['none','district','status','tag'] as GroupBy[])it(`preserves clear parcels and rail access in ${group}`,()=>{
 const s=buildScene(layoutMap(catalog,[],group)),c=s.community!,r=s.communityRail!,h=s.hills!,f=s.financial!;expect(c).toBeDefined();expect(r).toBeDefined();
 expect(COMMUNITY_BUILDINGS.filter(b=>b.kind==='house')).toHaveLength(4);expect(HILLS.mansion).toMatchObject({x:13,z:10,w:9,d:5});
 const boxes=COMMUNITY_BUILDINGS.filter(b=>!['station','golf'].includes(b.kind));
 for(const b of COMMUNITY_BUILDINGS){expect(b.x-b.w/2).toBeGreaterThan(0);expect(b.x+b.w/2).toBeLessThan(h.w);expect(b.z+b.d/2).toBeLessThan(h.d);}
 for(const [i,b]of boxes.entries())for(const other of boxes.slice(i+1))expect(Math.abs(b.x-other.x)<(b.w+other.w)/2+.2&&Math.abs(b.z-other.z)<(b.d+other.d)/2+.2).toBe(false);
 const world=boxes.map(b=>({x:c.x+b.x,z:c.z+b.z,w:b.w,d:b.d}));
 for(const route of c.streets)expect(pathClear(route,world,.32),'local streets clear all new buildings').toBe(true);
 for(const route of c.walks)expect(pathClear(route,world,.1),'pedestrian paths clear new building footprints').toBe(true);
 const deck=railDeck(r);expect(deck.length-r.length).toBeGreaterThan(C.trainLength);
 for(let d=0;d<=r.length;d+=2)for(const offset of [-C.carriageSpacing,0,C.carriageSpacing]){const q=railPoint(deck,(deck.length-r.length)/2+d+offset);for(const end of [-1,1])for(const side of [-1,1]){const point:[number,number]=[q.x+Math.sin(q.yaw)*end*C.carriageLength/2+Math.cos(q.yaw)*side*.26,q.z+Math.cos(q.yaw)*end*C.carriageLength/2-Math.sin(q.yaw)*side*.26];expect(distanceToRoad(point,deck.route),'articulated carriages stay inside the curved deck').toBeLessThan(.54);}}
 const airport=airportFootprint(s.airport!);expect(pathClear(r.route,[{x:airport.x+airport.w/2,z:airport.z+airport.d/2,w:airport.w,d:airport.d}],1),'rail avoids the airport parcel').toBe(true);
 expect(pathClear(r.route,[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size})),.6)).toBe(true);
 expect(r.route[0]).toEqual(c.station);expect(r.route[r.route.length-1]).toEqual(r.financial);const park=f.park,stop=r.financial;
 // KC, 2026-10-31: the stop is in Financial Park, and the line reaches it behind (north of, on the
 // water side of) the BMW showroom and every district tower.
 expect(stop[0]-f.x).toBeGreaterThan(park.x+3.4);expect(stop[0]-f.x).toBeLessThan(park.x+park.w-1);expect(stop[1]).toBeLessThan(f.z);
 const d=s.dealership!,north=Math.min(d.lot.z,...f.buildings.map(b=>f.z+b.z-financialDimensions(b.id).d/2));
 const westward=r.route.filter(p=>p[1]<f.z);expect(westward.length).toBeGreaterThan(1);for(const p of r.route.filter(p=>p[0]<d.lot.x+d.lot.w&&p[1]<f.z+f.d))expect(p[1],'rail stays behind the buildings').toBeLessThan(north-.7);
 const stairs=[stop[0]+1,stop[1]+5.9];expect(distanceToRoad(stairs as [number,number],park.paths[0].map(p=>[f.x+p[0],f.z+p[1]]))).toBeLessThan(.01);
 for(const tree of park.trees)expect(Math.hypot(f.x+tree[0]-stop[0]-1,0)>C.platformLength/2||Math.abs(f.z+tree[1]-stop[1])>6.2||Math.abs(f.x+tree[0]-stop[0]-1)>1.1,'park trees clear the station stairs').toBe(true);
 expect(railPoint(r,0)).toMatchObject({x:r.hills[0],z:r.hills[1]});{const end=railPoint(r,r.length);expect(end.x).toBeCloseTo(r.financial[0],6);expect(end.z).toBeCloseTo(r.financial[1],6);}
 expect(r.hillsWalk[r.hillsWalk.length-1][1]).toBe(C.platformRise);expect(r.financialWalk[0][1]).toBe(C.platformRise);expect(r.financialWalk[r.financialWalk.length-1][1]).toBe(0);
 expect(pathClear(r.financialWalk.filter(p=>p[1]===0).map(p=>[p[0],p[2]]),f.buildings.map(b=>({x:f.x+b.x,z:f.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d})),.15),'onward walk reaches the bank without crossing towers').toBe(true);
 });
 it('keeps doors open only when stopped and completes a continuous round trip',()=>{const length=160,travel=length/C.speed;
 expect(railState(0,length)).toMatchObject({distance:0,doors:1,phase:'hills'});expect(railState(C.dwell+travel/2,length)).toMatchObject({distance:80,doors:0,phase:'outbound'});
 expect(railState(C.dwell+travel+1,length)).toMatchObject({distance:length,doors:1,phase:'financial'});expect(railState(2*C.dwell+travel+travel/2,length)).toMatchObject({distance:80,doors:0,phase:'return'});
 expect(railState(2*(C.dwell+travel),length)).toMatchObject({distance:0,doors:1});
 for(let t=0;t<2*(C.dwell+travel);t+=.1){const a=railState(t,length),b=railState(t+.01,length);expect(Math.abs(b.distance-a.distance)).toBeLessThanOrEqual(C.speed*.011);}
 });
 it('walks out and back at both stations, riding only with closed doors',()=>{const length=160,travel=length/C.speed;for(const seconds of [0,C.dwell/4,C.dwell/2,C.dwell*.9,C.dwell+1,C.dwell+travel+1,2*C.dwell+travel+1]){const state=railState(seconds,length),stage=commuterStage(state);expect(stage.progress).toBeGreaterThanOrEqual(0);expect(stage.progress).toBeLessThanOrEqual(1);if(stage.aboard)expect(state.doors).toBe(0);else expect(state.doors).toBe(1);}expect(commuterStage(railState(C.dwell/2,length))).toMatchObject({aboard:false,hills:true,progress:0});expect(commuterStage(railState(C.dwell+travel+C.dwell/2,length))).toMatchObject({aboard:false,hills:false,progress:1});});
 it('samples station stair approaches including vertical distance',()=>{const path:[[number,number,number],[number,number,number]]=[[0,0,0],[0,3.6,4.2]];expect(walkPoint(path,0)).toEqual(path[0]);expect(walkPoint(path,1)).toEqual(path[1]);expect(walkPoint(path,.5)).toEqual([0,1.8,2.1]);});
});
