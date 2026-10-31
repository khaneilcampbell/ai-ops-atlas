import {describe,it,expect} from 'vitest';
import {HIGHWAY,roundedRoad,offsetRoad,roadProfile,roadStrips,distanceToRoad,lanePath} from './highway';
import type {Pt} from './roads';
const loop=roundedRoad([[0,0],[20,0],[20,20],[0,20],[0,0]],HIGHWAY.cornerRadius,true);
describe('highway cross-sections',()=>{
 it('keeps offset barriers closed without folding the seam into traffic',()=>{
  for(const offset of [-HIGHWAY.barrier,HIGHWAY.barrier]){
   const edge=offsetRoad(loop,offset);expect(edge[0]).toEqual(edge[edge.length-1]);
   for(const p of edge)expect(distanceToRoad(p,loop)).toBeGreaterThan(HIGHWAY.width/2);
  }
 });
 it('tapers bend widening gradually and preserves the centerline',()=>{
  const profile=roadProfile(loop);expect(profile.points[0]).toEqual(loop[0]);expect(profile.points[profile.points.length-1]).toEqual(loop[loop.length-1]);
  for(let i=1;i<profile.widths.length;i++)expect(Math.abs(profile.widths[i]-profile.widths[i-1])).toBeLessThan(.065);
  for(const w of profile.widths){expect(w).toBeGreaterThanOrEqual(HIGHWAY.width);expect(w).toBeLessThanOrEqual(HIGHWAY.turnWidth);}
 });
 it('cuts junction mouths locally while retaining barriers along the rest of a straight',()=>{
  const path:Pt[]=[[0,0],[20,0]],junction:Pt=[10,0],strips=roadStrips(path,HIGHWAY.barrier,[junction]);
  expect(strips.some(s=>s.a[0]<2)).toBe(true);expect(strips.some(s=>s.b[0]>18)).toBe(true);
  for(const s of strips)expect(distanceToRoad(junction,[s.a,s.b])).toBeGreaterThanOrEqual(HIGHWAY.junctionRadius);
 });
 it('keeps opposing lanes separated on the same road and preserves terminal alignment',()=>{
  const path:Pt[]=[[0,0],[0,10],[10,10]],out=lanePath(path),back=lanePath([...path].reverse()).reverse();
  expect(out[0]).toEqual(path[0]);expect(out[out.length-1]).toEqual(path[path.length-1]);
  expect(Math.hypot(out[1][0]-back[1][0],out[1][1]-back[1][1])).toBeGreaterThan(.6);
 });
});
