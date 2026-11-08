import {describe,expect,it} from 'vitest';
import {galleriaCrowd,galleriaRuns,toIn,GALLERIA_IN} from './GalleriaInterior';
import {GALLERIA_OUTLINE,insidePoly} from '../map3d/galleriaPlan';

const base=(f:number)=>f===0?-GALLERIA_IN.heights[0]:GALLERIA_IN.heights.slice(1,f).reduce((a,h)=>a+h,0);

describe('Atlas Galleria interior',()=>{
 it('puts people on every floor, at that floor’s height',()=>{
  for(const f of [0,1,2,3]){const people=galleriaCrowd(f,base(f));expect(people.length,`floor ${f}`).toBeGreaterThan(0);for(const p of people)expect(p.path[0][1]).toBe(base(f));}
 });
 it('joins every floor to the next: a stair from the basement, and an up and a down escalator between shopping floors',()=>{
  expect(galleriaRuns(0).map(r=>r.kind)).toEqual(['stair']);
  for(const f of [1,2])expect(galleriaRuns(f).map(r=>r.kind).sort()).toEqual(['down','up']);
  expect(galleriaRuns(3)).toEqual([]);
  for(const f of [0,1,2])for(const r of galleriaRuns(f)){expect(r.foot[1]).toBeCloseTo(base(f),6);expect(r.top[1]).toBeCloseTo(base(f+1),6);}
 });
 it('sends people off every floor by its flights, and out of the building from the ground floor',()=>{
  const uses=(f:number,g:number)=>galleriaCrowd(f,base(f)).filter(p=>galleriaRuns(g).some(r=>[r.foot,r.top].every(e=>p.path.some(q=>Math.hypot(q[0]-e[0],q[1]-e[1],q[2]-e[2])<1e-9))));
  expect(uses(0,0).length).toBeGreaterThan(0);expect(uses(1,1).length).toBeGreaterThan(0);expect(uses(2,2).length).toBeGreaterThan(0);expect(uses(3,2).length).toBeGreaterThan(0);
  // Ground-floor leavers walk out past the glass, beyond the building's outline, and back.
  const outline=GALLERIA_OUTLINE.map(toIn);
  expect(galleriaCrowd(1,0).some(p=>p.path.some(q=>!insidePoly(outline,[q[0],q[2]])))).toBe(true);
 });
 it('keeps the basement stair clear of the column grid',()=>{
  const [r]=galleriaRuns(0);
  for(let px=0;px<=80;px+=10)for(let py=0;py<=60;py+=10){const [x,z]=toIn([px,py]);
   const t=Math.max(0,Math.min(1,((x-r.foot[0])*(r.top[0]-r.foot[0])+(z-r.foot[2])*(r.top[2]-r.foot[2]))/((r.top[0]-r.foot[0])**2+(r.top[2]-r.foot[2])**2)));
   expect(Math.hypot(x-r.foot[0]-(r.top[0]-r.foot[0])*t,z-r.foot[2]-(r.top[2]-r.foot[2])*t),`column ${px},${py}`).toBeGreaterThan(.55+.23);}
 });
});
