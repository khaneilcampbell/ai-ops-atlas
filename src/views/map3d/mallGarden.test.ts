import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {GARDEN,gardenPieceCount,planMallGarden} from './mallGarden';

const sceneFor=(g:GroupBy='district')=>buildScene(layoutMap(catalog,[],g));
const inside=(r:{x:number;z:number;w:number;d:number},x:number,z:number,pad=0)=>x>=r.x-pad&&x<=r.x+r.w+pad&&z>=r.z-pad&&z<=r.z+r.d+pad;

describe('Marketplace Gardens',()=>{
 const s=sceneFor(),m=s.mall!,g=s.mallGarden!;
 it('lays a garden on the green behind the mall, on the mall axis',()=>{
  expect(g).toBeDefined();
  expect(g.axis).toBeCloseTo(m.cx);
  expect(g.rect.x+g.rect.w/2).toBeCloseTo(m.cx);
  expect(g.rect.z+g.rect.d).toBeLessThanOrEqual(m.z);
  expect(g.rect.w).toBeGreaterThanOrEqual(GARDEN.minHalf*2);
  // Every corner stands on land.
  for(const [x,z] of [[g.rect.x,g.rect.z],[g.rect.x+g.rect.w,g.rect.z],[g.rect.x,g.rect.z+g.rect.d],[g.rect.x+g.rect.w,g.rect.z+g.rect.d]])
   expect(s.land.some(r=>inside(r,x,z,1e-6))).toBe(true);
 });
 it('stays clear of buildings and keeps every planting on its own ground',()=>{
  for(const b of [...s.towers,...s.kiosks,...s.retail])expect(Math.abs(b.x-g.axis)<g.rect.w/2+b.size/2&&b.z+b.size/2>g.rect.z&&b.z-b.size/2<g.rect.z+g.rect.d).toBe(false);
  const plaza=m.plaza;
  for(const t of g.trees)expect(inside(g.rect,t.x,t.z)||inside(plaza,t.x,t.z)).toBe(true);
  for(const b of g.boxes)expect(inside(g.rect,b.x,b.z)||inside(plaza,b.x,b.z)).toBe(true);
  // Trees are not planted inside one another, and none stand in the canal.
  for(let i=0;i<g.trees.length;i++)for(let j=i+1;j<g.trees.length;j++)expect(Math.hypot(g.trees[i].x-g.trees[j].x,g.trees[i].z-g.trees[j].z)).toBeGreaterThan(.35);
  for(const t of g.trees)expect(inside(g.canal,t.x,t.z,.15)).toBe(false);
 });
 it('is mirror symmetric about the mall axis',()=>{
  const key=(x:number,z:number)=>`${Math.round(x*100)}:${Math.round(z*100)}`;
  const trees=new Set(g.trees.map(t=>key(t.x-g.axis,t.z)));
  for(const t of g.trees)expect(trees.has(key(g.axis-t.x,t.z))).toBe(true);
 });
 it('joins the map\'s own tree, bush and path light lists, replacing what stood there',()=>{
  for(const t of g.trees)expect(s.trees).toContain(t);
  for(const b of g.bollards)expect(s.bollards).toContain(b);
  const strays=s.trees.filter(t=>inside(g.rect,t.x,t.z)&&!g.trees.includes(t));
  expect(strays).toEqual([]);
 });
 it('holds a piece budget',()=>{
  expect(gardenPieceCount(g)).toBeLessThan(400);
  expect(g.boxes.length).toBeLessThan(80);
 });
 it('draws nothing when the green is missing or built on',()=>{
  expect(planMallGarden(m,[],[],.6)).toBeUndefined();
  expect(planMallGarden(m,s.land,[{x:g.axis-.5,z:g.rect.z+2,w:1,d:1}],.6)).toBeUndefined();
 });
 it('every map grouping either lays out a full garden or none',()=>{
  for(const grouping of ['district','type','status'] as GroupBy[]){
   const sc=sceneFor(grouping);
   if(sc.mallGarden)expect(sc.mallGarden.trees.length).toBeGreaterThan(10);
  }
 });
});
