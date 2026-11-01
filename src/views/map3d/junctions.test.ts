import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {crossingsAt,financialJunctions,intersectionParts,junctionSpans} from './junctions';
import {FINANCIAL as F} from './financialPlan';
import {TRANSPORT as T} from './transportScale';
import {straightenJogs} from './routing';
import type {Pt} from './roads';

const half=T.cityWidth/2;
describe('street intersections',()=>{
 it('merges a staggered pair of side roads into one junction and widens for a road at an angle',()=>{
  const spans=junctionSpans(0,-10,10,[[[0,5],[0,-5]],[[1,5],[1,.2]],[[6,3],[7,-3]]]);
  expect(spans).toHaveLength(2);
  expect(spans[0]).toMatchObject({lo:-half,hi:1+half,north:true,south:true});
  expect(spans[1].hi-spans[1].lo,'a slanted road opens more curb').toBeGreaterThan(2*half);
  expect(crossingsAt(0,-10,10,[[[-5,0],[5,0]]]),'a road along the line is not a crossing').toEqual([]);
 });
 it('cuts dashes, curbs and walks at each junction and patches it flat',()=>{
  const spans=junctionSpans(0,0,20,[[[5,3],[5,-3]],[[12,3],[12,0]]]);
  const p=intersectionParts(0,0,20,[16],spans,{north:-.8,south:.9},{north:.6,south:.65},{north:[[5-half,5+half]],south:[[5-half,5+half],[12-half,12+half]]});
  for(const j of spans){
   expect(p.dashes.some(d=>d>j.lo-.16&&d<j.hi+.16),'no dash inside a junction').toBe(false);
   for(const side of ['north','south'] as const)if(j[side])expect(p.curbs[side].some(([lo,hi])=>hi>j.lo&&lo<j.hi),`${side} curb open`).toBe(false);
  }
  expect(p.curbs.north.some(([lo,hi])=>lo<12&&hi>12),'a T keeps the curb on its far side').toBe(true);
  expect(p.walks.south.some(([lo,hi])=>hi>12-half&&lo<12+half)).toBe(false);
  const patch=p.patches.find(q=>Math.abs(q.x-5)<1e-6&&q.y<.05&&Math.abs(q.z)<.5)!;
  expect(patch.w).toBeCloseTo(2*half);expect(patch.d,'covers the street and both curb lines').toBeGreaterThan(T.cityWidth+.1);
  expect(patch.y+patch.h,'sits just above the street, no flicker').toBeGreaterThan(.06);
 });
 it('moves a jog beside a street onto the street, even when the street runs close to buildings',()=>{
  const street:Pt[]=[[-10,0],[10,0]],tower={x:-2.2,z:-1,w:1,d:.6};
  const out=straightenJogs([[-1,8],[-1,1.6],[0,1.6],[0,-8]],[tower],.73,1,[street]);
  expect(out.some(p=>Math.abs(p[1])<1e-9),'the jog now runs along the street').toBe(true);
 });
 it('gives the financial main street clean junctions with nothing doubled on it',()=>{
  const s=buildScene(layoutMap(catalog,[],'district')),f=s.financial!,z=f.street[0][1];
  const {spans}=financialJunctions(s,{north:F.northWalkZ,south:F.promenadeZ});
  expect(spans.length).toBeGreaterThanOrEqual(2);
  for(let i=1;i<spans.length;i++)expect(spans[i].lo,'junctions never overlap').toBeGreaterThan(spans[i-1].hi);
  // The stadium collector reaches the street at a junction, not a short S-bend beside it.
  for(const a of s.freight!.access)for(let i=1;i<a.collector.length;i++){
   const p=a.collector[i-1],q=a.collector[i];if(Math.abs(p[1]-q[1])>1e-6||Math.abs(p[1]-z)<1e-6)continue;
   const d=Math.abs(p[1]-z);expect(d<.05||d>1.75,`${a.id}: no jog squeezed between the street and the promenade`).toBe(true);
  }
 });
});
