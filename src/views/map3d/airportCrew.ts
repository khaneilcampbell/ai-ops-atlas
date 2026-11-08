import {roundedRoad} from './highway';
import {AIRCRAFT_LAYOUT,AIRPORT_LAYOUT} from './airport';
import {TERMINAL_PIER} from './airportTerminal';

/**
 * Ground crew working outside at Atlas Airport: fuelers, bag loaders, a pushback driver and wing
 * walker at each served gate, baggage trains running between the terminal and the aircraft hold,
 * a cargo tug, crew walking between the terminal and the apron, and a marshaller at the hold point.
 * Airport-local coordinates (the renderer mirrors west-facing airports). Pure and deterministic:
 * the same clock always gives the same picture. Nobody ever goes past the airside keep-out line,
 * so the runway and the taxiway stay clear for every takeoff.
 */
type Pt=[number,number];
export type CrewRole='fueler'|'loader'|'pushback'|'wingwalker'|'walker'|'marshaller'|'cargo';
export interface CrewMember{id:string;role:CrewRole;
 /** Standing crew have a one-point path; walkers go out and back along it. */
 path:Pt[];pace:number;
 /** Seconds hidden inside the terminal before walking out, and seconds working at the far end. */
 restStart:number;restEnd:number;offset:number;
 /** Facing while standing (radians, 0 = toward -z, the map's convention). */
 face:number;
}
export interface CrewTrain{id:string;loop:Pt[];length:number;pace:number;
 /** Distance along the loop where the train parks at the hold, and how long it stays. */
 stopAt:number;dwell:number;offset:number;carts:number;
}
export type CrewPose={visible:boolean;x:number;z:number;yaw:number;
 /** 0 when still, otherwise a -1..1 swing for walking legs, waving arms or lifting bags. */
 swing:number};

/** Gates with a parked aircraft (gateOccupied in flightSchedule): the crew serve these two. */
export const SERVED_GATES=[AIRPORT_LAYOUT.gateZ[0],AIRPORT_LAYOUT.gateZ[3]] as const;
/** Crew doors in the apron face of the gate pier, where walkers leave and re-enter the terminal. */
export const CREW_DOOR_X=TERMINAL_PIER.x+TERMINAL_PIER.width/2;
/** Airside service lane just outside the pier and its jet-bridge rotundas. */
const LANE_X=CREW_DOOR_X+.45;
/** Doors sit on the pier's straight face, short of its wider rounded ends. */
const doorZ=(z:number)=>Math.max(TERMINAL_PIER.from+(TERMINAL_PIER.width+.4)/2+.05,Math.min(TERMINAL_PIER.to-(TERMINAL_PIER.width+.4)/2-.05,z));
/**
 * Airside keep-out: the runway with its edge lights and the full width of a jet's wings on the
 * taxiway, the queue and the turn onto the runway. Crew and service vehicles never enter it.
 */
