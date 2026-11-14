import {it,expect} from 'vitest';
import {executiveJetPose,fleetPose,flightPhase,loopTiming,SHARED_SLOT,TAKEOFF_QUEUE,FLIGHT_SCHEDULE as f} from './flightSchedule';
import {AIRPORT_LANDING_RUNWAY as R,AIRPORT_LAYOUT as l} from './airport';
import {ARRIVAL,ARRIVAL_GATES,ARRIVAL_STAND,LOOP,ROLL_START_Z} from './airportArrivals';
// The circuit the map uses for the sample catalog (airport-local, mirror already applied).
const CITY={x:-27.35,z:.86,rx:46.35,rz:57.9,altitude:18.16};
const CIRCUITS=[undefined,CITY];
const fleet=(t:number,c?:typeof CITY)=>Array.from({length:f.count},(_,i)=>fleetPose(t,i,c));

it('releases one departure every 45 seconds, including cycle wrap',()=>{
 expect(f.interval).toBe(45);
 expect(f.count*f.interval).toBe(f.cycle);
 // Jets alternate between two gates, so every other slot repeats the same path two intervals later.
 for(let slot=2;slot<SHARED_SLOT;slot++)for(const t of [0,20,50,90,150,200])expect(fleetPose(t+slot*f.interval,slot)).toEqual(fleetPose(t+(slot-2)*f.interval,slot-2));
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

it('uses both empty gates in turn, reaching the hold at the same moment from either (Khaneil, 2026-11-13)',()=>{
 for(const c of CIRCUITS){
  const gates=new Set<number>();
  for(let slot=0;slot<2;slot++)for(let t=0;t<f.cycle;t+=.25){const p=fleetPose(t,slot,c);if(p.y===0&&p.x===ARRIVAL_GATES[slot].x&&p.z===ARRIVAL_GATES[slot].z)gates.add(slot);}
  expect([...gates].sort()).toEqual([0,1]);
  // Same release time from either gate: slot 1's jet holds exactly one interval after slot 0's.
  expect(fleetPose(f.interval-f.start,1,c)).toEqual(fleetPose(-f.start,0,c));
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

it('flies the executive jet every other loop in the shared slot, resting at the north stand (Khaneil, 2026-11-13)',()=>{
 for(const c of CIRCUITS){
  // On the ground, every jet (executive jet included) keeps a wingspan apart from every other; in the air, well clear.
  let ground=Infinity,air=Infinity;
  for(let t=0;t<f.cycle*2;t+=.1){
   const ps=[...Array.from({length:f.count},(_,s)=>fleetPose(t,s,c)),executiveJetPose(t,c)];
   for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const a=ps[i],b=ps[j],d=Math.hypot(a.x-b.x,a.z-b.z,a.y-b.y);if(a.y<.05&&b.y<.05)ground=Math.min(ground,d);else air=Math.min(air,d);}
  }
  expect(ground).toBeGreaterThan(2.8);expect(air).toBeGreaterThan(2.8);
  // It takes off in one loop of the shared slot and sits at the north stand right through the next.
  const flew=[0,1].map(k=>{let up=false;for(let t=0;t<f.cycle;t+=.5)if(executiveJetPose(SHARED_SLOT*f.interval-f.start+k*f.cycle+t,c).y>1)up=true;return up;});
  expect(flew.filter(Boolean)).toHaveLength(1);
  const rest=flew[0]?1:0,p=executiveJetPose(SHARED_SLOT*f.interval-f.start+rest*f.cycle+100,c);
  expect([p.x,p.z]).toEqual([7,-4.6]);
 }
});
