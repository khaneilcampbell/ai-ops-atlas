import {describe,expect,it} from 'vitest';
import {COMMERCE,commerceScale} from '../map3d/commerceTowerPlan';
import {columns,commerceCityFit,commerceOutline,cores,fixtures,goldAt,groundFloor,inside,type Item} from './commerceInteriorPlan';

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
 it('keeps every piece of lobby furniture clear of the others (a desk cross shares its centre on purpose)',()=>{
  const half=(i:Item)=>i.r?Math.max(i.w,i.d)/2:i.w/2,deep=(i:Item)=>i.r?Math.max(i.w,i.d)/2:i.d/2,onTop=['teller','stool','meetingTable'];
  for(const [w,d] of [[8.5,7],[12,9],[16,10]]){const items=groundFloor(w,d).filter(i=>!onTop.includes(i.kind)),hits:string[]=[];
   for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++){const A=items[a],B=items[b];
    if(A.kind==='desk'&&B.kind==='desk')continue;
    if(Math.abs(A.x-B.x)<half(A)+half(B)&&Math.abs(A.z-B.z)<deep(A)+deep(B))hits.push(`${A.kind}/${B.kind}`);}
   expect(hits,`${w}x${d}`).toEqual([]);}
 });
 it('hangs the display on the main core and stands the rack and plants inside the glass, off the furniture',()=>{
  for(const [w,d] of [[8.5,7],[12,9]]){const pts=commerceOutline(w,d),f=fixtures(w,d),[core]=cores(w,d),items=groundFloor(w,d);
   expect(f.display.z).toBeCloseTo(core.z+core.d/2+.03);
   for(const p of [f.rack,...f.plants]){expect(inside([p.x,p.z],pts)).toBe(true);
    for(const c of cores(w,d))expect(Math.abs(p.x-c.x)>c.w/2+.25||Math.abs(p.z-c.z)>c.d/2+.25).toBe(true);
    for(const i of items)expect(Math.abs(p.x-i.x)>i.w/2+.3||Math.abs(p.z-i.z)>i.d/2+.3,`${i.kind}`).toBe(true);}}
 });
 for(const size of [2.6,COMMERCE.refSize,3.4])it(`keeps the city's streets off the glass in the all-floors view (tower size ${size})`,()=>{
  // Khaneil, 2026-11-24: the teardrop stood in the road. Every point of the glass, mapped into
  // the city, must stay inside the map tower's plinth, which the streets run round.
  const tower={x:12.5,z:-7,size},fit=commerceCityFit(16,10,tower),half=COMMERCE.plinth*commerceScale(size);
  for(const [x,z] of commerceOutline(16,10)){
   const mx=fit.anchor.x+x/fit.scale,mz=fit.anchor.z+z/fit.scale;
   expect(Math.abs(mx-tower.x)).toBeLessThanOrEqual(half);expect(Math.abs(mz-tower.z)).toBeLessThanOrEqual(half);
  }
 });
});
