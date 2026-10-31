import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {CIRCA,circaParts,circaPieceCount,circaScreenPath} from './circaPlan';
import {financialDimensions} from './financialArchitecture';
import {financialBrand} from './financialBrands';
import {FINANCIAL} from './financialPlan';
import {distanceToRoad} from './highway';
import {flightClearance} from './flightClearance';
import {BUILDING_INTERIORS} from '../../catalog/buildings';
import {financialBuildingMatches} from '../../lib/financialSearch';
import type {Pt} from './roads';

const palette={white:'#f7f7f0',stone:'#e3ddcf',trim:'#c9cfcc',core:'#5f6b72',green:'#5f8f5d',turquoise:'#3fb7b2',wood:'#8e6f4e'};
const overlaps=(a:{x:number;z:number;w:number;d:number},b:{x:number;z:number;w:number;d:number})=>a.x<b.x+b.w-1e-6&&a.x+a.w>b.x+1e-6&&a.z<b.z+b.d-1e-6&&a.z+a.d>b.z+1e-6;

describe('Circa twin towers',()=>{
 for(const grouping of ['none','district','status','tag'] as const)it(`sits on a free waterfront lot west of Navy Federal and Vanguard, clear of the highway (${grouping})`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),f=s.financial!,c=f.circa!;
  expect(c).toBeDefined();
  const circa=f.buildings.find(b=>b.id==='circa')!,navy=f.buildings.find(b=>b.id==='insurance')!,vanguard=f.buildings.find(b=>b.id==='financial-planning')!;
  // West of (left of) both towers, joined to the district's west edge.
  expect(f.x+circa.x).toBeLessThan(f.x+navy.x-3);expect(f.x+circa.x).toBeLessThan(f.x+vanguard.x-3);
  expect(c.x+c.w).toBeCloseTo(f.x);expect(c.z).toBeCloseTo(f.z);expect(c.d).toBeCloseTo(f.d);
  // The only land under the parcel is the parcel itself.
  expect(s.land.filter(r=>overlaps(r,c))).toEqual([{x:c.x,z:c.z,w:c.w,d:c.d}]);
  // Every corner and edge midpoint keeps clear of the highway centreline, including its bend.
  const highway=s.freight!.highway,edge:Pt[]=[];
  for(let t=0;t<=1;t+=.05)edge.push([c.x,c.z+t*c.d],[c.x+t*c.w,c.z],[c.x+t*c.w,c.z+c.d]);
  expect(Math.min(...edge.map(p=>distanceToRoad(p,highway)))).toBeGreaterThanOrEqual(CIRCA.highwayClearance);
  // Highway ramps and other freight access stay off the lot.
  for(const a of s.freight!.access)for(const p of [...a.collector,...a.ramps.flat()])expect(p[0]>c.x&&p[0]<c.x+c.w&&p[1]>c.z&&p[1]<c.z+c.d).toBe(false);
  // The front walk reaches the shared north walk, and the street continues to the district street.
  expect(circa.approach.at(-1)).toEqual([f.x+circa.x,f.z+FINANCIAL.northWalkZ]);
  expect(c.street[0]).toEqual(f.street.at(-1));expect(c.sidewalk[0]).toEqual(f.sidewalk[0]);
 });

 it('keeps every part inside its pick box and under the roof envelope',()=>{
  const height=9,parts=circaParts(height,palette),box=financialDimensions('circa');
  for(const [kind,list]of Object.entries(parts))for(const p of list){
   expect([...p.p,...p.s].every(Number.isFinite),kind).toBe(true);expect(p.s.every(n=>n>0),kind).toBe(true);
   const r=p.r??0,radius=kind==='leaves'?1:.5,rx=(Math.abs(Math.cos(r))*p.s[0]+Math.abs(Math.sin(r))*p.s[2])*radius,rz=(Math.abs(Math.sin(r))*p.s[0]+Math.abs(Math.cos(r))*p.s[2])*radius;
   expect(Math.abs(p.p[0])-rx,kind).toBeGreaterThanOrEqual(-box.w/2-.4);
   // East palms stand between the podium and the district's west wall; the seawall is further out on the west.
   expect(p.p[0]+(kind==='fronds'?.25:rx),kind).toBeLessThan(-CIRCA.x+.18-.09);expect(p.p[0]-(kind==='fronds'?.25:rx),kind).toBeGreaterThan(-CIRCA.siteWidth-CIRCA.x+.27);
   expect(Math.abs(p.p[2])+(kind==='fronds'?.3:rz),kind).toBeLessThanOrEqual(box.d/2+1.05);
   expect(p.p[1]+p.s[1],kind).toBeLessThanOrEqual(height+box.top+1e-6);
  }
  // The wave screen hangs on the north face, the lap pool, colonnade and cabana side of the deck.
  const screen=circaScreenPath();
  for(const [x,z]of screen){expect(Math.abs(x)).toBeLessThanOrEqual(CIRCA.podium.w/2);expect(z).toBeLessThan(-CIRCA.podium.d/2);expect(Math.abs(z)).toBeLessThanOrEqual(box.d/2);}
  expect(screen[0][0]).toBeGreaterThan(screen.at(-1)![0]);
  const lap=parts.lapWater[0].p;expect(lap[2]).toBeLessThan(0);
 });

 it('stays within the map piece budget with one screen mesh and no lights',()=>{
  expect(circaPieceCount(circaParts(9,palette))).toBeLessThan(CIRCA.maxPieces);
 });

 it('keeps both towers apart, on the podium and clear of the pools',()=>{
  const [a,b]=CIRCA.tower.centres,reach=CIRCA.tower.rx+CIRCA.tower.balconySide;
  expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeGreaterThan(reach*2);
  for(const [x,z]of CIRCA.tower.centres){expect(Math.abs(x)+reach).toBeLessThan(CIRCA.podium.w/2);expect(Math.abs(z)+reach).toBeLessThan(CIRCA.podium.d/2+.1);}
  const parts=circaParts(9,palette);
  for(const water of [...parts.roundWater,...parts.lapWater])for(const [x,z]of CIRCA.tower.centres)expect(Math.hypot(water.p[0]-x,water.p[2]-z)).toBeGreaterThan(reach);
 });

 it('does not raise the aircraft corridor',()=>{
  const s=buildScene(layoutMap(catalog)),without={...s,financial:{...s.financial!,buildings:s.financial!.buildings.filter(b=>b.id!=='circa')}};
  expect(flightClearance(s).altitude).toBe(flightClearance(without).altitude);
 });

 it('has an unofficial planned identity, search, owning role and desk view, without a sign',()=>{
  const brand=financialBrand('circa')!;
  expect(brand.name).toBe('Circa');expect(brand.noSign).toBe(true);expect(brand.purpose).toMatch(/unofficial/i);expect(brand.role).toBe('Residential Amenities Planning Coordinator');
  expect(financialBuildingMatches('Circa').map(b=>b.id)).toEqual(['circa']);
  expect(BUILDING_INTERIORS['financial:circa'].rooms).toEqual(['Marble & walnut lobby','Pool deck lounge','Sky residence','Fitness club']);
 });
});
