import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {loopState} from './perimeterRailPlan';
import {vehicleAt} from './vehicles';
import {DISTRICT_WALKERS,planDistrictWalkers} from './districtWalkers';
import {YACHT,YACHT_SCALE} from './yachtPlan';
import {TRAVEL,planTravel,travellerAt,yachtCourse,yachtPoseAt,yachtSailing} from './travelLoops';

const scene=buildScene(layoutMap(catalog,[],'district')),plan=planTravel(scene)!,loop=scene.communityRail!.loop!;

describe('travel loops',()=>{
 it('re-uses the people already on the map: 18 travellers, and the office walkers drop by six', ()=>{
  // Six old train passengers, six yacht walkers and six of the 24 Financial District office walkers.
  expect(plan.travellers).toHaveLength(18);
  expect(DISTRICT_WALKERS.count).toBe(18);
  expect(planDistrictWalkers(scene.financial).length).toBeGreaterThanOrEqual(DISTRICT_WALKERS.count-2);
  expect(new Set(plan.travellers.map(t=>t.journey))).toEqual(new Set(['train-vendor','train-yacht','train-airport','car-arena','car-yacht','car-airport','car-vendor']));
  expect(plan.shuttles.map(s=>s.plan.id)).toEqual(['travel:taxi','travel:van','travel:car']);
  expect(plan.lap).toBeCloseTo(loop.period,6);
 });

 it('boards and leaves the train only while it stands at the right station with its doors open', ()=>{
  const at=(id:string)=>loop.stops.findIndex(s=>s.id===id);
  const to:Record<string,number>={'train-vendor':at('service:atlas-station'),'train-yacht':at('service:stadium-station'),'train-airport':at('service:stadium-station')};
  let rides=0;
  for(const p of plan.travellers)for(const r of p.rides.filter(r=>r.kind==='train')){
   rides++;
   expect(loopState(r.t0+p.offset+.01,loop)).toMatchObject({station:at('service:financial-station'),doors:1,moving:false});
   expect(loopState(r.t1+p.offset-.01,loop)).toMatchObject({station:to[p.journey],doors:1,moving:false});
  }
  expect(rides).toBe(8);
 });

 it('gets in and out of a shuttle only while it stands at a stop, and shuttles never turn back on themselves', ()=>{
  for(const s of plan.shuttles){
   const moving=s.plan.legs.filter(l=>!l.hold&&Math.hypot(l.b[0]-l.a[0],l.b[1]-l.a[1])>1e-6);
   for(let i=0;i<moving.length;i++){const a=moving[i],b=moving[(i+1)%moving.length],ux=a.b[0]-a.a[0],uz=a.b[1]-a.a[1],wx=b.b[0]-b.a[0],wz=b.b[1]-b.a[1];
    expect((ux*wx+uz*wz)/(Math.hypot(ux,uz)*Math.hypot(wx,wz)),s.plan.id).toBeGreaterThan(-.5);}
   const length=moving.reduce((n,l)=>n+Math.hypot(l.b[0]-l.a[0],l.b[1]-l.a[1]),0),time=moving.reduce((n,l)=>n+l.dur,0);
   expect(length/time).toBeLessThanOrEqual(TRAVEL.carSpeed*1.43+1e-6);
   expect(s.plan.period/plan.lap%1).toBeCloseTo(0,6);
  }
  let rides=0;
  for(const p of plan.travellers)for(const r of p.rides.filter(r=>r.kind==='car')){
   rides++;const s=plan.shuttles.find(s=>s.stops.some(q=>{const a=vehicleAt(s.plan,r.t0+p.offset);return Math.hypot(a.x-q[0],a.z-q[2])<.05;}));
   expect(s,`${p.id} gets into a car`).toBeTruthy();
   for(const t of [r.t0,r.t1-.05]){const a=vehicleAt(s!.plan,t+p.offset);expect(Math.min(...s!.stops.map(q=>Math.hypot(a.x-q[0],a.z-q[2]))),`${p.id} at ${t}`).toBeLessThan(.05);}
  }
  expect(rides).toBe(12);
 });

 it('walks smoothly, never jumps, and is out of sight only aboard or indoors', ()=>{
  for(const p of plan.travellers){
   expect(p.span[1]-p.span[0],p.id).toBeLessThan(p.period);
   let last:{x:number;z:number;t:number}|undefined;
   for(let t=0;t<p.period;t+=.1){const at=travellerAt(p,t+p.offset);
    if(at.visible){if(last&&Math.abs(last.t-t+.1)<1e-6)expect(Math.hypot(at.x-last.x,at.z-last.z),`${p.id} at ${t.toFixed(1)}`).toBeLessThan((TRAVEL.pace+.05)*.1+.03);last={x:at.x,z:at.z,t};}
   }
   // Every disappearance mid-trip is into a train or a car; the trip ends inside a building, a plane or the yacht.
   const walks=[...p.segs].sort((a,b)=>a.t0-b.t0);
   for(let i=1;i<walks.length;i++)if(walks[i].t0-walks[i-1].t1>1e-6)expect(p.rides.some(r=>r.t0<=walks[i-1].t1+1e-6&&r.t1>=walks[i].t0-1e-6),`${p.id} gap at ${walks[i-1].t1}`).toBe(true);
  }
 });

 it('sails the yacht once everyone is aboard and brings her back within a minute', ()=>{
  const y=plan.yacht!;expect(y).toBeTruthy();
  expect(TRAVEL.sail).toBeLessThan(60);
  const course=yachtCourse(y.berth);
  expect(course[0]).toMatchObject({x:y.berth.x,z:y.berth.z});expect(course[course.length-1]).toMatchObject({x:y.berth.x,z:y.berth.z});
  for(const p of plan.travellers.filter(p=>p.journey.endsWith('-yacht'))){
   // Aboard before she casts off, and nobody walks the dock while she is away.
   const aboard=Math.max(...p.segs.map(s=>s.t1))+p.offset,wait=((y.depart-aboard)%plan.lap+plan.lap)%plan.lap;
   expect(wait,p.id).toBeGreaterThan(0);expect(wait,p.id).toBeLessThan(plan.lap-TRAVEL.sail);
  }
  // Away for TRAVEL.sail seconds, then back at the berth.
  expect(yachtSailing(plan,y.depart+1)).toBeLessThan(TRAVEL.sail);
  expect(yachtPoseAt(course,TRAVEL.sail)).toMatchObject({x:y.berth.x,z:y.berth.z});
  const mid=yachtPoseAt(course,TRAVEL.sail/2);expect(Math.hypot(mid.x-y.berth.x,mid.z-y.berth.z)).toBeGreaterThan(3);
 });

 it('keeps the yacht in open water: her hull never crosses land, the pontoon or the marina', ()=>{
  const course=yachtCourse(plan.yacht!.berth),half=YACHT.length*YACHT_SCALE/2,beam=YACHT.beam*YACHT_SCALE/2,b=plan.yacht!.berth;
  const blocked=[...scene.land,{x:b.pontoon.x0,z:b.pontoon.z-b.pontoon.w/2,w:b.pontoon.x1-b.pontoon.x0,d:b.pontoon.w}];
  for(let t=.5;t<TRAVEL.sail;t+=.5){const at=yachtPoseAt(course,t),fx=Math.cos(at.yaw),fz=-Math.sin(at.yaw);
   for(const [u,v]of [[half,beam],[half,-beam],[-half,beam],[-half,-beam],[0,beam],[0,-beam]]){const x=at.x+fx*u-fz*v,z=at.z+fz*u+fx*v;
    expect(blocked.some(r=>x>r.x&&x<r.x+r.w&&z>r.z&&z<r.z+r.d),`t ${t}: ${x.toFixed(2)},${z.toFixed(2)}`).toBe(false);}}
 });

 it('needs nothing on other layouts', ()=>{
  expect(planTravel(buildScene(layoutMap(catalog,[],'none')))).toBeUndefined();
 });
});
