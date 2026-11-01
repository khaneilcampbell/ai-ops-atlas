import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene,TERRACE_H,type Rect} from './scene';
import {AGENCY,agencyRoof,archSpan,archTop,cutAt,sweepSpan,sweepTop} from './marketingAgencyPlan';
import {agencyGeometry} from './marketingAgencyGeometry';
import {planStreetLights} from './streetLighting';
import {distanceToRoad} from './highway';

const overlap=(a:Rect,b:Rect,pad=0)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>pad&&Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z)>pad;
const inside=(r:Rect,x:number,z:number,pad=0)=>x>r.x-pad&&x<r.x+r.w+pad&&z>r.z-pad&&z<r.z+r.d+pad;

describe('Benjaire Marketing Agency',()=>{
 const s=buildScene(layoutMap(catalog,[],'district')),a=s.agency!;
 const footprint={x:a.x,z:a.z,w:a.w,d:a.d};

 it('sits in the open bay between Benjaire HQ, Benjaire Dashboard and the Financial District',()=>{
  expect(a).toBeDefined();
  const f=s.financial!;
  // North of the city's own districts, south of the Financial District, with the channel kept open.
  expect(a.land[0].z).toBeGreaterThan(f.z+f.d);
  const hq=s.towers.find(t=>t.name==='Benjaire HQ')!,dash=s.towers.find(t=>t.name==='Benjaire Dashboard')!;
  expect(a.cx).toBeGreaterThan(hq.x);expect(a.cz).toBeLessThan(dash.z);
  // The new land fills water only: it never covers another parcel bigger than a coastal sliver.
  const others=s.land.filter(r=>!a.land.includes(r));
  for(const r of a.land)for(const o of others)if(o.w*o.d>=4)expect(overlap(r,o,1e-6),JSON.stringify({r,o})).toBe(false);
  // Clear of the BMW showroom, the Financial District and every other building.
  if(s.dealership)expect(overlap(a.land[0],s.dealership,0)).toBe(false);
  for(const t of [...s.towers,...s.kiosks,...s.retail])expect(overlap(footprint,{x:t.x-t.size/2,z:t.z-t.size/2,w:t.size,d:t.size},-.3)).toBe(false);
  expect(a.land[0].x).toBeGreaterThanOrEqual(Math.min(...a.land.map(r=>r.x)));
  for(const r of [footprint,...a.pools])expect(inside(a.land[0],r.x,r.z)&&inside(a.land[0],r.x+r.w,r.z+r.d)).toBe(true);
 });

 it('keeps roads, rails and bridges off the new land',()=>{
  const roads=[...s.carBridges.flatMap(b=>b.roads),...s.transportConnections.map(c=>c.road),...(s.freight?[s.freight.highway,s.freight.route,s.freight.cityAccess,...s.freight.access.flatMap(x=>[x.collector,...x.ramps])]:[]),...(s.communityRail?[s.communityRail.route]:[])];
  for(const road of roads)for(const r of a.land)for(let i=1;i<road.length;i++)for(let k=0;k<=20;k++){
   const p=road[i-1],q=road[i],x=p[0]+(q[0]-p[0])*k/20,z=p[1]+(q[1]-p[1])*k/20;
   expect(inside(r,x,z,-.05),`road at ${x},${z}`).toBe(false);
  }
 });

 it('follows the 96 m by 48 m plan, four tall storeys, at the city scale',()=>{
  expect(AGENCY.length/AGENCY.depth).toBeCloseTo(2,5);
  expect(AGENCY.length).toBeCloseTo(9.6,5);
  // A museum-height storey is three office floors.
  expect(AGENCY.storey).toBeCloseTo(.32*3,5);
  expect(AGENCY.eastHigh).toBeLessThanOrEqual(AGENCY.storeys*AGENCY.storey+.01);
  expect(AGENCY.eastHigh).toBeGreaterThan(AGENCY.westH);
  // A low monolith among towers: under every project tower top, well under the Financial District.
  for(const t of s.towers)expect(AGENCY.eastHigh).toBeLessThan(t.height);
 });

 it('cuts its openings inside the walls, with solid wall above them',()=>{
  const eastStart=cutAt(AGENCY.depth)+AGENCY.cutW/2,[s0,s1]=sweepSpan(),[a0,a1]=archSpan();
  expect(s0).toBeGreaterThan(eastStart);expect(s1).toBeLessThan(AGENCY.length);
  for(let x=s0;x<=s1;x+=.05)expect(sweepTop(x)).toBeLessThan(agencyRoof(x,eastStart)-.6);
  expect(a0).toBeGreaterThan(0);expect(a1).toBeLessThan(AGENCY.depth);
  for(let z=a0;z<=a1;z+=.05)expect(archTop(z)).toBeLessThan(AGENCY.eastHigh-.6);
  // The slot stays a slot: blocks on both sides at every depth.
  for(const z of [0,AGENCY.depth/2,AGENCY.depth]){const c=cutAt(z);expect(c-AGENCY.cutW/2).toBeGreaterThan(1.5);expect(c+AGENCY.cutW/2).toBeLessThan(s0);}
 });

 it('connects the plaza to Benjaire HQ and Benjaire Dashboard on foot',()=>{
  const ends=a.walks.flatMap(w=>[w[0],w[w.length-1]]);
  const onPaving=(p:[number,number])=>s.paving.some(q=>q.y>=TERRACE_H-.001&&!a.paving.includes(q)&&inside(q,p[0],p[1],.06));
  const outside=ends.filter(onPaving);
  expect(outside.length).toBeGreaterThanOrEqual(2);
  expect(outside.some(p=>p[0]<a.land[0].x)).toBe(true);
  expect(outside.some(p=>p[1]>a.land[0].z+a.land[0].d)).toBe(true);
  // The entrance walk meets the building under the copper sweep.
  const [s0,s1]=sweepSpan();expect(a.entry[0]).toBeGreaterThan(a.x+s0);expect(a.entry[0]).toBeLessThan(a.x+s1);
  // Every walk is also on the scene's pedestrian network.
  for(const w of a.walks)expect(s.walks.some(v=>v.route?.length===w.length&&v.route.every((p,i)=>p.gx===w[i][0]&&p.gy===w[i][1]))).toBe(true);
 });

 it('keeps lamps, trees and paths out of the building and the pools',()=>{
  for(const lamp of planStreetLights(s))for(const r of [footprint,...a.pools])expect(inside(r,lamp.x,lamp.z,.1),`lamp ${lamp.x},${lamp.z}`).toBe(false);
  for(const t of s.trees)for(const r of [footprint,...a.pools])expect(inside(r,t.x,t.z,.2)).toBe(false);
  for(const w of a.walks.filter(w=>w!==a.walks[a.walks.length-1]))for(const p of a.pools)expect(distanceToRoad([p.x+p.w/2,p.z+p.d/2],w)).toBeGreaterThan(Math.min(p.w,p.d)/2);
 });

 it('stays within the performance budget: static merged meshes, no lights of its own',()=>{
  const g=agencyGeometry();
  expect(g.triangles).toBeLessThan(6000);
  for(const k of ['shell','copper','glass'] as const){expect(g[k].getAttribute('position').count).toBeGreaterThan(0);expect(Number.isFinite(g[k].boundingSphere?.radius??(g[k].computeBoundingSphere(),g[k].boundingSphere!.radius))).toBe(true);}
  const source=readFileSync(new URL('./MarketingAgency.tsx',import.meta.url),'utf8');
  expect(source).not.toMatch(/<(point|spot|directional|ambient|hemisphere|rectArea)Light|new THREE\.\w*Light/);
  expect(source).not.toMatch(/useFrame/);
  expect((source.match(/<mesh /g)??[]).length).toBeLessThanOrEqual(6);
 });

 it('keeps file names in the map folder distinct regardless of letter case',()=>{
  // Compare module names without extension too: imports omit it, so Foo.tsx and foo.ts clash on a Mac.
  const names=readdirSync(new URL('.',import.meta.url)).map(n=>n.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
  const stems=names.filter(n=>/\.(ts|tsx)$/.test(n)&&!/\.test\.ts$/.test(n)).map(n=>n.replace(/\.(ts|tsx)$/,''));
  expect(stems.filter((n,i)=>stems.indexOf(n)!==i)).toEqual([]);
 });

 for(const g of ['none','status','tag'] as GroupBy[])it(`never covers other land or roads in the ${g} grouping`,()=>{
  const v=buildScene(layoutMap(catalog,[],g)),b=v.agency;if(!b)return;
  for(const r of b.land)for(const o of v.land.filter(l=>!b.land.includes(l)&&l.w*l.d>=4))expect(overlap(r,o,1e-6)).toBe(false);
  for(const t of v.towers)expect(overlap({x:b.x,z:b.z,w:b.w,d:b.d},{x:t.x-t.size/2,z:t.z-t.size/2,w:t.size,d:t.size})).toBe(false);
 });
});
