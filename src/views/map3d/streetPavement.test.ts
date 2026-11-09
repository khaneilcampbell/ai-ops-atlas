import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {SIDEWALK,streetPavement} from './streetPavement';
import {TRANSPORT} from './transportScale';

describe('street pavement',()=>{
 it('carries a north-south avenue straight on into the Financial District',()=>{
  const s=buildScene(layoutMap(catalog,[],'district'));
  const road=s.transportConnections.find(c=>c.id==='financial-district')?.road;
  expect(road).toHaveLength(2);
  const [a,b]=road!;expect(a[0]).toBeCloseTo(b[0],6);
  // It starts where a district street running north-south ends, not on a tower's driveway.
  expect(s.carBridges.some(br=>br.roads.some(r=>r.slice(1).some((q,i)=>Math.abs(q[0]-r[i][0])<1e-6&&Math.abs(q[1]-r[i][1])>1e-6&&[q,r[i]].some(p=>Math.abs(p[0]-a[0])<1e-6&&Math.abs(p[1]-a[1])<1e-6))))).toBe(true);
 });

 const scene=buildScene(layoutMap(catalog,[],'district'));
 const {pavement,markings}=streetPavement(scene);
 const walks=pavement.filter(p=>p.c===SIDEWALK.color);
 it('lines the district roads with sidewalks, junction zebras and styled plazas',()=>{
  expect(walks.length).toBeGreaterThan(40);
  expect(markings.some(m=>m.c===SIDEWALK.zebra)).toBe(true);
  expect(pavement.length-walks.length).toBeGreaterThan(8);
 });
 it('never puts a sidewalk on a carriageway',()=>{
  const half=TRANSPORT.cityWidth/2;
  const spans=(scene.transportConnections??[]).flatMap(l=>l.road.slice(1).map((p,i)=>[l.road[i],p]));
  for(const w of walks)for(const [a,b] of spans){
   const x0=Math.min(a[0],b[0])-(a[0]===b[0]?half:0),x1=Math.max(a[0],b[0])+(a[0]===b[0]?half:0),z0=Math.min(a[1],b[1])-(a[1]===b[1]?half:0),z1=Math.max(a[1],b[1])+(a[1]===b[1]?half:0);
   const ox=Math.min(w.p[0]+w.s[0]/2,x1)-Math.max(w.p[0]-w.s[0]/2,x0),oz=Math.min(w.p[2]+w.s[2]/2,z1)-Math.max(w.p[2]-w.s[2]/2,z0);
   expect(ox>1e-3&&oz>1e-3).toBe(false);
  }
 });
 it('stays a small addition to the triangle budget',()=>{
  // 12 triangles a box, no shadow pass: under 60k triangles for the whole city.
  expect((pavement.length+markings.length)*12).toBeLessThan(60_000);
 });
});
