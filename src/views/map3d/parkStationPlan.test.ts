import {describe,expect,it} from 'vitest';
import {PARK_STATION,mergeStationParts,parkStationParts,placeParkStation} from './parkStationPlan';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {financialDimensions} from './financialArchitecture';
import {airportPoint,AIRPORT_LAYOUT} from './airport';
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

describe('Shell stations on the perimeter loop',()=>{
 const local=parkStationParts([0,0],0);
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

describe('every perimeter stop wears the shell (KC, 2026-11-07)',()=>{
 for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`keeps all five shells clear of buildings and the runway: ${grouping}`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),loop=s.communityRail!.loop!,local=parkStationParts([0,0],0);
  const boxes=[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
  boxes.push(...s.financial!.buildings.map(b=>({x:s.financial!.x+b.x,z:s.financial!.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d})));
  if(s.mall)boxes.push({x:s.mall.cx,z:s.mall.cz-.8,w:s.mall.w,d:s.mall.d-2.5});
  if(s.stadium)boxes.push({x:s.stadium.x+s.stadium.w/2,z:s.stadium.z+s.stadium.d/2,w:s.stadium.w,d:s.stadium.d});
  const a=s.airport!,runway=airportPoint(a,AIRPORT_LAYOUT.runwayX,AIRPORT_LAYOUT.runwayZ);
  boxes.push({x:runway[0],z:runway[1],w:AIRPORT_LAYOUT.runwayWidth+2,d:AIRPORT_LAYOUT.runwayLength+2});
  const all=mergeStationParts(loop.stops.map(stop=>placeParkStation(local,stop)));
  expect(all.accents.length).toBe(loop.stops.length*local.accents.length);
  for(const part of [...all.metal,...all.glass,...all.accents])for(const b of boxes)expect(Math.abs(part.p[0]-b.x)<b.w/2&&Math.abs(part.p[2]-b.z)<b.d/2).toBe(false);
 });
});
