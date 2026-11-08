import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {GALLERIA_LIFE,driverAt,planGalleriaLife,walkerAt} from './galleriaLifePlan';
import {insidePoly} from './galleriaPlan';

const scene=buildScene(layoutMap(catalog,[],'district'));
// The installed app hides the deleted career-application-system repository.
const app=buildScene(layoutMap({...catalog,projects:catalog.projects.filter(p=>p.repository!=='khaneilcampbell/career-application-system')},[],'district'));

describe('life round Atlas Galleria',()=>{
 for(const [name,s] of [['sample',scene],['app',app]] as const)it(`walks, lights and drives round the building (${name} layout)`,()=>{
  const life=planGalleriaLife(s)!,g=s.galleria!;expect(life).toBeDefined();
  // The entrance walk leaves the forecourt and reaches a street beyond the lot.
  expect(life.walk.length).toBe(3);expect(life.walk[2][0]).toBeGreaterThan(g.rect.x+g.rect.w);
  // Lamps stand outside the building, on the lot or beside the walk, never in the car park.
  expect(life.lamps.length).toBeGreaterThan(12);
  for(const l of life.lamps){expect(insidePoly(g.slabs[0],[l.x,l.z])).toBe(false);if(g.parking){const a=g.parking.area;expect(l.x>a.x&&l.x<a.x+a.w&&l.z>a.z&&l.z<a.z+a.d).toBe(false);}}
  expect(life.walkers.length).toBe(GALLERIA_LIFE.shoppers+GALLERIA_LIFE.strollers);
  expect(life.drivers.length).toBeGreaterThan(0);
 });
 for(const [name,s] of [['sample',scene],['app',app]] as const)it(`lets each driver walk out, drive off, come back and walk in again (${name} layout)`,()=>{
  const life=planGalleriaLife(s)!,g=s.galleria!,east=g.rect.x+g.rect.w+(life.court?(life.walk[2][0]-g.rect.x-g.rect.w)-.3:0);
  for(const d of life.drivers){
   let walked=false,droveOff=false,away=false,parkedEmpty=false;
   for(let t=0;t<400;t+=.5){
    const {person,car}=driverAt(d,t);
    if(person.visible&&car.visible&&!('moving' in car))walked=true;
    if(car.visible&&car.x>east)droveOff=true;
    if(!person.visible&&!car.visible)away=true;
    if(!person.visible&&car.visible&&!('moving' in car))parkedEmpty=true;
    if(car.visible&&'moving' in car)expect(person.visible).toBe(false);
   }
   // parkedEmpty: back in the bay with nobody in it, so the driver has walked in again.
   expect([walked,droveOff,away,parkedEmpty]).toEqual([true,true,true,true]);
  }
 });
 it('puts a street court beside the walk where the lot is too shallow for the car park',()=>{
  const life=planGalleriaLife(app)!,[,,end]=life.walk;
  expect(app.galleria!.parking).toBeUndefined();expect(life.court!.cars.length).toBeGreaterThan(0);
  for(const c of [...life.court!.cars,...life.drivers.map(d=>d.car)]){expect(Math.abs(c.z-end[1])).toBeGreaterThan(.4);expect(c.x).toBeLessThan(end[0]-.3);}
 });
 it('takes driven cars out of the static car park so none is drawn twice',()=>{
  const g=scene.galleria!,driven=g.parking!.driven;
  for(const c of driven)expect(g.boxes.some(b=>Math.abs(b.x-c.x)<1e-6&&Math.abs(b.z-c.z)<1e-6&&b.h===.1)).toBe(false);
 });
 it('sends shoppers in and out by the entrance walk, and keeps strollers moving',()=>{
  const life=planGalleriaLife(scene)!;
  const shopper=life.walkers.find(w=>!w.loop)!,stroller=life.walkers.find(w=>w.loop)!;
  const seen=new Set<boolean>();for(let t=0;t<200;t+=.5)seen.add(walkerAt(shopper,t).visible);
  expect([...seen].sort()).toEqual([false,true]);
  const a=walkerAt(stroller,0),b=walkerAt(stroller,3);
  expect(a.visible&&b.visible&&Math.hypot(a.x-b.x,a.z-b.z)>.3).toBe(true);
 });
});
