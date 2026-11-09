import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {GALLERIA,GALLERIA_BASEMENT,GALLERIA_FLOORS,GALLERIA_UNITS,galleriaFins,galleriaPieceCount,glassOutline,insidePoly,slabOutline,type GalleriaPlan} from './galleriaPlan';
import {STREET_ASPHALT,STREET_LINE} from './transportScale';
import {stationAccessAreas} from './hillsCommunityPlan';
import type {Pt} from './roads';
import type {Rect} from './scene';

const sceneFor=(g:GroupBy)=>buildScene(layoutMap(catalog,[],g));
const GROUPS:GroupBy[]=['district','status','tag','none'];
const hit=(a:Rect,b:Rect)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.z<b.z+b.d&&a.z+a.d>b.z;
const inRect=(r:Rect,[x,z]:Pt,pad=0)=>x>=r.x-pad&&x<=r.x+r.w+pad&&z>=r.z-pad&&z<=r.z+r.d+pad;
/** True when two segments properly cross. */
function cross(a:Pt,b:Pt,c:Pt,d:Pt){const o=(p:Pt,q:Pt,r:Pt)=>Math.sign((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]));return o(a,b,c)*o(a,b,d)<0&&o(c,d,a)*o(c,d,b)<0;}
function simple(p:Pt[]){const n=p.length;for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){if(i===0&&j===n-1)continue;if(cross(p[i],p[(i+1)%n],p[j],p[(j+1)%n]))return false;}return true;}

describe('Atlas Galleria plan (reference metres)',()=>{
 it('keeps every slab, glass line and the atrium a simple outline',()=>{
  for(const l of [0,1,2,3])expect(simple(slabOutline(l))).toBe(true);
  for(const s of [0,1,2])expect(simple(glassOutline(s))).toBe(true);
 });
 it('sets the glazing back inside both slabs it spans',()=>{
  for(const s of [0,1,2])for(const p of glassOutline(s).filter((_,i)=>i%3===0)){expect(insidePoly(slabOutline(s),p)).toBe(true);expect(insidePoly(slabOutline(s+1),p)).toBe(true);}
 });
 it('fits every unit inside its floor and labels them by what they sell, not by brand',()=>{
  for(const u of GALLERIA_UNITS){
   const plate=u.floor===0?GALLERIA_BASEMENT:slabOutline(u.floor-1);
   for(const p of u.poly)expect(insidePoly(plate,p),`${u.id} ${p}`).toBe(true);
   expect(u.name).not.toMatch(/spar|starbucks|texas chicken|peace|street wear/i);
  }
  expect(GALLERIA_FLOORS.map(f=>f.label)).toEqual(['Basement','Ground','Floor 1','Floor 2']);
  for(const f of [1,2,3])expect(GALLERIA_UNITS.some(u=>u.floor===f&&u.kind==='market')).toBe(true);
 });
});