export const CREW_KEEP_OUT={x:AIRPORT_LAYOUT.taxiX-AIRCRAFT_LAYOUT.halfSpan-.15} as const;
/** Cargo shed beside the terminal (drawn in LogisticsAirport at the cargo row). */
const CARGO_SHED_X=AIRPORT_LAYOUT.terminalX+.5;
/** People in the order they are dropped when the quality governor or Battery saver asks for fewer. */
export function planAirportCrew():CrewMember[]{
 const crew:CrewMember[]=[];
 const stand=(id:string,role:CrewRole,x:number,z:number,face:number):CrewMember=>({id,role,path:[[x,z]],pace:0,restStart:0,restEnd:0,offset:0,face});
 const gx=AIRPORT_LAYOUT.gateX;
 SERVED_GATES.forEach((gz,i)=>{
  // Core team first: these stay when the crowd is trimmed.
  crew.push(stand(`gate${i}:fueler`,'fueler',gx+1.08,gz-.5,-Math.PI/2));
  crew.push(stand(`gate${i}:loader`,'loader',gx+.62,gz+.86,-Math.PI/2));
  crew.push(stand(`gate${i}:pushback`,'pushback',gx-.24,gz-1.72,Math.PI));
 });
 crew.push(stand('marshaller','marshaller',CREW_KEEP_OUT.x-.28,AIRPORT_LAYOUT.departureZ-.35,-Math.PI/2));
 SERVED_GATES.forEach((gz,i)=>{
  crew.push(stand(`gate${i}:loader2`,'loader',gx+1.08,gz+1.34,Math.PI/2));
  // Walks the aircraft's right side, from the nose to the wing tip and back.
  crew.push({id:`gate${i}:wingwalker`,role:'wingwalker',path:[[gx+.45,gz-1.75],[gx+1.95,gz-1.45],[gx+1.95,gz+.25]],pace:.32,restStart:4,restEnd:6,offset:i*7,face:0});
  // Ramp agents walking out of the crew door to the hold and back.
  crew.push({id:`gate${i}:walker`,role:'walker',path:[[CREW_DOOR_X,doorZ(gz+1.75)],[LANE_X+.55,gz+1.75],[gx+.45,gz+1.2]],pace:.36,restStart:9,restEnd:7,offset:5+i*11,face:0});
 });
 // Crew walking the airside service lane between the two served gates, under the boarding bridges.
 for(const [i,offset] of [0,19].entries())crew.push({id:`lane:${i}`,role:'walker',path:[[CREW_DOOR_X,doorZ(SERVED_GATES[0]+2.15)],[LANE_X,SERVED_GATES[0]+2.15],[LANE_X,doorZ(SERVED_GATES[1]+.4)],[CREW_DOOR_X,doorZ(SERVED_GATES[1]+.4)]],pace:.4,restStart:6,restEnd:6,offset,face:0});
 // Cargo hands at the cargo shed loading dock.
 crew.push(stand('cargo:0','cargo',CARGO_SHED_X+1.35,AIRPORT_LAYOUT.cargoZ-.65,Math.PI/2),stand('cargo:1','cargo',CARGO_SHED_X+1.5,AIRPORT_LAYOUT.cargoZ+.7,Math.PI));
 return crew;
}

function polylineLength(path:Pt[]){let n=0;for(let i=1;i<path.length;i++)n+=Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]);return n;}
/** Point and heading a distance along a path. */
export function pointOn(path:Pt[],distance:number):{x:number;z:number;yaw:number}{
 let left=Math.max(0,distance);
 for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(left<=d||i===path.length-1){const u=d>1e-9?Math.min(1,left/d):0;return {x:a[0]+(b[0]-a[0])*u,z:a[1]+(b[1]-a[1])*u,yaw:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1]))};}
  left-=d;
 }
 return {x:path[0][0],z:path[0][1],yaw:0};
}

const WALK_STEP=7,WAVE=3.2,LIFT=1.9;
export function crewPeriod(c:CrewMember){return c.path.length<2?0:2*polylineLength(c.path)/c.pace+c.restStart+c.restEnd;}
/** Where one crew member is at a clock time. Walkers hide only while inside the terminal. */
export function crewAt(c:CrewMember,seconds:number):CrewPose{
 if(c.path.length<2){
  const swing=c.role==='marshaller'?Math.sin(seconds*WAVE):c.role==='loader'||c.role==='cargo'?Math.sin(seconds*LIFT+c.id.length):c.role==='fueler'?.15*Math.sin(seconds*.7):0;
  return {visible:true,x:c.path[0][0],z:c.path[0][1],yaw:c.face,swing};
 }
 const period=crewPeriod(c),length=polylineLength(c.path),walk=length/c.pace,t=((seconds+c.offset)%period+period)%period;
 const legs=Math.sin(seconds*WALK_STEP);
 if(t<c.restStart)return {visible:false,...pointOn(c.path,0),swing:0};
 if(t<c.restStart+walk)return {visible:true,...pointOn(c.path,(t-c.restStart)*c.pace),swing:legs};
 if(t<c.restStart+walk+c.restEnd){const end=pointOn(c.path,length);return {visible:true,...end,swing:c.role==='walker'?Math.sin(seconds*LIFT)*.6:0};}
 const back=pointOn(c.path,length-(t-c.restStart-walk-c.restEnd)*c.pace);
 return {visible:true,...back,yaw:back.yaw+Math.PI,swing:legs};
}

