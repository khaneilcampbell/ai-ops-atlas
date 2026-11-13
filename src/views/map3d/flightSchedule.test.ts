import {it,expect} from 'vitest';
import {fleetPose,flightPhase,loopTiming,TAKEOFF_QUEUE,FLIGHT_SCHEDULE as f} from './flightSchedule';
import {AIRPORT_LANDING_RUNWAY as R,AIRPORT_LAYOUT as l} from './airport';
import {ARRIVAL,ARRIVAL_STAND,LOOP,ROLL_START_Z} from './airportArrivals';
// The circuit the map uses for the sample catalog (airport-local, mirror already applied).
const CITY={x:-27.35,z:.86,rx:46.35,rz:57.9,altitude:18.16};
const CIRCUITS=[undefined,CITY];
const fleet=(t:number,c?:typeof CITY)=>Array.from({length:f.count},(_,i)=>fleetPose(t,i,c));

it('releases one departure every 45 seconds, including cycle wrap',()=>{
 expect(f.interval).toBe(45);
 expect(f.count*f.interval).toBe(f.cycle);
 for(let slot=1;slot<f.count;slot++)for(const t of [0,20,50,90,150,200])expect(fleetPose(t+slot*f.interval,slot)).toEqual(fleetPose(t+(slot-1)*f.interval,slot-1));
 expect(fleetPose(f.cycle,0)).toEqual(fleetPose(0,0));
});

it('rolls on runway 1 for only one jet at a time, 45 seconds apart',()=>{
 for(const c of CIRCUITS){
  const starts:number[]=[];
  for(let t=0;t<f.cycle*2;t+=.25){const rolling=fleet(t,c).filter(p=>p.x===l.runwayX&&p.y<.05&&p.z<16.4);if(rolling.length)expect(rolling).toHaveLength(1);
   for(let i=0;i<f.count;i++)if(Math.abs(flightPhase(t,i)-f.taxi)<.125)starts.push(t);}
  for(let i=1;i<starts.length;i++)expect(starts[i]-starts[i-1]).toBeCloseTo(f.interval,0);
 }
});

it('keeps one jet holding short, off the runway, and the turnaround inside the cycle',()=>{
 for(const c of CIRCUITS){
  const {hold,dwell}=loopTiming(c);
  expect(hold).toBeGreaterThanOrEqual(LOOP.holdMin-1e-9);expect(hold).toBeLessThanOrEqual(LOOP.holdMax+1e-9);
  expect(dwell).toBeGreaterThanOrEqual(ARRIVAL.dwell);expect(dwell).toBeLessThanOrEqual(ARRIVAL.dwell+LOOP.standExtra);expect(LOOP.holdMax).toBeLessThan(f.interval-5);
  for(let t=0;t<f.cycle;t+=.25){
   const holding=fleet(t,c).filter(p=>p.x===TAKEOFF_QUEUE.x&&Math.abs(p.z-TAKEOFF_QUEUE.frontZ)<1e-6);
   expect(holding.length).toBeLessThanOrEqual(1);
   for(const p of holding)expect(p.x+1.35).toBeLessThan(l.runwayX-l.runwayWidth/2);
  }
 }
});

it('keeps simultaneous grounded aircraft separated',()=>{
 for(const c of CIRCUITS)for(let t=0;t<f.cycle;t+=.25){
  const poses=fleet(t,c).filter(p=>p.visible&&p.y<3);
  for(let i=0;i<poses.length;i++)for(const b of poses.slice(i+1))expect(Math.hypot(poses[i].x-b.x,(poses[i].y-b.y)*2,poses[i].z-b.z),`t=${t}`).toBeGreaterThan(2.8);
 }
});

