import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {AGENCY} from '../map3d/marketingAgencyPlan';
import {AGENCY_FLOORS,AGENCY_OFFICE_ID,AGENCY_ROOMS,EAST_EDGE,INTERIOR,SLOT_DOOR_Z,WEST_EDGE,atriumOpen,entranceX,slotX,SLOT_HALF,stairLanding,stairSteps,walkRoute,type AgencyRoom} from './agencyInteriorPlan';

const W=INTERIOR.width/2,D=INTERIOR.depth/2,a=INTERIOR.atrium,l=INTERIOR.lift;
const overlap=(p:{x:number;z:number;w:number;d:number},q:{x:number;z:number;w:number;d:number})=>p.x<q.x+q.w-1e-6&&q.x<p.x+p.w-1e-6&&p.z<q.z+q.d-1e-6&&q.z<p.z+p.d-1e-6;
const liftRect={x:l.x-l.w/2,z:l.z-l.d/2,w:l.w,d:l.d};
const hitsCircle=(r:AgencyRoom)=>{const nx=Math.max(r.x,Math.min(a.x,r.x+r.w)),nz=Math.max(r.z,Math.min(a.z,r.z+r.d));return Math.hypot(nx-a.x,nz-a.z)<a.r;};

describe('Benjaire Marketing Agency interior plan',()=>{
 it('matches the exterior at the interior scale and keeps four storeys',()=>{
  expect(INTERIOR.width).toBeCloseTo(AGENCY.length*INTERIOR.scale);
  expect(INTERIOR.depth).toBeCloseTo(AGENCY.depth*INTERIOR.scale);
  expect(INTERIOR.levels).toBe(AGENCY.storeys);
  expect(AGENCY_FLOORS).toHaveLength(INTERIOR.levels);
  expect(AGENCY_OFFICE_ID).toBe('skyline-business:Benjaire Marketing Agency');
 });

 it('keeps every room inside the walls, clear of the glass slot, the lift and each other',()=>{
  for(const r of AGENCY_ROOMS){
   expect(r.w,r.id).toBeGreaterThan(2);expect(r.d,r.id).toBeGreaterThan(2);
   expect(r.x,r.id).toBeGreaterThanOrEqual(-W);expect(r.x+r.w,r.id).toBeLessThanOrEqual(W);
   expect(r.z,r.id).toBeGreaterThanOrEqual(-D);expect(r.z+r.d,r.id).toBeLessThanOrEqual(D);
   expect(r.x+r.w<=WEST_EDGE+1e-6||r.x>=EAST_EDGE-1e-6,`${r.id} crosses the slot`).toBe(true);
   expect(overlap(r,liftRect),`${r.id} covers the lift`).toBe(false);
   expect(r.level).toBeGreaterThanOrEqual(0);expect(r.level).toBeLessThan(INTERIOR.levels);
  }
  for(const p of AGENCY_ROOMS)for(const q of AGENCY_ROOMS)if(p!==q&&p.level===q.level)expect(overlap(p,q),`${p.id} overlaps ${q.id}`).toBe(false);
 });

 it('keeps the slot clear at every depth and its walls inside the building',()=>{
  for(let z=-D;z<=D;z+=.5){
   expect(slotX(z)-SLOT_HALF).toBeGreaterThan(WEST_EDGE);expect(slotX(z)+SLOT_HALF).toBeLessThan(EAST_EDGE);
   expect(slotX(z)-SLOT_HALF).toBeGreaterThan(-W);expect(slotX(z)+SLOT_HALF).toBeLessThan(W);
  }
  // The atrium sits in the east block, clear of the slot.
  expect(a.x-a.r).toBeGreaterThan(EAST_EDGE-.4);expect(a.x+a.r).toBeLessThan(W);
  expect(Math.abs(a.z)+a.r).toBeLessThan(D);
 });

 it('opens the atrium on every upper floor and keeps rooms out of the void',()=>{
  expect(atriumOpen(0)).toBe(false);for(let l=1;l<INTERIOR.levels;l++)expect(atriumOpen(l)).toBe(true);
  expect(INTERIOR.atrium.openTo).toBe(INTERIOR.levels-1);
  for(const r of AGENCY_ROOMS.filter(r=>atriumOpen(r.level)))expect(hitsCircle(r),`${r.id} sits in the atrium void`).toBe(false);
  expect(AGENCY_ROOMS.find(r=>r.id==='0-reception')&&hitsCircle(AGENCY_ROOMS.find(r=>r.id==='0-reception')!)).toBe(true);
 });

 it('runs the curved stair inside the atrium, climbing one storey per flight',()=>{
  for(let level=0;level<a.openTo;level++){
   const steps=stairSteps(level);expect(steps).toHaveLength(INTERIOR.stair.steps);
   for(const st of steps){const r=Math.hypot(st.x-a.x,st.z-a.z);expect(r+INTERIOR.stair.width/2).toBeLessThan(a.r);}
   for(let i=1;i<steps.length;i++)expect(steps[i].y).toBeGreaterThan(steps[i-1].y);
   expect(steps.at(-1)!.y).toBeCloseTo((level+1)*INTERIOR.storey);
   const ln=stairLanding(level),end=steps.at(-1)!;
   expect(Math.hypot(ln.x-end.x,ln.z-end.z)).toBeLessThan(2);
  }
 });

 it('puts the entrance under the copper sweep on the plaza side',()=>{
  const ex=entranceX();expect(ex).toBeGreaterThan(EAST_EDGE);expect(ex).toBeLessThan(W);
 });

 it('gives every room a unique name and an honest planned role',()=>{
  for(let level=0;level<INTERIOR.levels;level++){const names=AGENCY_ROOMS.filter(r=>r.level===level).map(r=>r.name);expect(new Set(names).size).toBe(names.length);expect(names.length).toBeGreaterThan(0);}
  expect(new Set(AGENCY_ROOMS.map(r=>r.id)).size).toBe(AGENCY_ROOMS.length);
  for(const r of AGENCY_ROOMS){expect(r.role.length).toBeGreaterThan(3);expect(r.purpose).not.toMatch(/\b(live|running|connected to)\b/i);}
  for(const k of ['reception','cafe','gallery','hall'])expect(AGENCY_ROOMS.some(r=>r.kind===k),k).toBe(true);
 });

 it('stays honest and light on screen: planned labels, at most one light per floor, case-safe names',()=>{
  const src=readFileSync(new URL('./AgencyInterior.tsx',import.meta.url),'utf8');
  expect(src).toMatch(/Planned, not running/);expect(src).toMatch(/No ad, email or social accounts connected/);
  expect(src.match(/<pointLight/g)?.length??0).toBeLessThanOrEqual(1);
  // Per-frame work only in the walk-through tester, which mounts only while it runs.
  expect(src.match(/useFrame\(/g)?.length).toBe(1);expect(src).toMatch(/walk==='running'&&<WalkTester/);
  expect(src).toMatch(/Not an AI agent, no model calls/);
  const files=readdirSync(new URL('.',import.meta.url)).map(f=>f.toLowerCase());
  expect(new Set(files).size).toBe(files.length);
 });

 describe('walk-through test route',()=>{
  const route=walkRoute(),S=INTERIOR.storey,step=S/INTERIOR.stair.steps,ex=entranceX();
  const inAtrium=(p:number[],pad=0)=>Math.hypot(p[0]-a.x,p[2]-a.z)<a.r+pad;
  const inside=(p:number[])=>Math.abs(p[0])<W&&Math.abs(p[2])<D;
  it('starts and ends outside on the plaza, in front of the entrance',()=>{
   for(const p of [route[0],route.at(-1)!]){expect(p[2]).toBeGreaterThan(D);expect(p[1]).toBe(0);expect(Math.abs(p[0]-ex)).toBeLessThan(.01);}
  });
  it('reaches every floor and the top floor by the stair',()=>{
   const levels=new Set(route.map(p=>Math.round(p[1]/S*1000)/1000).filter(v=>Number.isInteger(v)));
   for(let l=0;l<INTERIOR.levels;l++)expect(levels.has(l),`floor ${l}`).toBe(true);
   expect(Math.max(...route.map(p=>p[1]))).toBeCloseTo((INTERIOR.levels-1)*S);
  });
  it('never jumps between floors: height changes only a step at a time, inside the atrium',()=>{
   for(let i=1;i<route.length;i++){const [p,q]=[route[i-1],route[i]],dy=Math.abs(q[1]-p[1]);
    expect(dy,`segment ${i}`).toBeLessThanOrEqual(step*1.01);
    if(dy>1e-6)expect(inAtrium(p,.6)&&inAtrium(q,.6),`stair segment ${i} leaves the atrium`).toBe(true);}
  });
  it('stays on floors: no walking across the atrium void, through the lift or through walls',()=>{
   for(let i=1;i<route.length;i++){const [p,q]=[route[i-1],route[i]];
    const flat=Math.abs(q[1]-p[1])<1e-6,level=Math.round(p[1]/S),onFloor=flat&&Math.abs(p[1]-level*S)<1e-6;
    for(let k=0;k<=20;k++){const t=k/20,x=p[0]+(q[0]-p[0])*t,z=p[2]+(q[2]-p[2])*t,pt=[x,p[1],z];
     // On an open floor, walking (not climbing) keeps out of the void, except stepping off a landing.
     const nearStair=[p,q].some(e=>inAtrium(e)&&!onFloor||Math.hypot(e[0]-a.x,e[2]-a.z)<a.r+.05);
     if(onFloor&&atriumOpen(level)&&!nearStair)expect(inAtrium(pt),`segment ${i} crosses the void on floor ${level}`).toBe(false);
     expect(x>l.x-l.w/2&&x<l.x+l.w/2&&z>l.z-l.d/2&&z<l.z+l.d/2,`segment ${i} enters the lift`).toBe(false);}
    // Crossing the slot only through the doorway.
    const sp=Math.sign(p[0]-slotX(p[2])),sq=Math.sign(q[0]-slotX(q[2]));
    if(inside(p)&&inside(q)&&sp!==sq&&Math.abs(p[0]-slotX(p[2]))>SLOT_HALF&&Math.abs(q[0]-slotX(q[2]))>SLOT_HALF)expect(Math.abs((p[2]+q[2])/2-SLOT_DOOR_Z),`segment ${i} crosses the slot wall`).toBeLessThan(1.4);
    if(inside(p)!==inside(q)){expect(p[1]).toBe(0);const z=D,t=(z-p[2])/(q[2]-p[2]);expect(Math.abs(p[0]+(q[0]-p[0])*t-ex),`segment ${i} leaves through a wall`).toBeLessThan(1.5);}
   }
  });
  it('visits the hall on the top floor through the slot door',()=>{
   const hall=AGENCY_ROOMS.find(r=>r.kind==='hall')!;expect(hall.level).toBe(INTERIOR.levels-1);
   expect(route.some(p=>Math.abs(p[1]-hall.level*S)<1e-6&&p[0]>hall.x&&p[0]<hall.x+hall.w&&p[2]>hall.z&&p[2]<hall.z+hall.d)).toBe(true);
  });
 });
});
