import {describe,expect,it} from 'vitest';
import {PARK_STATION,parkStationParts} from './parkStationPlan';
import {COMMUNITY as C} from './hillsCommunityPlan';

describe('Financial Park station (Dubai-style shell and skybridge)',()=>{
 const stop:[number,number]=[10,-20],parts=parkStationParts(stop,0),all=[...parts.metal,...parts.glass,...parts.accents];
 it('stays a small, fixed number of instanced boxes',()=>{expect(all.length).toBeLessThan(140);expect(parts.glass.length).toBeGreaterThan(0);expect(parts.accents.length).toBe(2*PARK_STATION.shell.slats);});
 it('keeps the shell clear of the train and the platform walkway',()=>{
  const s=PARK_STATION.shell,trainTop=C.railRise+.1+.56;
  for(const slat of all.filter(p=>p.s[0]===s.length)){
   // Any slat over the track must sit above the train; low slats stay outside the train's width.
   if(Math.abs(slat.p[2]-stop[1])<.35)expect(slat.p[1]).toBeGreaterThan(trainTop);
   expect(slat.p[1]).toBeGreaterThan(C.platformRise+.55);
  }
 });
 it('lands the skybridge arches in the park, south of the platform',()=>{
  const arches=parts.metal.filter(p=>p.s[0]===.08);expect(arches.length).toBe(2*PARK_STATION.bridge.archSegments);
  expect(Math.max(...arches.map(p=>p.p[2]))).toBeGreaterThan(stop[1]+5.5);
  expect(Math.min(...arches.map(p=>p.p[1]))).toBeGreaterThanOrEqual(0);
 });
});
