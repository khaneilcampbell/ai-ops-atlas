import {it,expect} from 'vitest';
import {departurePose,takeoffDistance,TAKEOFF,DEPARTURE_TIMES,AIRPORT_LAYOUT} from './airport';
import {fleetPose,FLIGHT_SCHEDULE} from './flightSchedule';
import {LIVERIES,liveryFor} from './airlineLiveries';

// The circuit the map uses for the sample catalog (airport-local, mirror already applied).
const CITY={x:-27.35,z:.86,rx:46.35,rz:57.9,altitude:18.16};
const sample=(from:number,to:number,step=.05)=>Array.from({length:Math.round((to-from)/step)},(_,i)=>from+i*step);

it('accelerates down the runway and lifts off before its far end',()=>{
 let speed=0;
 for(const t of sample(TAKEOFF.hold+.1,TAKEOFF.liftoff)){const v=(takeoffDistance(t+.05)-takeoffDistance(t))/.05;expect(v).toBeGreaterThan(speed);speed=v;}
 const runwayEnd=AIRPORT_LAYOUT.runwayZ-AIRPORT_LAYOUT.runwayLength/2-6.1;
 expect(10.4-takeoffDistance(TAKEOFF.liftoff)).toBeGreaterThan(runwayEnd+3);
 for(const t of sample(0,TAKEOFF.liftoff))expect(departurePose(t,true,CITY).x).toBe(0);
});

it('raises the nose at rotation and never points it down during the climb',()=>{
 expect(departurePose(TAKEOFF.liftoff-TAKEOFF.rotate-.2,true,CITY).pitch).toBe(0);
 expect(departurePose(TAKEOFF.liftoff,true,CITY).pitch).toBeCloseTo(TAKEOFF.rotationPitch,2);
 for(const t of sample(0,DEPARTURE_TIMES.join)){const p=departurePose(t,true,CITY);expect(p.pitch).toBeGreaterThanOrEqual(0);expect(p.pitch).toBeLessThanOrEqual(TAKEOFF.maxPitch);}
 for(const t of sample(0,DEPARTURE_TIMES.hide-.1)){const a=departurePose(t,true,CITY),b=departurePose(t+.05,true,CITY);expect(Math.abs(a.pitch-b.pitch)).toBeLessThan(.05);}
});

it('climbs gradually instead of shooting straight up',()=>{
 for(const t of sample(0,DEPARTURE_TIMES.join)){
  const a=departurePose(t,true,CITY),b=departurePose(t+.05,true,CITY);
  expect(Math.atan2(b.y-a.y,Math.hypot(b.x-a.x,b.z-a.z))).toBeLessThan(.4);
 }
 expect(departurePose(TAKEOFF.climbTop,true,CITY).y).toBeCloseTo(CITY.altitude,1);
});

it('folds the gear away after liftoff and keeps it down on the ground',()=>{
 expect(departurePose(TAKEOFF.liftoff,true,CITY).gear).toBe(1);
 expect(departurePose(TAKEOFF.liftoff+TAKEOFF.gearUp+TAKEOFF.gearTime+.1,true,CITY).gear).toBe(0);
 for(let t=0;t<FLIGHT_SCHEDULE.cycle;t+=.25){const p=fleetPose(t,0,CITY);if(p.y===0)expect(p.gear).toBe(1);}
});

it('turns onto the city circuit smoothly, banking into the turn, with no hairpin',()=>{
 let heading=departurePose(0,true,CITY).yaw;
 for(const t of sample(.05,DEPARTURE_TIMES.hide-.1)){
  const p=departurePose(t,true,CITY);let d=p.yaw-heading;d=Math.atan2(Math.sin(d),Math.cos(d));
  expect(Math.abs(d)/.05).toBeLessThan(.6);heading=p.yaw;
  expect(Math.abs(p.roll)).toBeLessThanOrEqual(TAKEOFF.maxBank);
  if(t<TAKEOFF.liftoff)expect(Math.abs(p.roll)).toBe(0);
 }
});

it('paints five distinct airlines and never repeats a livery in the takeoff queue',()=>{
 expect(LIVERIES.map(l=>l.id)).toEqual(['delta','emirates','american','southwest','qatar']);
 for(const l of LIVERIES)for(const [k,v] of Object.entries(l))if(k!=='id'&&k!=='name')expect(v).toMatch(/^#[0-9a-f]{6}$/);
 expect(new Set(LIVERIES.map(l=>l.tail+l.fuselage+l.belly)).size).toBe(LIVERIES.length);
 for(let i=0;i<FLIGHT_SCHEDULE.count;i++)expect(new Set([0,1,2].map(k=>liveryFor(i+k).id)).size).toBe(3);
 expect(liveryFor(-1).id).toBe('qatar');
});
