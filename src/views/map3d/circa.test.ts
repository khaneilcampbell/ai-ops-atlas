import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {CIRCA,circaEntrance,circaParts,circaPieceCount,circaScreenPath} from './circaPlan';
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
  // The LED band wraps all four podium faces and closes on itself.
  const screen=circaScreenPath(),P=CIRCA.podium;
  for(const [x,z]of screen){expect(Math.abs(x)).toBeLessThanOrEqual(box.w/2);expect(Math.abs(z)).toBeLessThanOrEqual(box.d/2);expect(Math.abs(x)>P.w/2||Math.abs(z)>P.d/2).toBe(true);}
  expect(Math.max(...screen.map(p=>p[0]))).toBeGreaterThan(P.w/2);expect(Math.min(...screen.map(p=>p[0]))).toBeLessThan(-P.w/2);
  expect(Math.max(...screen.map(p=>p[1]))).toBeGreaterThan(P.d/2);expect(Math.min(...screen.map(p=>p[1]))).toBeLessThan(-P.d/2);
  expect(screen[0][0]).toBeCloseTo(screen.at(-1)![0]);expect(screen[0][1]).toBeCloseTo(screen.at(-1)![1]);
  expect(Number.isInteger(CIRCA.screen.repeats)).toBe(true);
 });

 it('has a large glass entrance on the street face that stays below and clear of the LED band',()=>{
  const entry={solid:[],entryGlass:[],entryDrums:[],lobbyGlow:[],lobbyFinish:[],rounds:[],leaves:[]} as Parameters<typeof circaEntrance>[0];
  const {door}=circaEntrance(entry,palette);
  const all=Object.values(entry).flat(),P=CIRCA.podium,S=CIRCA.screen,band=circaScreenPath();
  expect(entry.entryGlass.length).toBeGreaterThan(0);expect(entry.entryDrums.length).toBe(0);expect(entry.lobbyGlow.length).toBeGreaterThan(0);
  // Below the band: every part's top sits at least .04 under its bottom edge, so nothing covers it.
  for(const p of all)expect(p.p[1]+p.s[1]).toBeLessThanOrEqual(S.y0-.04+1e-9);
  // Clear of the band's footprint is then automatic; also check it really steps out past the band's outer wave.
  const front=Math.max(...entry.entryGlass.map(p=>p.p[2]));
  expect(front).toBeGreaterThan(Math.max(...band.filter(([x])=>Math.abs(x)<1.2).map(([,z])=>z)));
  // Centred on the front walk (the approach starts at the building's x) and inside the palm gap.
  expect(Math.abs(door.x)).toBeLessThan(.1);expect(door.w).toBeGreaterThanOrEqual(.6);
  // As tall as the other Financial District entrances (their shared door canopy sits at .85).
  expect(Math.max(...all.map(p=>p.p[1]+p.s[1]))).toBeGreaterThanOrEqual(.85);
  // The band stays on the podium: above the entrance and below the deck parapet.
  expect(S.y1).toBeLessThanOrEqual(P.h);
  expect(CIRCA.entrance.w).toBeGreaterThanOrEqual(2.2);expect(CIRCA.entrance.w).toBeLessThanOrEqual(2.8);
  // Lobby parts sit in the street-face recess or the pavilion, never deeper into the podium.
  for(const p of all)expect(p.p[2]).toBeGreaterThan(P.d/2-.06-CIRCA.entrance.recess-1e-9);
  // The whole complex keeps the entrance and no old portal box.
  const parts=circaParts(9,palette);expect(parts.entryGlass).toEqual(entry.entryGlass);
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

 for(const grouping of ['none','district','status','tag'] as const)it(`is the tallest building in the Financial District and aircraft stay clear above it (${grouping})`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),f=s.financial!,circa=f.buildings.find(b=>b.id==='circa')!,top=(b:typeof circa)=>b.height+financialDimensions(b.id).top;
  for(const b of f.buildings.filter(b=>b.id!=='circa')){expect(circa.height,b.id).toBeGreaterThan(top(b));expect(top(circa),b.id).toBeGreaterThan(top(b)+.5);}
  expect(flightClearance(s).altitude).toBeGreaterThanOrEqual(top(circa)+4);
 });

 it('has an unofficial planned identity, search, owning role and desk view, without a sign',()=>{
  const brand=financialBrand('circa')!;
  expect(brand.name).toBe('Circa');expect(brand.noSign).toBe(true);expect(brand.purpose).toMatch(/unofficial/i);expect(brand.role).toBe('Residential Amenities Planning Coordinator');
  expect(financialBuildingMatches('Circa').map(b=>b.id)).toEqual(['circa']);
  expect(BUILDING_INTERIORS['financial:circa'].rooms).toEqual(['Marble & walnut lobby','Pool deck lounge','Sky residence','Fitness club']);
 });
});
