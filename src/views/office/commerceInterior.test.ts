import {describe,expect,it} from 'vitest';
import {COMMERCE} from '../map3d/commerceTowerPlan';
import {columns,commerceOutline,cores,goldAt,groundFloor,inside} from './commerceInteriorPlan';

// The wave tower inside, from the reference bank-headquarters plan (Khaneil, 2026-11-24).
describe('Commerce wave tower interior',()=>{
 for(const [w,d] of [[12,9],[16,10],[20,12]] as const)it(`keeps a ${w} by ${d} office floor inside its teardrop glass`,()=>{
  const pts=commerceOutline(w,d);expect(pts).toHaveLength(COMMERCE.ring);
  for(const p of [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]] as [number,number][])expect(inside(p,pts)).toBe(true);
  // Round end to +x: the plate is deeper there than at the point.
  const depthAt=(x:number)=>{const zs=pts.filter(p=>Math.abs(p[0]-x)<.6).map(p=>p[1]);return Math.max(...zs)-Math.min(...zs);};
  const xs=pts.map(p=>p[0]),x0=Math.min(...xs),x1=Math.max(...xs);
  expect(depthAt(x0+(x1-x0)*.75)).toBeGreaterThan(depthAt(x0+(x1-x0)*.15));
 });
 it('lays out the reference ground floor: counter, tellers, waiting seats, back office, lounge, café, meeting room, vault, ATMs',()=>{
  const items=groundFloor(16,10),kinds=new Set(items.map(i=>i.kind));
  for(const k of ['counter','teller','bench','desk','sofa','table','roundTable','glassRoom','meetingTable','vault','atm','reception','cafeBar'] as const)expect(kinds,k).toContain(k);
  const pts=commerceOutline(16,10);for(const it of items)expect(inside([it.x,it.z],pts),it.kind).toBe(true);
  // Nothing stands in a core.
  for(const c of cores(16,10))for(const it of items)expect(Math.abs(it.x-c.x)>c.w/2||Math.abs(it.z-c.z)>c.d/2,`${it.kind} in a core`).toBe(true);
 });
 it('stands its columns inside the glass, clear of the doors',()=>{
  const items=groundFloor(16,10),pts=commerceOutline(16,10),cols=columns(16,10,items);
  expect(cols.length).toBeGreaterThan(3);
  for(const [x,z] of cols){expect(inside([x,z],pts)).toBe(true);expect(Math.abs(x)<1.4&&z>0).toBe(false);}
 });
 it('turns part of the glass gold on every floor, where the ribbon wraps it',()=>{
  for(let level=0;level<5;level++){const n=COMMERCE.ring,gold=Array.from({length:n},(_,i)=>goldAt(i,level,n)).filter(Boolean).length;expect(gold,`floor ${level}`).toBeGreaterThan(2);expect(gold).toBeLessThan(n/2);}
 });
});
