import {AIRPORT_LANDING_RUNWAY,AIRPORT_LAYOUT,DEPARTURE_TIMES,departurePose,type FlightCircuit} from './airport';
import {ROLL_START_Z,ARRIVAL,CIRCUIT_PACE,departureToLocal,DEPARTURE_PACE,LOOP,LOOP_CYCLE,arrivalApproach,arrivalPose,exitTime,legsTotal} from './airportArrivals';
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
 const phase=flightPhase(seconds,slot),f=FLIGHT_SCHEDULE,{approach,leave,dwell}=loopTiming(circuit);
 if(phase<f.taxi){
  let left=phase/f.taxi*length;
  for(let i=1;i<route.length;i++){
   const a=route[i-1],b=route[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
   if(left<=d||i===route.length-1){const u=Math.min(1,left/d);return {x:a[0]+(b[0]-a[0])*u,y:0,z:a[1]+(b[1]-a[1])*u,yaw:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1])),pitch:0,roll:0,gear:1,visible:true};}left-=d;
  }
 }
 if(phase<leave){
  const elapsed=(phase-f.taxi)*DEPARTURE_PACE;
  // Takeoff and the turn onto the circuit run in real time; the circuit itself plays a little faster.
  const join=DEPARTURE_TIMES.join,flightTime=elapsed<join?elapsed:join+(elapsed-join)*CIRCUIT_PACE;
  const p=departurePose(Math.min(flightTime,approach.exitDep),true,circuit);
  const q=departureToLocal(p);
  return {...q,y:p.y-.28,yaw:phase<f.taxi+3?Math.PI:q.yaw,visible:true};
 }
 return arrivalPose(phase-leave,approach,dwell);
}
