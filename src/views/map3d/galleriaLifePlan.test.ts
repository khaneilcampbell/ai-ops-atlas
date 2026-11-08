import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {GALLERIA_LIFE,driverAt,driverCycle,planGalleriaLife,walkerAt} from './galleriaLifePlan';
import {planGalleriaCrowd} from '../office/galleriaCrowdPlan';
import {toIn} from '../office/GalleriaInterior';
import {STREET_LIGHT,planStreetLights} from './streetLighting';

const s=buildScene(layoutMap(catalog,[],'district')),gl=s.galleria!;
const inRect=(x:number,z:number)=>x>=gl.rect.x-.4&&x<=gl.rect.x+gl.rect.w+.4&&z>=gl.rect.z-.4&&z<=gl.rect.z+gl.rect.d+.4;

describe('Atlas Galleria street lights and promenade',()=>{
 it('lights the lot with lamps that stay off the building and apart from each other',()=>{
  expect(gl.lamps.length).toBeGreaterThanOrEqual(8);
  for(const l of gl.lamps){expect(inRect(l.x,l.z)).toBe(true);}
  for(const [i,a] of gl.lamps.entries())for(const b of gl.lamps.slice(i+1))expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeGreaterThanOrEqual(STREET_LIGHT.minSeparation);
 });
 it('feeds its lamps into the map street lights',()=>{
  const lights=planStreetLights(s);
  for(const l of gl.lamps)expect(lights.some(x=>Math.abs(x.x-l.x)<1e-6&&Math.abs(x.z-l.z)<1e-6)).toBe(true);
 });
 it('runs the promenade from the entrance out to the front of the lot',()=>{
  const [e,link,top,end]=gl.promenade;
  expect(e).toEqual([gl.entrance.x,gl.entrance.z]);
  expect(link[0]).toBeGreaterThan(e[0]);
  expect(top[1]).toBeLessThan(end[1]);
  for(const p of [link,top,end])expect(inRect(p[0],p[1])).toBe(true);
 });
});

describe('Atlas Galleria people and cars',()=>{
 const life=planGalleriaLife(gl);
 it('keeps a bounded crowd',()=>{
  expect(life.walkers.length).toBeGreaterThan(4);
  expect(life.walkers.length).toBeLessThanOrEqual(GALLERIA_LIFE.maxWalkers);
 });
 it('keeps every walker on the lot and off the street at any time',()=>{
  for(const w of life.walkers)for(let t=0;t<120;t+=1.7){const p=walkerAt(w,t);expect(inRect(p.x,p.z),`${w.id} ${t}`).toBe(true);}
 });
 it('walks drivers to their car, drives out of the lot and back, and parks again',()=>{
  if(!gl.parking){expect(life.drivers).toEqual([]);return;}
  expect(life.drivers.length).toBeGreaterThan(0);
  for(const d of life.drivers){
   const c=driverCycle(d),phases=new Set<string>();
   for(let t=0;t<c;t+=.25){
    const {person,car}=driverAt(d,t-d.phase);
    if(person.visible&&car.visible&&!car.moving)phases.add('walk-or-board');
    if(!person.visible&&car.visible&&car.moving)phases.add('drive');
    if(!person.visible&&!car.visible)phases.add('away');
    if(car.visible)expect(inRect(car.x,car.z)||car.x>gl.rect.x+gl.rect.w,`${d.id} ${t}`).toBe(true);
    // Nobody is inside the car and on foot at once.
    expect(person.visible&&car.moving).toBe(false);
   }
   expect([...phases].sort()).toEqual(['away','drive','walk-or-board']);
   // Parked at the start and end of every loop.
   expect(driverAt(d,-d.phase).car).toMatchObject({visible:true,moving:false});
  }
 });
});

describe('Atlas Galleria shoppers inside',()=>{
 const BASE=[-3,0,4,7.6];
 it('puts people on every floor, all standing on the floor plate',()=>{
  for(const f of [0,1,2,3]){
   const crowd=planGalleriaCrowd(f,BASE[f],toIn);
   expect(crowd.length,`floor ${f}`).toBeGreaterThan(1);
   for(const p of crowd)for(const q of p.path)expect(q[1]).toBe(BASE[f]);
  }
 });
});