/** Baggage trains: a tug and carts drive a loop from the terminal to the hold, park, and return. */
export function planCrewTrains():CrewTrain[]{
 const gx=AIRPORT_LAYOUT.gateX,trains:CrewTrain[]=[];
 SERVED_GATES.forEach((gz,i)=>{
  const w=LANE_X+.25,loop=roundedRoad([[w+1.1,gz+2.45],[gx+.85,gz+2.45],[gx+.85,gz+.62],[gx+1.6,gz+.62],[gx+1.6,gz+2.95],[w,gz+2.95],[w,gz+2.45],[w+1.1,gz+2.45]],.32,true);
  const length=polylineLength(loop);
  // Park beside the belt loader, nose toward the wing, carts lined up under the hold.
  const corner=loop.reduce((best,p,k)=>Math.hypot(p[0]-(gx+.85),p[1]-(gz+.95))<Math.hypot(loop[best][0]-(gx+.85),loop[best][1]-(gz+.95))?k:best,0);
  trains.push({id:`train${i}`,loop,length,pace:.42,stopAt:polylineLength(loop.slice(0,corner+1)),dwell:11,offset:i*9,carts:3});
 });
 // Cargo tug with two container dollies on the cargo road beside the shed.
 const cz=AIRPORT_LAYOUT.cargoZ,east=CREW_KEEP_OUT.x-.8,loop=roundedRoad([[CARGO_SHED_X+3,cz-.45],[east,cz-.45],[east,cz+.45],[CARGO_SHED_X+1.6,cz+.45],[CARGO_SHED_X+1.6,cz-.45],[CARGO_SHED_X+3,cz-.45]],.3,true);
 trains.push({id:'cargo',loop,length:polylineLength(loop),pace:.5,stopAt:polylineLength(loop.slice(0,Math.floor(loop.length*.62))),dwell:9,offset:4,carts:2});
 return trains;
}
export const TRAIN_SPACING=.27;
export function trainPeriod(t:CrewTrain){return t.length/t.pace+t.dwell;}
/** Distance of the tug along its loop: drive, stop at the hold for the dwell, drive on. */
export function trainDistance(t:CrewTrain,seconds:number){
 const period=trainPeriod(t),u=((seconds+t.offset)%period+period)%period,arrive=t.stopAt/t.pace;
 if(u<arrive)return u*t.pace;
 if(u<arrive+t.dwell)return t.stopAt;
 return (u-t.dwell)*t.pace;
}
/** Tug first, then each cart trailing along the same loop. */
export function trainAt(t:CrewTrain,seconds:number){
 const d=trainDistance(t,seconds);
 return Array.from({length:t.carts+1},(_,k)=>pointOn(t.loop,((d-k*TRAIN_SPACING)%t.length+t.length)%t.length));
}

/** True when an airport-local point is clear of the runway, the taxiway, the queue and the turn onto the runway. */
export function outsideKeepOut(x:number){return x<CREW_KEEP_OUT.x;}

/**
 * How many ground crew to draw. The core team at each gate always shows; the rest scale with the
 * quality governor (100/75/50/25%) and halve on Battery saver, matching the city crowd (PR #162).
 */
export function crewLimit(total:number,{qualityLevel,saver,base=7}:{qualityLevel:number;saver:boolean;base?:number}){
 const extra=Math.max(0,total-base),share=[1,.75,.5,.25][Math.min(3,Math.max(0,qualityLevel))]*(saver?.5:1);
 return Math.min(total,base+Math.round(extra*share));
}
