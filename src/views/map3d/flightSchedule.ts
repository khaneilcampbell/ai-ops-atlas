import {AIRPORT_LAYOUT,departurePose,type FlightCircuit} from './airport';
import {roundedRoad} from './highway';
/** Three aircraft queue on the taxiway; one is released every 15 simulation seconds. */
export const FLIGHT_SCHEDULE={interval:15,count:8,park:45,taxi:6,cycle:120,start:45} as const;
export const TAKEOFF_QUEUE={x:AIRPORT_LAYOUT.taxiX,frontZ:14.5,spacing:3.8} as const;
const route=roundedRoad([[TAKEOFF_QUEUE.x,TAKEOFF_QUEUE.frontZ],[11.5,17.5],[15,17.5],[15,16.5]],.65);
const length=route.slice(1).reduce((n,b,i)=>n+Math.hypot(b[0]-route[i][0],b[1]-route[i][1]),0);
export function flightPhase(seconds:number,slot:number){return ((seconds+FLIGHT_SCHEDULE.start-slot*FLIGHT_SCHEDULE.interval)%FLIGHT_SCHEDULE.cycle+FLIGHT_SCHEDULE.cycle)%FLIGHT_SCHEDULE.cycle;}
export function gateOccupied(seconds:number,gate:number){return gate===0||gate===3 ? Number.isFinite(seconds) : false;}
/** Queue, taxi and flight all use the same paused/reduced-motion-aware simulation clock. */
export function fleetPose(seconds:number,slot:number,circuit?:FlightCircuit){
 const phase=flightPhase(seconds,slot),f=FLIGHT_SCHEDULE;
 if(phase<f.park){
  const step=Math.floor(phase/f.interval),within=phase%f.interval;
  // Advance one queue position smoothly after the aircraft ahead has been released.
  const advance=Math.min(1,within/4);
  const z=TAKEOFF_QUEUE.frontZ-(3-step-advance)*TAKEOFF_QUEUE.spacing;
  return {x:TAKEOFF_QUEUE.x,y:0,z,yaw:Math.PI,pitch:0,visible:true};
 }
 if(phase<f.park+f.taxi){
  let left=(phase-f.park)/f.taxi*length;
  for(let i=1;i<route.length;i++){
   const a=route[i-1],b=route[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
   if(left<=d||i===route.length-1){const u=Math.min(1,left/d);return {x:a[0]+(b[0]-a[0])*u,y:0,z:a[1]+(b[1]-a[1])*u,yaw:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1])),pitch:0,visible:true};}left-=d;
  }
 }
 const elapsed=(phase-f.park-f.taxi)*1.15;
 const flightTime=elapsed<30?elapsed:elapsed<75?30+(elapsed-30)*4/3:150+elapsed-75;
 const p=departurePose(Math.min(flightTime,179),true,circuit);
 return {...p,x:15+p.x,z:6.1+p.z,y:p.y-.28,yaw:phase<54?0:p.yaw,visible:phase<114};
}
