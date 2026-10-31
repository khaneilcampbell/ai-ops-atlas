import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {agencyCrowd,hallSeats,poseAt} from './agencyCrowdPlan';
import {AGENCY_ROOMS,INTERIOR,SLOT_DOOR_Z,SLOT_HALF,atriumOpen,slotX} from './agencyInteriorPlan';

const crowd=agencyCrowd(),S=INTERIOR.storey,W=INTERIOR.width/2,D=INTERIOR.depth/2,a=INTERIOR.atrium,l=INTERIOR.lift;
const hall=AGENCY_ROOMS.find(r=>r.kind==='hall')!;
const inAtrium=(x:number,z:number,pad=0)=>Math.hypot(x-a.x,z-a.z)<a.r+pad;

describe('Benjaire Marketing Agency people',()=>{
 it('puts people on every floor: desk workers, walkers, the hall audience and one presenter',()=>{
  for(let level=0;level<INTERIOR.levels;level++){const here=crowd.filter(p=>p.level===level);
   expect(here.length,`floor ${level}`).toBeGreaterThan(3);expect(here.some(p=>p.path.length>1),`walkers on floor ${level}`).toBe(true);}
  for(const level of [1,2])expect(crowd.some(p=>p.level===level&&p.pose==='sit')).toBe(true);
  expect(crowd.filter(p=>p.level===0&&p.path.length>1).length).toBeGreaterThanOrEqual(3);
  const seats=hallSeats(hall),audience=crowd.filter(p=>p.level===hall.level&&p.pose==='sit'&&p.path[0][0]>hall.x&&p.path[0][0]<hall.x+hall.w);
  expect(audience.length).toBeGreaterThan(seats.length/2);
  for(const p of audience)expect(seats.some(([x,z])=>Math.abs(x-p.path[0][0])<1e-6&&Math.abs(z-p.path[0][2])<1e-6)).toBe(true);
  const presenters=crowd.filter(p=>p.pose==='present');expect(presenters).toHaveLength(1);
  for(const q of presenters[0].path){expect(q[1]).toBeCloseTo(.5);expect(q[0]).toBeGreaterThan(hall.x);expect(q[0]).toBeLessThan(hall.x+hall.w);expect(q[2]).toBeLessThan(hall.z+3.2);}
  expect(new Set(crowd.map(p=>p.id)).size).toBe(crowd.length);
 });

 it('moves smoothly and loops: no jumps, the same pose every cycle',()=>{
  for(const p of crowd.filter(p=>p.path.length>1)){
   let prev=poseAt(p,0);
   for(let t=.05;t<90;t+=.05){const q=poseAt(p,t),d=Math.hypot(q.x-prev.x,(q.y-prev.y)*1.5,q.z-prev.z);
    expect(d,`${p.id} jumps at ${t.toFixed(2)}s`).toBeLessThan(p.speed*.05*1.7+1e-6);prev=q;}
   expect(poseAt(p,12.3)).toEqual(poseAt(p,12.3));
  }
 });

 it('keeps every path walkable: inside the walls, off the lift, out of the void, through the slot door',()=>{
  for(const p of crowd){const pts=p.path,stair=pts.some(q=>Math.abs(q[1]-Math.round(q[1]/S)*S)>1e-6&&q[1]>.6);
   for(let i=0;i<pts.length;i++){const q=pts[i],r=pts[(i+1)%pts.length];
    for(let k=0;k<=20;k++){const t=k/20,x=q[0]+(r[0]-q[0])*t,z=q[2]+(r[2]-q[2])*t;
     expect(Math.abs(x)<W-.2&&Math.abs(z)<D-.2,`${p.id} leaves the building`).toBe(true);
     expect(x>l.x-l.w/2-.2&&x<l.x+l.w/2+.2&&z>l.z-l.d/2-.2&&z<l.z+l.d/2+.2,`${p.id} walks into the lift`).toBe(false);
     if(atriumOpen(p.level)&&!stair)expect(inAtrium(x,z),`${p.id} walks over the atrium void on floor ${p.level}`).toBe(false);}
    if(stair)expect(inAtrium(q[0],q[2],.6),`${p.id} stair point outside the atrium`).toBe(true);
    const sq=q[0]-slotX(q[2]),sr=r[0]-slotX(r[2]);
    if(Math.sign(sq)!==Math.sign(sr)&&Math.abs(sq)>SLOT_HALF&&Math.abs(sr)>SLOT_HALF)expect(Math.abs((q[2]+r[2])/2-SLOT_DOOR_Z),`${p.id} walks through the slot wall`).toBeLessThan(1.4);
   }
  }
 });

 it('stays cheap: two instanced meshes, no lights and no render loop of its own',()=>{
  const src=readFileSync(new URL('./AgencyCrowd.tsx',import.meta.url),'utf8');
  expect(src.match(/<instancedMesh/g)).toHaveLength(2);expect(src).not.toMatch(/Light|invalidate|setInterval|requestAnimationFrame/);
  expect(src.match(/useFrame\(/g)).toHaveLength(1);
  const plan=readFileSync(new URL('./agencyCrowdPlan.ts',import.meta.url),'utf8');expect(plan).not.toMatch(/fetch\(|anthropic|model:/i);
 });
});
