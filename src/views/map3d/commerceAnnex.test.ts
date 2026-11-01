import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {ANNEX,annexFront,annexPlan,annexReach,annexShape,isCommerceAnnex} from './commerceAnnexPlan';
import {annexGeometry,annexTriangles} from './commerceAnnexGeometry';
import {isCommerceTower} from './commerceTowerPlan';

describe('Commerce district tool offices',()=>{
 const scene=buildScene(layoutMap(catalog,[],'district'));
 const tower=scene.towers.find(t=>isCommerceTower(t.projectId))!;
 const annexes=scene.kiosks.filter(isCommerceAnnex).sort((a,b)=>a.key<b.key?-1:1);
 it('covers every Commerce tool and no other district',()=>{
  expect(annexes.map(k=>k.name).sort()).toEqual(expect.arrayContaining(['Canva','Serper','Stripe']));
  for(const k of scene.kiosks)expect(isCommerceAnnex(k)).toBe(k.projectId==='commerce-pipeline');
 });
 it('fits each office and its plinth inside its own lot',()=>{
  annexes.forEach((k,i)=>{const r=annexReach(annexShape(k,tower,i));expect(r.x).toBeLessThanOrEqual(k.size/2+.02);expect(r.z).toBeLessThanOrEqual(k.size/2+.02);});
 });
 it('points each office at the main tower and twists neighbours opposite ways',()=>{
  const shapes=annexes.map((k,i)=>annexShape(k,tower,i));
  annexes.forEach((k,i)=>{const pt=annexPlan(shapes[i],0)[0],toTower=[tower.x-k.x,tower.z-k.z],l=Math.hypot(toTower[0],toTower[1]);
   expect((pt[0]*toTower[0]+pt[1]*toTower[1])/(Math.hypot(pt[0],pt[1])*l)).toBeGreaterThan(.99);});
  for(let i=1;i<shapes.length;i++)expect(Math.sign(shapes[i].twist)).toBe(-Math.sign(shapes[i-1].twist));
 });
 it('keeps the door on the side facing the lot path',()=>{
  annexes.forEach((k,i)=>expect(annexFront(annexShape(k,tower,i)).z).toBeGreaterThan(0));
 });
 it('stays well under the main tower',()=>{
  for(const k of annexes)expect(k.height??0).toBeLessThan((tower.customHeight??tower.height)*.8);
 });
 it('stays cheap: a few meshes and under 4k triangles each',()=>{
  annexes.forEach((k,i)=>{const g=annexGeometry(annexShape(k,tower,i),k.height??4);expect(Object.keys(g).length).toBeLessThanOrEqual(5);expect(annexTriangles(g)).toBeLessThan(4000);for(const x of Object.values(g))x.dispose();});
  expect(ANNEX.levels).toBeLessThanOrEqual(12);
 });
});
