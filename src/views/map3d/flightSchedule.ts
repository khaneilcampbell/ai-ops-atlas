import {AIRPORT_LANDING_RUNWAY,AIRPORT_LAYOUT,DEPARTURE_TIMES,departurePose,type FlightCircuit} from './airport';
import {ROLL_START_Z,ARRIVAL,CIRCUIT_PACE,departureToLocal,DEPARTURE_PACE,LOOP,LOOP_CYCLE,arrivalApproach,arrivalGate,arrivalPose,exitTime,legsTotal,leaveStandDuration,leaveStandPose,STAND_NORTH,STAND_SOUTH,standPose} from './airportArrivals';
import {roundedRoad} from './highway';
/**
 * One departure every 45 simulation seconds (KC, 2026-11-07), from a single jet holding short.
 * Five jets fly a closed loop: take off from runway 1, circle the city, land on the landing runway, park at the
 * arrivals stand, push back and taxi back to the hold. Every jet is slot 0 shifted by `interval`.
 */
export const FLIGHT_SCHEDULE={interval:LOOP.interval,count:LOOP.count,cycle:LOOP_CYCLE,taxi:LOOP.taxi,start:20} as const;
/** Jets taxi up from the south stand, hold short facing north, then turn east and south onto runway 1's north end. */
export const TAKEOFF_QUEUE={x:AIRPORT_LAYOUT.taxiX,frontZ:0} as const;
/** They taxi up the north end lane and line up at the very top of runway 1, for the whole runway's roll. */
const route=roundedRoad([[TAKEOFF_QUEUE.x,TAKEOFF_QUEUE.frontZ],[11.5,AIRPORT_LANDING_RUNWAY.laneZ],[15,AIRPORT_LANDING_RUNWAY.laneZ],[15,ROLL_START_Z]],.65);
const length=route.slice(1).reduce((n,b,i)=>n+Math.hypot(b[0]-route[i][0],b[1]-route[i][1]),0);
/** Seconds since this slot was last released from the hold. */
export function flightPhase(seconds:number,slot:number){return ((seconds+FLIGHT_SCHEDULE.start-slot*FLIGHT_SCHEDULE.interval)%FLIGHT_SCHEDULE.cycle+FLIGHT_SCHEDULE.cycle)%FLIGHT_SCHEDULE.cycle;}
export function gateOccupied(seconds:number,gate:number){return gate===0||gate===3 ? Number.isFinite(seconds) : false;}
/** Turnaround timing for a circuit: when the jet leaves the circuit and how long it then holds short. The stand
 * time stays fixed unless no circuit exit fits the hold window, when it gives up the difference (within limits). */
export function loopTiming(circuit?:FlightCircuit){
 const approach=arrivalApproach(circuit),leave=exitTime(approach,FLIGHT_SCHEDULE.taxi),hold=FLIGHT_SCHEDULE.cycle-leave-legsTotal(approach);
 const fix=hold<LOOP.holdMin?Math.max(hold-LOOP.holdMin,8-ARRIVAL.dwell):hold>LOOP.holdMax?Math.min(hold-LOOP.holdMax,LOOP.standExtra):0;
 return {approach,leave,dwell:ARRIVAL.dwell+fix,hold:hold-fix};
}
/** Hold, taxi, takeoff, circuit, approach, landing and turnaround all use the paused/reduced-motion-aware clock. */
export function fleetPose(seconds:number,slot:number,circuit?:FlightCircuit){
 if(slot===SHARED_SLOT)return sharedAirlinerPose(seconds,circuit);
 const phase=flightPhase(seconds,slot);
 if(phase<FLIGHT_SCHEDULE.taxi)return holdTaxi(phase);
 const {leave,approach,dwell}=loopTiming(circuit);
 if(phase<leave)return airborne(phase,circuit);
 return arrivalPose(phase-leave,approach,dwell,arrivalGate(slot));
}
function holdTaxi(phase:number){
 let left=phase/FLIGHT_SCHEDULE.taxi*length;
 for(let i=1;i<route.length;i++){
  const a=route[i-1],b=route[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(left<=d||i===route.length-1){const u=Math.min(1,left/d);return {x:a[0]+(b[0]-a[0])*u,y:0,z:a[1]+(b[1]-a[1])*u,yaw:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1])),pitch:0,roll:0,gear:1,visible:true};}left-=d;
 }
 return {x:route[route.length-1][0],y:0,z:route[route.length-1][1],yaw:Math.PI,pitch:0,roll:0,gear:1,visible:true};
}
function airborne(phase:number,circuit?:FlightCircuit){
 const f=FLIGHT_SCHEDULE,{approach}=loopTiming(circuit),elapsed=(phase-f.taxi)*DEPARTURE_PACE;
 // Takeoff and the turn onto the circuit run in real time; the circuit itself plays a little faster.
 const join=DEPARTURE_TIMES.join,flightTime=elapsed<join?elapsed:join+(elapsed-join)*CIRCUIT_PACE;
 const p=departurePose(Math.min(flightTime,approach.exitDep),true,circuit);
 const q=departureToLocal(p);
 return {...q,y:p.y-.28,yaw:phase<f.taxi+3?Math.PI:q.yaw,visible:true};
}

