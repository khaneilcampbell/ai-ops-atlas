import {describe,expect,it} from 'vitest';
import {FINANCIAL_STATION_KEY,PARK_STATION,parkStationParts,placeParkStation} from './parkStationPlan';
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

describe('Financial District stop on the perimeter loop',()=>{
 const local=parkStationParts([0,0],0);
 it('is the loop\'s Financial District station',()=>{expect(FINANCIAL_STATION_KEY).toBe('service:financial-station');});
 it('places the shell exactly where the old shuttle stop built it when the track runs east',()=>{
  const stop={point:[10,-20] as [number,number],yaw:Math.PI/2},placed=placeParkStation(local,stop),direct=parkStationParts(stop.point,0);
  for(const key of ['metal','glass','accents'] as const){
   expect(placed[key].length).toBe(direct[key].length);
   placed[key].forEach((v,i)=>{expect(v.p[0]).toBeCloseTo(direct[key][i].p[0]);expect(v.p[1]).toBeCloseTo(direct[key][i].p[1]);expect(v.p[2]).toBeCloseTo(direct[key][i].p[2]);expect(v.r??0).toBeCloseTo(0);});
  }
 });
 it('turns the skybridge toward the land on other track directions',()=>{
  const stop={point:[0,0] as [number,number],yaw:0},placed=placeParkStation(local,stop);
  const arches=placed.metal.filter(p=>p.s[0]===.08);
  // Track runs south: land is to the west, so the arches land at negative x.
  expect(Math.min(...arches.map(p=>p.p[0]))).toBeLessThan(-5.5);
  expect(arches.every(p=>Math.abs((p.r??0)+Math.PI/2)<1e-9)).toBe(true);
 });
});
