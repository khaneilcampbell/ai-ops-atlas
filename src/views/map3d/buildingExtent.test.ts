import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {anchorsOf} from './Map3D';
import {buildScene,type Rect} from './scene';
import {districtRect,unionRect,wholeBuilding} from './buildingExtent';
import {isGithubTower} from './githubTowerPlan';

// One building, one district, one selection (Khaneil, 2026-11-09). Every part of a building must sit
// in its own project's district, and the outline a click draws must cover the whole building.
const GROUPINGS:GroupBy[]=['district','none','status','tag'];
const EPS=1e-6;
const within=(r:Rect,o:Rect)=>r.x>=o.x-EPS&&r.z>=o.z-EPS&&r.x+r.w<=o.x+o.w+EPS&&r.z+r.d<=o.z+o.d+EPS;
const overlaps=(a:Rect,b:Rect)=>a.x<b.x+b.w-EPS&&a.x+a.w>b.x+EPS&&a.z<b.z+b.d-EPS&&a.z+a.d>b.z+EPS;
const box=(x:number,z:number,w:number,d:number):Rect=>({x:x-w/2,z:z-d/2,w,d});

describe.each(GROUPINGS)('%s grouping',(g)=>{
 const layout=layoutMap(catalog,[],g);
 const scene=buildScene(layout);
 const anchors=anchorsOf(scene,layout);

 it("puts every tower, tool office and house in its own project's district",()=>{
  const parts=[
   ...scene.towers.map(t=>({key:t.key,p:t.projectId,r:box(t.x,t.z,t.size,t.size)})),
   ...scene.kiosks.map(k=>({key:k.key,p:k.projectId,r:box(k.x,k.z,k.size,k.size)})),
   ...scene.houses.map(h=>({key:h.key,p:h.projectId,r:box(h.x,h.z,h.w,h.d)})),
  ];
  for(const {key,p,r} of parts){
   const own=districtRect(scene,p);
   expect(own,`${key} has no district`).toBeDefined();
   expect(within(r,own!),`${key} spills out of ${p}`).toBe(true);
  }
 });

 it("keeps the GitHub podium in Profile Tower's district and nobody else's",()=>{
  const a=scene.githubAnnex;
  if(!a)return;
  const tower=scene.towers.find(t=>isGithubTower(t.projectId))!;
  const own=districtRect(scene,tower.projectId)!;
  for(const p of [...a.tiers,a.skybridge]){
   const r={x:p.x0,z:p.z0,w:p.x1-p.x0,d:p.z1-p.z0};
   expect(within(r,own)).toBe(true);
   for(const t of scene.terraces.filter(t=>!t.park&&t.id!==tower.projectId))expect(overlaps(r,t),`podium overlaps ${t.id}`).toBe(false);
  }
  // The district glow takes in both of its terraces, not only the first one found.
  expect(own).toEqual(unionRect(scene.terraces.filter(t=>t.id===tower.projectId)));
  expect(scene.terraces.filter(t=>t.id===tower.projectId).length).toBe(2);
 });

 it('outlines the whole GitHub building when Profile Tower is selected',()=>{
  const a=scene.githubAnnex;
  if(!a)return;
  const tower=scene.towers.find(t=>isGithubTower(t.projectId))!;
  const whole=anchors.get(tower.key)!.whole;
  expect(whole).toBeDefined();
  const r=box(whole!.x,whole!.z,whole!.w,whole!.d);
  expect(within(box(tower.x,tower.z,tower.size,tower.size),r)).toBe(true);
  for(const p of [...a.tiers,a.skybridge])expect(within({x:p.x0,z:p.z0,w:p.x1-p.x0,d:p.z1-p.z0},r)).toBe(true);
 });
});

it('wholeBuilding grows a footprint to take in its parts',()=>{
 expect(wholeBuilding({x:0,z:0,w:2,d:2},[{x0:2,x1:4,y0:0,y1:1,z0:-1,z1:0}])).toEqual({x:1.5,z:0,w:5,d:2});
});
