import {it,expect} from 'vitest';
import {fleetPose,flightPhase,TAKEOFF_QUEUE,FLIGHT_SCHEDULE as f} from './flightSchedule';
it('spaces every departure by 15 seconds, including cycle wrap',()=>{
 expect(f.count*f.interval).toBe(f.cycle);
 for(let slot=1;slot<f.count;slot++)for(const t of [0,20,50,90,150])expect(fleetPose(t+slot*f.interval,slot)).toEqual(fleetPose(t+(slot-1)*f.interval,slot-1));
 expect(fleetPose(f.cycle,0)).toEqual(fleetPose(0,0));
});
it('keeps simultaneous grounded aircraft separated',()=>{
 for(let t=0;t<f.cycle;t+=.5){
  const poses=Array.from({length:f.count},(_,i)=>fleetPose(t,i)).filter(p=>p.visible&&p.y<.5);
  for(let i=0;i<poses.length;i++)for(const b of poses.slice(i+1))expect(Math.hypot(poses[i].x-b.x,poses[i].z-b.z)).toBeGreaterThan(2.8);
 }
});

it('keeps gate, taxi, runway, and airborne transitions continuous',()=>{
 for(let t=.05;t<240;t+=.05){const a=fleetPose(t-.05,0),b=fleetPose(t,0);if(a.visible&&b.visible)expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeLessThan(.6);}
});

it('limits commercial aircraft in the air and avoids adjacent flight positions',()=>{
 for(let t=0;t<f.cycle;t+=.25){
  const air=Array.from({length:f.count},(_,i)=>fleetPose(t,i)).filter(p=>p.visible&&p.y>.5);
  expect(air.length).toBeLessThanOrEqual(4);
  for(let i=0;i<air.length;i++)for(const b of air.slice(i+1))expect(Math.hypot(air[i].x-b.x,air[i].y-b.y,air[i].z-b.z)).toBeGreaterThan(5);
 }
});

 it('maintains three waiting jets off the runway with 15-second releases',()=>{
 expect(f.interval).toBe(15);
 for(let t=0;t<f.cycle;t+=.25){
  const waiting=Array.from({length:f.count},(_,i)=>i).filter(i=>flightPhase(t,i)<f.park);
  expect(waiting).toHaveLength(3);
  for(const i of waiting){const p=fleetPose(t,i);expect(p.x).toBe(TAKEOFF_QUEUE.x);expect(p.z).toBeLessThanOrEqual(TAKEOFF_QUEUE.frontZ);expect(p.x+1.35).toBeLessThan(13.9);}
 }
 for(let i=0;i<f.count;i++){const p=fleetPose(f.taxi+i*f.interval,i);expect(p.x).toBe(15);expect(p.z).toBeCloseTo(16.5);}
 });
