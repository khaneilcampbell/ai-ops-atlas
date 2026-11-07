import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {airportFootprint,airportFlightPose,AIRPORT_LAYOUT,airportPoint} from './airport';
import type {Pt} from './roads';
const sample=(path:Pt[],step=.15)=>path.slice(1).flatMap((b,i)=>{const a=path[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));return Array.from({length:n+1},(_,j)=>[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n] as Pt);});
describe('shared transportation plan',()=>{
 for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`keeps routes connected and clear in ${grouping} view`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),a=s.airport!;
  // No freight trunk road or truck lot cuts through the Commerce district (KC, 2026-11-07).
  expect(s.freight).toBeUndefined();
  expect(s.land).toContainEqual(airportFootprint(a));
  const stadium=s.stadium!,parcel={x:stadium.x-2,z:stadium.z-2,w:stadium.w+4,d:stadium.d+4};
  for(const r of s.land)if(r.x!==parcel.x||r.z!==parcel.z)expect(parcel.x<r.x+r.w&&parcel.x+parcel.w>r.x&&parcel.z<r.z+r.d&&parcel.z+parcel.d>r.z,'stadium parcel overlap').toBe(false);
  const boxes=[...s.towers,...s.kiosks,...s.retail];
  const links=s.transportConnections;
  expect(links.every(l=>l.road.length>1&&l.walk.length>1)).toBe(true);
  for(const link of links){
   for(let i=1;i<link.road.length;i++)expect(link.road[i][0]===link.road[i-1][0]||link.road[i][1]===link.road[i-1][1]).toBe(true);
   for(const p of sample(link.walk))for(const b of boxes)expect(Math.abs(p[0]-b.x)<b.size/2&&Math.abs(p[1]-b.z)<b.size/2,`${link.id} crosses ${b.name}`).toBe(false);
  }
  const runwayX=airportPoint(a,AIRPORT_LAYOUT.runwayX,0)[0];
  for(const link of links)for(const p of sample(link.walk))expect(Math.abs(p[0]-runwayX)>AIRPORT_LAYOUT.runwayWidth/2+.225 || p[1]<a.z-3.225 || p[1]>a.z+18.225,'public walkway stays outside active runway').toBe(true);
 });
 it('has a continuous taxi, hold and departure path and freezes under reduced motion',()=>{
  for(let t=.05;t<210;t+=.05){const p=airportFlightPose(t),before=airportFlightPose(t-.05);if(p.visible&&before.visible)expect(Math.hypot(p.x-before.x,p.z-before.z,p.y-before.y)).toBeLessThan(.6);}
  expect(airportFlightPose(12).x).toBeGreaterThan(11.5);
  expect(airportFlightPose(20).x).toBe(15);
  expect(airportFlightPose(100,false)).toEqual(airportFlightPose(0));
 });
});