/**
 * The last slot is shared (Khaneil, 2026-11-13): the executive jet and one airliner take turns, a loop each.
 * Each flies one loop, lands and rests at its remote stand through the other's loop, then flies again. The
 * executive jet rests at the north stand and taxis straight from it to runway 1; the airliner rests at the south
 * stand, then pushes back and taxis up to the hold in time for its next release.
 */
export const SHARED_SLOT=FLIGHT_SCHEDULE.count-1;
const sharedLoop=(seconds:number)=>((Math.floor((seconds+FLIGHT_SCHEDULE.start-SHARED_SLOT*FLIGHT_SCHEDULE.interval)/FLIGHT_SCHEDULE.cycle)%2)+2)%2;
/** The airliner reaches the hold this long after the executive jet has passed it on the way to its stand. */
const SHARED_FOLLOW=26;
/** ...but always a little before its release. */
const SHARED_LATEST=6;
function sharedAirlinerPose(seconds:number,circuit?:FlightCircuit){
 const f=FLIGHT_SCHEDULE,phase=flightPhase(seconds,SHARED_SLOT);
 if(sharedLoop(seconds)===0){
  if(phase<f.taxi)return holdTaxi(phase);
  const {leave,approach}=loopTiming(circuit);
  if(phase<leave)return airborne(phase,circuit);
  return arrivalPose(phase-leave,approach,Infinity,STAND_SOUTH);
 }
 const leaveAt=Math.min(f.cycle-loopTiming(circuit).hold+SHARED_FOLLOW,f.cycle-SHARED_LATEST)-leaveStandDuration(STAND_SOUTH);
 return phase<leaveAt?standPose(STAND_SOUTH):leaveStandPose(STAND_SOUTH,phase-leaveAt);
}
/** Executive jet: out of the north stand with a U-turn on the pad, along the north end lane, onto runway 1. */
const jetRoute=roundedRoad([[7,-4.6],[6.2,-4.6],[5.7,-5.5],[6.4,-6.2],[8,-6.2],[9.2,-4.6],[15,AIRPORT_LANDING_RUNWAY.laneZ],[15,ROLL_START_Z]],.45);
const jetLength=jetRoute.slice(1).reduce((n,b,i)=>n+Math.hypot(b[0]-jetRoute[i][0],b[1]-jetRoute[i][1]),0);
const JET_TAXI=jetLength/1.4;
function jetTaxi(t:number){
 let left=Math.max(0,Math.min(1,t/JET_TAXI))*jetLength;
 for(let i=1;i<jetRoute.length;i++){
  const a=jetRoute[i-1],b=jetRoute[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(left<=d||i===jetRoute.length-1){const u=Math.min(1,left/d);return {x:a[0]+(b[0]-a[0])*u,y:0,z:a[1]+(b[1]-a[1])*u,yaw:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1])),pitch:0,roll:0,gear:1,visible:true};}left-=d;
 }
 return holdTaxi(f0());
}
const f0=()=>FLIGHT_SCHEDULE.taxi;
export function executiveJetPose(seconds:number,circuit?:FlightCircuit){
 const f=FLIGHT_SCHEDULE,phase=flightPhase(seconds,SHARED_SLOT),flying=sharedLoop(seconds)===1;
 // The taxi out ends exactly when a jet from the hold would be lined up, so the takeoff is the shared slot's.
 if(!flying&&phase>=f.cycle+f.taxi-JET_TAXI)return jetTaxi(phase-(f.cycle+f.taxi-JET_TAXI));
 if(!flying)return standPose(STAND_NORTH);
 if(phase<f.taxi)return jetTaxi(phase+JET_TAXI-f.taxi);
 const {leave,approach,dwell,hold}=loopTiming(circuit);
 if(phase<leave)return airborne(phase,circuit);
 // Passengers off at gate 1 like any arrival, then on past the hold (just clear) to rest at the north stand.
 const atHold=f.cycle-hold;
 if(phase<atHold)return arrivalPose(phase-leave,approach,dwell,1);
 return jetIn(phase-atHold);
}
const jetInRoute=roundedRoad([[TAKEOFF_QUEUE.x,TAKEOFF_QUEUE.frontZ],[11.5,AIRPORT_LANDING_RUNWAY.laneZ],[7,AIRPORT_LANDING_RUNWAY.laneZ]],.6);
const jetInLength=jetInRoute.slice(1).reduce((n,b,i)=>n+Math.hypot(b[0]-jetInRoute[i][0],b[1]-jetInRoute[i][1]),0);
function jetIn(t:number){
 let left=Math.min(jetInLength,t*1.2);
 for(let i=1;i<jetInRoute.length;i++){
  const a=jetInRoute[i-1],b=jetInRoute[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(left<=d||i===jetInRoute.length-1){const u=Math.min(1,left/d);return {x:a[0]+(b[0]-a[0])*u,y:0,z:a[1]+(b[1]-a[1])*u,yaw:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1])),pitch:0,roll:0,gear:1,visible:true};}left-=d;
 }
 return standPose(STAND_NORTH);
}
