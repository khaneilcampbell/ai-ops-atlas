import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {COMMONS,planCommons} from './commonsPlan';
import type {Pt} from './roads';
const inside=(q:Pt,poly:Pt[])=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++)if((poly[i][1]>q[1])!==(poly[j][1]>q[1])&&q[0]<(poly[j][0]-poly[i][0])*(q[1]-poly[i][1])/(poly[j][1]-poly[i][1])+poly[i][0])hit=!hit;return hit;};
const scene=buildScene(layoutMap(catalog,[],'district')),p=scene.commons!;
describe('Atlas Commons',()=>{
 it('uses existing meadow without moving Service Desk or neighboring buildings',()=>{
  expect(p).toBeDefined();expect(scene.towers.find(t=>t.projectId==='service-desk')).toMatchObject({x:2.5,z:43});
  expect(p.rect.x+p.rect.w).toBeLessThan(scene.mall!.x);expect(p.rect.z+p.rect.d).toBeLessThan(scene.mall!.plaza.z);
  for(const b of [...scene.towers,...scene.kiosks])expect(b.x+b.size/2<p.rect.x||b.x-b.size/2>p.rect.x+p.rect.w||b.z+b.size/2<p.rect.z||b.z-b.size/2>p.rect.z+p.rect.d).toBe(true);
 });
 it('keeps the pond and amenities inside the parcel with a continuous dry loop',()=>{
  for(const [x,z]of [...p.pond,...p.loop,...p.trees,...p.benches,...p.lights]){expect(x).toBeGreaterThan(p.rect.x);expect(x).toBeLessThan(p.rect.x+p.rect.w);expect(z).toBeGreaterThan(p.rect.z);expect(z).toBeLessThan(p.rect.z+p.rect.d);}
  expect(p.loop[0]).toEqual(p.loop.at(-1));
  for(const path of p.paths)for(let i=1;i<path.length;i++)for(let t=0;t<=1;t+=.1){const q:Pt=[path[i-1][0]+(path[i][0]-path[i-1][0])*t,path[i-1][1]+(path[i][1]-path[i-1][1])*t];expect(inside(q,p.pond),`dry path ${JSON.stringify(q)}`).toBe(false);}
  for(const tree of p.trees)expect(inside(tree,p.pond)).toBe(false);
 });
 it('aligns two bridge landings with the loop and connects both district entrances',()=>{
  expect(p.bridges).toHaveLength(2);for(const [a,b]of p.bridges){expect(p.loop).toContainEqual(a);expect(p.loop).toContainEqual(b);expect(a[0]).toBeCloseTo(b[0]);expect(Math.abs(a[1]-b[1])).toBeGreaterThan(COMMONS.pathWidth*2);}
  expect(p.paths.some(path=>path.some(q=>q[0]===p.access.service[0]&&q[1]===p.access.service[1]))).toBe(true);
  expect(p.paths.some(path=>path.some(q=>q[0]===p.access.marketplace[0]&&q[1]===p.access.marketplace[1]))).toBe(true);
  expect(scene.transportConnections.find(c=>c.id==='skyline-airport')!.walk[0]).toEqual(p.access.service);
 });
 it('sets the amphitheater back from the street toward the park center',()=>{
  expect(p.amphitheater[0]-p.rect.x).toBeGreaterThan(3);expect(p.amphitheater[1]).toBeCloseTo(p.rect.z+p.rect.d*.67);
  expect(Math.hypot(p.amphitheater[0]-p.pavilion[0],p.amphitheater[1]-p.pavilion[1])).toBeGreaterThan(3.2);
  expect(inside(p.amphitheater,p.pond)).toBe(false);
 });
 it('is deterministic and preserves shared access data',()=>{expect(planCommons(scene)).toEqual(p);expect(scene.transportConnections.find(c=>c.id==='skyline-airport')!.walk[0]).toEqual(p.access.service);});
 it('omits the park when the available space or required neighbors are missing',()=>{
  expect(planCommons({...scene,mall:undefined})).toBeUndefined();
  expect(planCommons({...scene,mall:{...scene.mall!,x:10}})).toBeUndefined();
 });
});
