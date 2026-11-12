import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {CAR_SURFACE,GALLERIA_LIFE,carHeight,driverAt,planGalleriaLife,walkerAt} from './galleriaLifePlan';
import {insidePoly} from './galleriaPlan';
import {along} from './railCommuters';
import {buildStreetGraph,nearestStreet,streetLines} from './streetGraph';

const scene=buildScene(layoutMap(catalog,[],'district'));
// Without Service Desk's land the lot behind the Marketplace is too shallow for the car park behind
// the building. The fixture stands a Career Applications tower on its old lot (both towers are off
// the map since 2026-11-09, and its manifest was removed 2026-11-10) so the lot keeps the shallow
// shape this case covers.
const at=catalog.projects.findIndex(p=>p.id==='benjaire-ops')+1;
const careerTower={id:'career-tower-fixture',name:'Career Applications',summary:'',status:'active' as const,repository:'',tags:['claude','career','human-in-the-loop'],district:'career-portfolio' as const,links:[],agentIds:[]};
const shallowProjects=catalog.projects.filter(p=>p.id!=='service-desk');
shallowProjects.splice(at,0,careerTower);
const shallow=buildScene(layoutMap({projects:shallowProjects,agents:catalog.agents},[],'district'));

describe('life round Atlas Galleria',()=>{
 for(const [name,s] of [['sample',scene],['shallow lot',shallow]] as const)it(`walks, lights and drives round the building (${name} layout)`,()=>{
  const life=planGalleriaLife(s)!,g=s.galleria!;expect(life).toBeDefined();
  // The entrance walk leaves the forecourt by the lot's east edge and ends on a street beyond the lot
  // (across the street from the Marketplace, it turns down the edge beside the car park first).
  const graph=buildStreetGraph(streetLines(s)),end=life.walk.at(-1)!;
  expect(life.walk.length).toBeGreaterThanOrEqual(3);expect(life.walk[1][0]).toBeGreaterThanOrEqual(g.rect.x+g.rect.w-1e-6);
  expect(nearestStreet(graph,[end[0],0,end[1]]).d).toBeLessThan(1e-6);
  const r=g.rect;expect(end[0]>r.x+r.w||end[1]>r.z+r.d).toBe(true);
  // Lamps stand outside the building, on the lot or beside the walk, never in the car park.
  expect(life.lamps.length).toBeGreaterThan(12);
  for(const l of life.lamps){expect(insidePoly(g.slabs[0],[l.x,l.z])).toBe(false);if(g.parking){const a=g.parking.area;expect(l.x>a.x&&l.x<a.x+a.w&&l.z>a.z&&l.z<a.z+a.d).toBe(false);}}
  expect(life.walkers.length).toBe(GALLERIA_LIFE.shoppers+GALLERIA_LIFE.strollers);
  expect(life.drivers.length).toBeGreaterThan(0);
 });
 for(const [name,s] of [['sample',scene],['shallow lot',shallow]] as const)it(`lets each driver walk out, drive off, come back and walk in again (${name} layout)`,()=>{
  const life=planGalleriaLife(s)!;
  for(const d of life.drivers){
   let walked=false,droveOff=false,away=false,parkedEmpty=false;
   for(let t=0;t<400;t+=.5){
    const {person,car}=driverAt(d,t);
    if(person.visible&&car.visible&&!('moving' in car))walked=true;
    // Off the lot and the driveway, out on the street.
    if(car.visible&&carHeight(life,car.x,car.z)===CAR_SURFACE.street)droveOff=true;
    if(!person.visible&&!car.visible)away=true;
    if(!person.visible&&car.visible&&!('moving' in car))parkedEmpty=true;
    if(car.visible&&'moving' in car)expect(person.visible).toBe(false);
   }
   // parkedEmpty: back in the bay with nobody in it, so the driver has walked in again.
   expect([walked,droveOff,away,parkedEmpty]).toEqual([true,true,true,true]);
  }
 });
 it('puts a street court beside the walk where the lot is too shallow for the car park',()=>{
  const life=planGalleriaLife(shallow)!,[,,end]=life.walk;
  expect(shallow.galleria!.parking).toBeUndefined();expect(life.court!.cars.length).toBeGreaterThan(0);
  for(const c of [...life.court!.cars,...life.drivers.map(d=>d.car)]){expect(Math.abs(c.z-end[1])).toBeGreaterThan(.4);expect(c.x).toBeLessThan(end[0]-.3);}
 });
 for(const [name,s] of [['sample',scene],['shallow lot',shallow]] as const)it(`joins each car park to the street by a driveway the cars use (${name} layout)`,()=>{
  const life=planGalleriaLife(s)!,graph=buildStreetGraph(streetLines(s));
  expect(life.driveways.length).toBeGreaterThan(0);
  for(const d of life.driveways)expect(nearestStreet(graph,[d.b[0],0,d.b[1]]).d).toBeLessThan(1e-6);
  // Every car leaves along a driveway: its route passes through both ends of one.
  for(const dr of life.drivers){const pts=dr.drive.points.map(p=>[p[0],p[2]] as const);
   expect(life.driveways.some(d=>[d.a,d.b].every(e=>pts.some(p=>Math.hypot(p[0]-e[0],p[1]-e[1])<1e-6)))).toBe(true);}
  for(const l of life.lamps)for(const d of life.driveways){const dx=d.b[0]-d.a[0],dz=d.b[1]-d.a[1],t=Math.max(0,Math.min(1,((l.x-d.a[0])*dx+(l.z-d.a[1])*dz)/(dx*dx+dz*dz)));
   expect(Math.hypot(l.x-d.a[0]-dx*t,l.z-d.a[1]-dz*t)).toBeGreaterThan(GALLERIA_LIFE.driveWidth/2);}
 });
 for(const [name,s] of [['sample',scene],['shallow lot',shallow]] as const)it(`walks everyone round the fountain, in by the entry doors and out by the exit doors (${name} layout)`,()=>{
  const life=planGalleriaLife(s)!,g=s.galleria!,F=g.fountain,keep=F.r+GALLERIA_LIFE.fountainClear-.05;
  // Sample every route finely: no one on foot comes within the clear distance of the fountain's rim.
  const routes=[...life.walkers.filter(w=>!w.loop).flatMap(w=>[w.route,w.back!]),...life.drivers.map(d=>d.walk)];
  for(const r of routes)for(let d=0;d<=r.length;d+=.05){const p=along(r,d,0);expect(Math.hypot(p.x-F.x,p.z-F.z)).toBeGreaterThan(keep);}
  const shopper=life.walkers.find(w=>!w.loop)!,end=shopper.route.points.at(-1)!,start=shopper.back!.points[0];
  expect(Math.hypot(end[0]-life.portal.entry[0],end[2]-life.portal.entry[1])).toBeLessThan(1e-6);
  expect(Math.hypot(start[0]-life.portal.exit[0],start[2]-life.portal.exit[1])).toBeLessThan(1e-6);
  // The way in and the way out face the forecourt and stand apart.
  expect(Math.hypot(life.portal.entry[0]-life.portal.exit[0],life.portal.entry[1]-life.portal.exit[1])).toBeGreaterThan(GALLERIA_LIFE.portal.door);
  expect(life.portal.u[0]*(g.entrance.x-life.portal.x)+life.portal.u[1]*(g.entrance.z-life.portal.z)).toBeGreaterThan(0);
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