it('keeps gate, taxi, runway, airborne, landing and turnaround transitions continuous',()=>{
 for(const c of CIRCUITS)for(let t=.05;t<f.cycle+1;t+=.05){
  const a=fleetPose(t-.05,0,c),b=fleetPose(t,0,c);
  expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z),`t=${t}`).toBeLessThan(.6);
  let d=b.yaw-a.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));expect(Math.abs(d),`yaw t=${t}`).toBeLessThan(.25);
  expect(Math.abs(b.pitch-a.pitch),`pitch t=${t}`).toBeLessThan(.06);
 }
});

it('limits commercial aircraft in the air and avoids adjacent flight positions',()=>{
 for(const c of CIRCUITS)for(let t=0;t<f.cycle;t+=.25){
  const air=fleet(t,c).filter(p=>p.visible&&p.y>.5);
  expect(air.length).toBeLessThanOrEqual(4);
  for(let i=0;i<air.length;i++)for(const b of air.slice(i+1))expect(Math.hypot(air[i].x-b.x,air[i].y-b.y,air[i].z-b.z)).toBeGreaterThan(5);
 }
});

it('lands every jet on the landing runway and brings it back to the arrivals stand and the hold',()=>{
 for(const c of CIRCUITS){
  const {leave,approach}=loopTiming(c);
  let touchdown:number|undefined,stand=false;
  for(let p=leave;p<f.cycle;p+=.05){
   const pose=fleetPose(p-f.start,0,c);
   if(touchdown===undefined&&pose.y<1e-6){touchdown=p;expect(pose.x).toBeCloseTo(R.x,5);expect(pose.z).toBeLessThan(R.z+R.length/2);expect(pose.z).toBeGreaterThan(R.touchdownZ-1.5);}
   if(Math.hypot(pose.x-ARRIVAL_STAND.x,pose.z-ARRIVAL_STAND.z)<1e-6)stand=true;
  }
  expect(touchdown).toBeGreaterThan(leave+approach.duration);
  expect(stand).toBe(true);
  // Gear down before final, on the ground the whole time it is grounded.
  for(let t=0;t<f.cycle;t+=.25){const p=fleetPose(t,0,c);if(p.y===0)expect(p.gear).toBe(1);}
 }
});

it('never rolls over runway 1 on the ground except to take off',()=>{
 // The north lane leads into the lineup at the top of runway 1; arrivals cross on the south lane.
 const onLane=(z:number)=>z<=ROLL_START_Z+1e-6||Math.abs(z-R.southLaneZ)<.01;
 for(const c of CIRCUITS)for(let t=0;t<f.cycle;t+=.1){
  const p=fleetPose(t,0,c);if(p.y>0)continue;
  // The lineup turn onto the north end is part of taking off; runway 1 runs on south to its far end.
  const onRunway=Math.abs(p.x-l.runwayX)<l.runwayWidth/2+1.35&&p.z>l.runwayZ-l.runwayLength/2+.5&&p.z<l.runwayZ+l.runwayLength/2+1.35;
  // Taxiing jets cross it only on the end lanes.
  if(onRunway&&!onLane(p.z))expect(p.x,`t=${t}`).toBe(l.runwayX);
 }
});

it('works both runways top to bottom: landings come in from the north, takeoffs roll south (Khaneil, 2026-11-13)',()=>{
 for(const c of CIRCUITS){
  const {leave,approach}=loopTiming(c);
  // On final the jet lines up on the landing runway north of its threshold and flies south.
  const t0=leave+approach.duration-f.start+.5,a=fleetPose(t0,0,c),b=fleetPose(t0+.5,0,c);
  expect(a.x).toBeCloseTo(R.x,5);expect(a.z).toBeLessThan(R.touchdownZ);expect(b.z).toBeGreaterThan(a.z);expect(b.y).toBeLessThan(a.y);
  // The takeoff roll starts at runway 1's north end and runs south.
  const r0=fleetPose(f.taxi+1-f.start,0,c),r1=fleetPose(f.taxi+6-f.start,0,c);
  expect(r0.x).toBe(l.runwayX);expect(r0.z).toBeLessThan(0);expect(r1.z).toBeGreaterThan(r0.z);
 }
});