describe('Atlas Galleria on the map',()=>{
 const scenes=GROUPS.map(g=>[g,sceneFor(g)] as const);
 const s=scenes[0][1],gl=s.galleria as GalleriaPlan;
 it('stands behind the Marketplace when a repository is removed (the installed app hides deleted ones)',()=>{
  // The old two-stop line's Marketplace stairs are not drawn beside the perimeter loop, so they must not clear the lot.
  for(const p of catalog.projects)expect(buildScene(layoutMap({...catalog,projects:catalog.projects.filter(q=>q!==p)},[],'district')).galleria,`without ${p.id}`).toBeDefined();
 });
 it('replaces the Marketplace Gardens behind the Marketplace, on its lot',()=>{
  expect(gl).toBeDefined();const m=s.mall!;
  expect(gl.rect.z+gl.rect.d).toBeLessThanOrEqual(m.z);
  for(const p of gl.slabs.flat())expect(inRect(gl.rect,p,1e-6)).toBe(true);
  for(const b of [...gl.boxes,...gl.rounds])expect(inRect(gl.rect,[b.x,b.z],.05)).toBe(true);
  // Main entrance faces east: the forecourt is east of the building's middle.
  expect(gl.entrance.x).toBeGreaterThan(gl.footprint.x+gl.footprint.w/2);
 });
 it('never stands on a building, road, rail or station opening, in any grouping',()=>{
  for(const [g,sc] of scenes){
   const p=sc.galleria;if(!p)continue;const f=p.footprint;
   for(const b of [...sc.towers,...sc.kiosks])expect(hit(f,{x:b.x-b.size/2,z:b.z-b.size/2,w:b.size,d:b.size}),`${g} ${b.key}`).toBe(false);
   if(sc.mall)expect(hit(f,sc.mall),g).toBe(false);
   for(const c of sc.transportConnections)for(const q of [...c.road,...c.walk])expect(inRect(f,q,.3),`${g} ${c.id}`).toBe(false);
   const loop=sc.communityRail?.loop;
   if(loop){for(const q of loop.route)expect(inRect(f,q,.4),g).toBe(false);for(const stop of loop.stops)expect(inRect(f,stop.point,1.5),`${g} ${stop.name}`).toBe(false);}
   // The two-stop line's stairs exist only without the loop; beside it that stop is never drawn.
   if(sc.communityRail&&!loop)for(const a of stationAccessAreas(sc.communityRail.hills))expect(hit(f,a),g).toBe(false);
  }
 });
 it('keeps the reference proportions and three storeys under the canopy',()=>{
  expect(gl.footprint.w/gl.footprint.d).toBeGreaterThan(1.2);expect(gl.footprint.w/gl.footprint.d).toBeLessThan(1.5);
  expect(gl.levels).toHaveLength(4);expect(gl.column.top).toBeGreaterThan(gl.roof);
  expect(gl.s).toBeLessThanOrEqual(GALLERIA.maxScale);
 });
 it('paves right round the building and keeps the car park and trees off the pavement',()=>{
  // Every ground-floor and overhang point sits inside the apron, with the lamp ring's width to spare.
  for(const l of [0,1,2,3])for(const q of gl.slabs[l])expect(insidePoly(gl.apron,q)).toBe(true);
  const a=gl.parking!.area;
  for(const q of gl.apron)expect(q[0]>a.x&&q[0]<a.x+a.w&&q[1]>a.z&&q[1]<a.z+a.d).toBe(false);
  for(const t of gl.trees.filter(t=>t.y===gl.y0))expect(insidePoly(gl.apron,[t.x,t.z])).toBe(false);
  // No basement ramp in front of the car park (KC, 2026-11-09): nothing dark and walled between the building and the bays.
  expect(gl.boxes.some(b=>b.c==='#2b302e')).toBe(false);
 });
 it('paves the car park in street asphalt with the street centre line down its aisle',()=>{
  const a=gl.parking!.area,mid={x:a.x+a.w/2,z:a.z+a.d/2};
  expect(gl.boxes.find(b=>Math.abs(b.x-mid.x)<1e-6&&Math.abs(b.z-mid.z)<1e-6&&b.w===a.w)?.c).toBe(STREET_ASPHALT);
  const dashes=gl.boxes.filter(b=>b.c===STREET_LINE);
  expect(dashes.length).toBeGreaterThan(5);
  for(const d of dashes)expect(d.z).toBeCloseTo(gl.parking!.aisle);
 });
 it('waves the fin hems and stays inside its piece budget',()=>{
  const fins=galleriaFins(gl),hs=fins.map(f=>f.h);
  expect(Math.max(...hs)-Math.min(...hs)).toBeGreaterThan(.5);
  expect(galleriaPieceCount(gl)).toBeLessThan(3200);
 });
 it('joins its terrace planting to the map\'s own tree and bush lists',()=>{
  for(const t of gl.trees)expect(s.trees).toContain(t);
  expect(gl.bushes.filter(b=>b.y>gl.y0+1).length).toBeGreaterThan(60);
 });
});
