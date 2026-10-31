import {pathClear} from './roads';
import {vehicleBounds} from "./vehicleModels";
import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {airportFootprint,airportFlightPose,AIRPORT_LAYOUT,airportPoint} from './airport';
import {distanceToRoad,HIGHWAY,lanePath,onRoad,roadIntersections,roadStrips} from './highway';
import type {Pt} from './roads';
const sample=(path:Pt[],step=.15)=>path.slice(1).flatMap((b,i)=>{const a=path[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));return Array.from({length:n+1},(_,j)=>[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n] as Pt);});
describe('shared transportation plan',()=>{
 for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`keeps routes connected and clear in ${grouping} view`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),a=s.airport!,f=s.freight!;
  expect(f,'freight route exists').toBeDefined();
  expect(f.cityAccess.length,'joins the original district streets').toBeGreaterThan(1);
  expect(s.land).toContainEqual(airportFootprint(a));
  const stadium=s.stadium!,parcel={x:stadium.x-2,z:stadium.z-2,w:stadium.w+4,d:stadium.d+4};
  for(const r of s.land)if(r.x!==parcel.x||r.z!==parcel.z)expect(parcel.x<r.x+r.w&&parcel.x+parcel.w>r.x&&parcel.z<r.z+r.d&&parcel.z+parcel.d>r.z,'stadium parcel overlap').toBe(false);
  const boxes=[...s.towers,...s.kiosks,...s.retail];
  for(const p of sample(f.route))for(const b of boxes)expect(Math.abs(p[0]-b.x)<b.size/2+HIGHWAY.width/2 && Math.abs(p[1]-b.z)<b.size/2+HIGHWAY.width/2,`road hits ${b.name}`).toBe(false);
  const sharedBends=f.route.filter(p=>distanceToRoad(p,f.highway)<.00001);
  expect(sharedBends.length,'freight reuses the highway rather than a parallel duplicate').toBeGreaterThan(15);
  const lane=lanePath(f.route);
  for(const p of sample(lane))expect(distanceToRoad(p,f.route)+.18).toBeLessThan(HIGHWAY.width/2+.015);
  for(const leg of f.truck.legs)if(!leg.hold){
   const d=Math.hypot(leg.b[0]-leg.a[0],leg.b[1]-leg.a[1]),ux=(leg.b[0]-leg.a[0])/d,uz=(leg.b[1]-leg.a[1])/d;
   for(const t of [0,.5,1])for(const along of [vehicleBounds("semi").rear,vehicleBounds("semi").front])for(const across of [-vehicleBounds("semi").halfWidth,vehicleBounds("semi").halfWidth]){
    const p:Pt=[leg.a[0]+(leg.b[0]-leg.a[0])*t+ux*along-uz*across,leg.a[1]+(leg.b[1]-leg.a[1])*t+uz*along+ux*across];
    expect(onRoad(p,f.route),'whole truck fits the road through turns').toBe(true);
   }
  }
  for(let i=1;i<f.truck.legs.length;i++)expect(f.truck.legs[i].a).toEqual(f.truck.legs[i-1].b);
  expect(f.truck.legs[f.truck.legs.length-1].b).toEqual(f.truck.legs[0].a);
  {const lot=s.dealership!.lot;expect(pathClear(f.route.filter(p=>distanceToRoad(p,f.highway)>.001),[{x:lot.x+lot.w/2,z:lot.z+lot.d/2,w:lot.w,d:lot.d}],.3),'freight reaches the highway without detouring through BMW').toBe(true);}
  const links=s.transportConnections;
  for(const link of links)for(const junction of roadIntersections(f.highway,link.road)){
   expect(f.exits.some(p=>Math.hypot(p[0]-junction[0],p[1]-junction[1])<.01),'district highway junction is planned').toBe(true);
   for(const side of [-1,1])for(const rail of roadStrips(f.highway,side*HIGHWAY.barrier,f.exits))expect(distanceToRoad(junction,[rail.a,rail.b]),'barriers leave district access open').toBeGreaterThanOrEqual(HIGHWAY.junctionRadius);
  }

  expect(links.every(l=>l.road.length>1&&l.walk.length>1)).toBe(true);
  for(const link of links){
   for(let i=1;i<link.road.length;i++)expect(link.road[i][0]===link.road[i-1][0]||link.road[i][1]===link.road[i-1][1]).toBe(true);
   for(const p of sample(link.walk))for(const b of boxes)expect(Math.abs(p[0]-b.x)<b.size/2&&Math.abs(p[1]-b.z)<b.size/2,`${link.id} crosses ${b.name}`).toBe(false);
  }
  const runwayX=airportPoint(a,AIRPORT_LAYOUT.runwayX,0)[0];
  for(const link of links)for(const p of sample(link.walk))expect(Math.abs(p[0]-runwayX)>AIRPORT_LAYOUT.runwayWidth/2+.225 || p[1]<a.z-3.225 || p[1]>a.z+18.225,'public walkway stays outside active runway').toBe(true);
  for(const p of sample(f.route))if(Math.abs(p[0]-runwayX)<AIRPORT_LAYOUT.runwayWidth/2+HIGHWAY.width/2)expect(p[1]<a.z+AIRPORT_LAYOUT.runwayZ-AIRPORT_LAYOUT.runwayLength/2-.7 || p[1]>a.z+AIRPORT_LAYOUT.runwayZ+AIRPORT_LAYOUT.runwayLength/2+.7).toBe(true);
 });
 it('has a continuous taxi, hold and departure path and freezes under reduced motion',()=>{
  for(let t=.05;t<210;t+=.05){const p=airportFlightPose(t),before=airportFlightPose(t-.05);if(p.visible&&before.visible)expect(Math.hypot(p.x-before.x,p.z-before.z,p.y-before.y)).toBeLessThan(.6);}
  expect(airportFlightPose(12).x).toBeGreaterThan(11.5);
  expect(airportFlightPose(20).x).toBe(15);
  expect(airportFlightPose(100,false)).toEqual(airportFlightPose(0));
 });
});
