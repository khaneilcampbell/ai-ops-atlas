import {AIRPORT_LANDING_RUNWAY as R,AIRPORT_LAYOUT,DEFAULT_CIRCUIT,DEPARTURE_TIMES,circuitState,departurePose,type FlightCircuit} from './airport';
import {roundedRoad} from './highway';

/**
 * Arrivals (KC, 2026-11-07): every departure comes back. It leaves the city circuit on a smooth descending turn,
 * flies a straight final onto the landing runway, flares, touches down, rolls out, takes the taxi lane north of
 * runway 1 to the arrivals stand, pushes back and taxis down the parallel taxiway to the hold.
 *
 * Coordinates: ground poses are airport-local. The circuit lives in departure coordinates, where the takeoff rolls
 * toward -z from z 10.4. Since both runways work top to bottom (Khaneil, 2026-11-13: landings come in from the north,
 * clear of the Team Events Arena, so takeoffs roll south too), departure coordinates are airport-local mirrored front
 * to back about DEPARTURE_ORIGIN: the roll starts at runway 1's north end and heads south. Times are real seconds
 * unless named `dep`.
 */
/** Where the takeoff roll starts: runway 1's north end, just past the end lane (departure z 10.4). */
export const ROLL_START_Z=-3.4;
export const DEPARTURE_ORIGIN={x:15,z:ROLL_START_Z+10.4} as const;
/** Departure coordinates to airport-local, and back (the mirror is its own inverse). */
export const fromDeparture=(p:{x:number;z:number})=>({x:DEPARTURE_ORIGIN.x+p.x,z:DEPARTURE_ORIGIN.z-p.z});
export const toDeparture=(p:{x:number;z:number})=>({x:p.x-DEPARTURE_ORIGIN.x,z:DEPARTURE_ORIGIN.z-p.z});
/** A departure pose seen in airport-local coordinates: the mirror turns headings round and swaps the bank side. */
export function departureToLocal<P extends {x:number;z:number;yaw:number;roll:number}>(p:P):P{return {...p,...fromDeparture(p),yaw:Math.PI-p.yaw,roll:-p.roll};}
/** Departure seconds run 1.15x real time; the circuit itself plays another 1.55x faster, so one lap takes about 34 real
 * seconds and the jet 45 seconds ahead is a third of a lap away when the next one joins (see fleetPose). */
export const DEPARTURE_PACE=1.15,CIRCUIT_PACE=1.55;
export const ARRIVAL={
 /** Final approach: straight in along the runway from this far past the touchdown point, starting this high. */
 finalLength:24,finalHeight:2.6,speed:2.6,flare:.15,
 /** Ground speeds and the rollout deceleration (taxi speed reached by the runway's midpoint). */
 taxiSpeed:1.2,rolloutDecel:.156,stopTime:2,pushSpeed:.7,
 /** Default stand time, the tug disconnect pause and the earliest/latest circuit exit after the join (departure seconds). */
 dwell:18,pause:2,exitFrom:30,exitTo:110,
} as const;
/** The loop every jet flies (see flightSchedule): released every `interval`, `count` jets, taxi to runway 1 first.
 * A jet must reach the hold between holdMin and holdMax seconds before its release: under one interval, so
 * only one jet ever holds short. The stand time is fixed, because it alone decides whether the next arrival
 * meets the previous jet pushing back; the circuit exit is chosen to land the hold time inside its window. */
/** standExtra: when the best circuit exit comes back early, the jet waits up to this much longer at the stand rather
 * than queueing at the hold (the stand is clear long before the next arrival needs it). */
export const LOOP={interval:45,count:5,taxi:6,holdMin:10,holdMax:38,standExtra:12} as const;
export const LOOP_CYCLE=LOOP.interval*LOOP.count;
/** Landed jets taxi to the terminal and park nose-in at the free gate (gate 2, between the two parked jets), then
 * push back from it and taxi up to the takeoff hold (Khaneil, 2026-11-13). */
export const ARRIVAL_STAND={x:AIRPORT_LAYOUT.gateX,z:AIRPORT_LAYOUT.gateZ[2]} as const;
/** The hold is on the taxiway by runway 1's north end (TAKEOFF_QUEUE), facing north. */
const HOLD={x:AIRPORT_LAYOUT.taxiX,z:0} as const;
/** Pushback ends on the taxiway just south of the gate, nose north, ready to taxi up to the hold. */
const PUSH_END={x:AIRPORT_LAYOUT.taxiX,z:ARRIVAL_STAND.z+1.2} as const;
type Pt=[number,number];
type XZ={x:number;z:number};
export interface GroundPose {x:number;y:number;z:number;yaw:number;pitch:number;roll:number;gear:number;visible:boolean}
const clamp01=(u:number)=>Math.max(0,Math.min(1,u));
const smooth=(u:number)=>{const v=clamp01(u);return v*v*(3-2*v);};
const heading=(dx:number,dz:number)=>Math.atan2(-dx,-dz);

function measure(route:Pt[]){const lengths=[0];for(let i=1;i<route.length;i++)lengths.push(lengths[i-1]+Math.hypot(route[i][0]-route[i-1][0],route[i][1]-route[i-1][1]));return lengths;}
/** Point and travel heading a distance `s` along a polyline. */
function along(route:Pt[],lengths:number[],s:number){
 const total=lengths[lengths.length-1],d=Math.max(0,Math.min(total,s));
 let i=1;while(i<lengths.length-1&&lengths[i]<d)i++;
 const a=route[i-1],b=route[i],span=lengths[i]-lengths[i-1],u=span>1e-9?(d-lengths[i-1])/span:0;
 return {x:a[0]+(b[0]-a[0])*u,z:a[1]+(b[1]-a[1])*u,yaw:heading(b[0]-a[0],b[1]-a[1])};
}
/** Distance after `t` seconds when starting and stopping at rest: accelerate, cruise at v, brake. Returns duration too. */
function trapezoid(length:number,v:number,accel:number,brake:number){
 const duration=length/v+(accel+brake)/2;
 const at=(t:number)=>{
  if(t<=0)return 0;if(t>=duration)return length;
  if(t<accel)return v*t*t/(2*accel);
  if(t>duration-brake){const r=duration-t;return length-v*r*r/(2*brake);}
  return v*accel/2+v*(t-accel);
 };
 return {duration,at};
}

const groundIn:Pt[]=roundedRoad([[R.x,R.touchdownZ],[R.x,R.southLaneZ],[AIRPORT_LAYOUT.taxiX,R.southLaneZ],[AIRPORT_LAYOUT.taxiX,ARRIVAL_STAND.z],[ARRIVAL_STAND.x,ARRIVAL_STAND.z]],.9);
const groundInLengths=measure(groundIn);
const pushRoute:Pt[]=roundedRoad([[ARRIVAL_STAND.x,ARRIVAL_STAND.z],[PUSH_END.x,ARRIVAL_STAND.z],[PUSH_END.x,PUSH_END.z]],.6);
const pushLengths=measure(pushRoute);
const taxiOut:Pt[]=[[PUSH_END.x,PUSH_END.z],[HOLD.x,HOLD.z]];
const taxiOutLengths=measure(taxiOut);

/** Rollout: touch down at approach speed, brake to taxi speed, taxi, then stop at the stand. */
function rollout(){
 const A=ARRIVAL,L=groundInLengths[groundInLengths.length-1],t1=(A.speed-A.taxiSpeed)/A.rolloutDecel,s1=A.speed*t1-A.rolloutDecel*t1*t1/2;
 const cruise=(L-s1-A.taxiSpeed*A.stopTime/2)/A.taxiSpeed,duration=t1+cruise+A.stopTime;
 const at=(t:number)=>{
  if(t<=0)return 0;if(t>=duration)return L;
  if(t<t1)return A.speed*t-A.rolloutDecel*t*t/2;
  if(t<t1+cruise)return s1+A.taxiSpeed*(t-t1);
  const r=duration-t;return L-A.taxiSpeed*r*r/(2*A.stopTime);
 };
 return {duration,at};
}
const ROLLOUT=rollout();
const PUSH=trapezoid(pushLengths[pushLengths.length-1],ARRIVAL.pushSpeed,2,2);
const TAXI_OUT=trapezoid(taxiOutLengths[taxiOutLengths.length-1],ARRIVAL.taxiSpeed,1.5,2.5);

/** Final approach in airport-local coordinates: straight in on a constant glide angle, touching down at the aiming
 * point. Its length is the longest of FINAL_LENGTHS whose straight leg clears every obstacle, so when the Team Events
 * Arena sits off the runway end (Khaneil, 2026-11-13) the jet turns onto a short final past it instead of over it. */
interface Final {length:number;height:number;time:number;start:XZ}
const FINAL_LENGTHS=[ARRIVAL.finalLength,15,12,10,8,6.5,5,4];
function finalLeg(length:number):Final{
 const height=ARRIVAL.finalHeight*length/ARRIVAL.finalLength;
 return {length,height,time:Math.hypot(length,height)/ARRIVAL.speed,start:{x:R.x,z:R.touchdownZ-length}};
}
/** Glide path with a flare: straight for most of the final, easing to zero sink at touchdown. */
function glide(x:number){const k=ARRIVAL.flare;return (x>k?x-k/2:x*x/(2*k))/(1-k/2);}

function hermite(s:XZ,a:XZ,j:XZ,b:XZ,u:number):XZ{
 const h00=2*u**3-3*u*u+1,h10=u**3-2*u*u+u,h01=-2*u**3+3*u*u,h11=u**3-u*u;
 return {x:s.x*h00+a.x*h10+j.x*h01+b.x*h11,z:s.z*h00+a.z*h10+j.z*h01+b.z*h11};
}
const SAMPLES=100;
interface Approach {final:Final;exitDep:number;from:XZ;a:XZ;b:XZ;lengths:number[];length:number;v0:number;duration:number;cruise:number}
/** Clearance kept around and above anything under the approach (matches the departure climb-out check). */
const OBSTACLE_RADIUS=2.2,OBSTACLE_GAP=.8,MAX_DESCENT=.2,MAX_TURN=3;
function approachPoint(p:Approach,t:number){
 const d=p.duration,u=clamp01(t/d),v1=ARRIVAL.speed;
 const s=Math.max(0,Math.min(p.length,(u**3-2*u*u+u)*d*p.v0+(-2*u**3+3*u*u)*p.length+(u**3-u*u)*d*v1));
 let lo=0,hi=SAMPLES;while(hi-lo>1){const mid=(lo+hi)>>1;if(p.lengths[mid]<=s)lo=mid;else hi=mid;}
 const span=p.lengths[hi]-p.lengths[lo],f=span>1e-9?(s-p.lengths[lo])/span:0;
 const xz=hermite(p.from,p.a,p.final.start,p.b,(lo+f)/SAMPLES);
 // Altitude: level at the circuit, then a descent that meets the glide path's sink rate at the start of final.
 const sink=-p.final.height/p.final.time*glideSlope();
 const y=p.cruise*(2*u**3-3*u*u+1)+p.final.height*(-2*u**3+3*u*u)+(u**3-u*u)*d*sink;
 return {...xz,y};
}
function glideSlope(){return 1/(1-ARRIVAL.flare/2);}

const cache=new WeakMap<FlightCircuit,Approach>();
/** Pick where to leave the circuit and how to curve onto final: gentlest turn, a believable descent, clear of obstacles. */
export function arrivalApproach(circuit:FlightCircuit=DEFAULT_CIRCUIT):Approach{
 const hit=cache.get(circuit);if(hit)return hit;
 const cruise=(circuit.altitude??14)-.28,K=DEPARTURE_PACE*CIRCUIT_PACE,obstacles=circuit.obstacles??[];
 const final=finalLeg(FINAL_LENGTHS.find(l=>finalClears(finalLeg(l),obstacles))??FINAL_LENGTHS[FINAL_LENGTHS.length-1]);
 const end=final.start,dir1={x:0,z:1},v1=ARRIVAL.speed;
 const valid:{cost:number;p:Approach}[]=[];let fallback:{cost:number;p:Approach}|undefined;
 for(let dep=DEPARTURE_TIMES.join+ARRIVAL.exitFrom;dep<=DEPARTURE_TIMES.join+ARRIVAL.exitTo;dep+=.5){
  const st=circuitState(circuit,dep),from=fromDeparture(st.at);
  const v0=Math.hypot(st.velocity.x,st.velocity.z)*K,dir0={x:st.velocity.x*K/v0,z:-st.velocity.z*K/v0};
  const straight=Math.hypot(end.x-from.x,end.z-from.z);
  for(const scale of [.4,.6,.8,1,1.2]){
   const a={x:dir0.x*straight*scale,z:dir0.z*straight*scale},b={x:dir1.x*straight*scale,z:dir1.z*straight*scale};
   const lengths=[0];let prev=from,yaw=heading(dir0.x,dir0.z),sharpest=0,total=0;
   for(let i=1;i<=SAMPLES;i++){
    const q=hermite(from,a,end,b,i/SAMPLES),dx=q.x-prev.x,dz=q.z-prev.z,step=Math.hypot(dx,dz),h=step>1e-9?heading(dx,dz):yaw;
    let turn=h-yaw;turn=Math.abs(Math.atan2(Math.sin(turn),Math.cos(turn)));
    sharpest=Math.max(sharpest,turn/Math.max(step,1e-6));total+=turn;lengths.push(lengths[i-1]+step);yaw=h;prev=q;
   }
   const length=lengths[SAMPLES],duration=2*length/(v0+v1);
   const descent=Math.atan2(cruise-final.height,length);
   // Turn rate at the average speed, total turning, a steep-descent penalty, and a nudge toward shorter flights.
   const cost=sharpest*(v0+v1)/2+total*.3+Math.max(0,descent-MAX_DESCENT)*40+(dep-DEPARTURE_TIMES.join)*.004;
   const p:Approach={final,exitDep:dep,from,a,b,lengths,length,v0,duration,cruise};
   // Hold time this exit gives; outside its window the jet would wait too long (two at the hold) or not at all.
   const hold=LOOP_CYCLE-exitTime(p,LOOP.taxi)-legsTotal(p),miss=Math.max(0,LOOP.holdMin-hold,hold-LOOP.holdMax-LOOP.standExtra);
   if(!fallback||miss*10+cost<fallback.cost)fallback={cost:miss*10+cost,p};
   if(miss>0)continue;
   // A believable turn (the renderer banks into it), clear of every building.
   if(sharpest*Math.max(v0,v1)<MAX_TURN&&clears(p,obstacles))valid.push({cost,p});
  }
 }
 // Cheapest first, the first whose loop keeps every pair of airborne jets apart; failing that, the one closest to it.
 valid.sort((m,n)=>m.cost-n.cost);
 let pick:{close:number;p:Approach}|undefined;
 for(const v of valid){const close=airConflict(v.p,circuit);if(!pick||close<pick.close)pick={close,p:v.p};if(!close)break;}
 const chosen=(pick?.p??fallback!.p);cache.set(circuit,chosen);return chosen;
}
/** The straight final, sampled along its glide path, against the same clearance box as the curved approach. */
function finalClears(f:Final,obstacles:NonNullable<FlightCircuit['obstacles']>){
 for(let u=0;u<=1;u+=.02){
  const {x,z}=toDeparture({x:f.start.x,z:f.start.z+f.length*u}),y=f.height*glide(1-u);
  for(const o of obstacles)if(Math.abs(x-o.x)<o.hw+OBSTACLE_RADIUS&&Math.abs(z-o.z)<o.hd+OBSTACLE_RADIUS&&y-.2<o.h+OBSTACLE_GAP)return false;
 }
 return true;
}
/** Airborne position of a jet `phase` seconds after its release with this approach, or undefined on the ground. */
function airAt(phase:number,p:Approach,circuit:FlightCircuit){
 const leave=exitTime(p,LOOP.taxi),j=DEPARTURE_TIMES.join;
 if(phase<LOOP.taxi)return;
 if(phase<leave){const e=(phase-LOOP.taxi)*DEPARTURE_PACE,d=departurePose(Math.min(e<j?e:j+(e-j)*CIRCUIT_PACE,p.exitDep),true,circuit);return {...fromDeparture(d),y:d.y-.28};}
 const t=phase-leave;if(t<p.duration+p.final.time)return airPose(t,p);
}
/** How far inside AIR_GAP two airborne jets come, summed over the loop: landings now meet takeoffs and the circuit
 * from the other end, so the whole cycle is checked, not just the approach. Zero when every pair stays apart. */
const AIR_GAP=5.3;
function airConflict(p:Approach,circuit:FlightCircuit){
 let close=0;
 for(let t=0;t<LOOP.interval;t+=.5){
  const air=Array.from({length:LOOP.count},(_,k)=>airAt(((t-k*LOOP.interval)%LOOP_CYCLE+LOOP_CYCLE)%LOOP_CYCLE,p,circuit)).filter((q):q is {x:number;y:number;z:number}=>!!q&&q.y>.5);
  for(let i=0;i<air.length;i++)for(let k=i+1;k<air.length;k++)close+=Math.max(0,AIR_GAP-Math.hypot(air[i].x-air[k].x,air[i].y-air[k].y,air[i].z-air[k].z));
 }
 return close;
}
function clears(p:Approach,obstacles:NonNullable<FlightCircuit['obstacles']>){
 if(!obstacles.length)return true;
 for(let t=0;t<=p.duration;t+=.2){
  const q=approachPoint(p,t),{x,z}=toDeparture(q);
  for(const o of obstacles)if(Math.abs(x-o.x)<o.hw+OBSTACLE_RADIUS&&Math.abs(z-o.z)<o.hd+OBSTACLE_RADIUS&&q.y-.2<o.h+OBSTACLE_GAP)return false;
 }
 return true;
}

/** Real seconds from release (at the hold) at which the circuit is left: taxi, then departure time paced as in fleetPose. */
export function exitTime(p:Approach,taxi:number){const j=DEPARTURE_TIMES.join;return taxi+(j+(p.exitDep-j)/CIRCUIT_PACE)/DEPARTURE_PACE;}

/** Durations of every leg after leaving the circuit, in real seconds. */
export function arrivalLegs(p:Approach){
 return {approach:p.duration,final:p.final.time,rollout:ROLLOUT.duration,dwell:ARRIVAL.dwell,push:PUSH.duration,pause:ARRIVAL.pause,taxiOut:TAXI_OUT.duration};
}
export const legsTotal=(p:Approach)=>Object.values(arrivalLegs(p)).reduce((a,b)=>a+b,0);

const AIRBORNE_PITCH=.03,FLARE_PITCH=.09,MAX_BANK=.42;
/** Pose `t` real seconds after leaving the circuit. Past the end of taxi-out the aircraft holds short. */
export function arrivalPose(t:number,p:Approach,dwell:number=ARRIVAL.dwell):GroundPose{
 const ground=(x:number,z:number,yaw:number,pitch=0):GroundPose=>({x,y:0,z,yaw,pitch,roll:0,gear:1,visible:true});
 if(t<p.duration+p.final.time)return airPose(t,p);
 let r=t-p.duration-p.final.time;
 if(r<ROLLOUT.duration){const q=along(groundIn,groundInLengths,ROLLOUT.at(r));return ground(q.x,q.z,q.yaw,FLARE_PITCH*(1-smooth(r/1.4)));}
 r-=ROLLOUT.duration;
 if(r<dwell){const q=along(groundIn,groundInLengths,Infinity);return ground(q.x,q.z,q.yaw);}
 r-=dwell;
 // Pushback: the tug moves the jet tail first, so it faces opposite to its direction of travel.
 if(r<PUSH.duration+ARRIVAL.pause){const q=along(pushRoute,pushLengths,PUSH.at(r));return ground(q.x,q.z,q.yaw+Math.PI);}
 r-=PUSH.duration+ARRIVAL.pause;
 const q=along(taxiOut,taxiOutLengths,TAXI_OUT.at(r));return ground(q.x,q.z,q.yaw);
}
function airPose(t:number,p:Approach):GroundPose{
 const at=(time:number)=>{
  if(time<p.duration){const q=approachPoint(p,time);return {x:q.x,z:q.z,y:q.y};}
  const f=p.final,u=clamp01((time-p.duration)/f.time);
  return {x:f.start.x,z:f.start.z+f.length*u,y:f.height*glide(1-u)};
 };
 const dt=.02,here=at(t),next=at(t+dt),before=at(Math.max(0,t-dt));
 const dx=next.x-here.x,dz=next.z-here.z,horizontal=Math.hypot(dx,dz),yaw=horizontal>1e-9?heading(dx,dz):0;
 const path=horizontal>1e-6?Math.atan2(next.y-here.y,horizontal):0;
 // Nose a little above the flight path, raised for the flare over the last second and a half.
 const flare=smooth((t-(p.duration+p.final.time-1.5))/1.2);
 const pitch=(AIRBORNE_PITCH+path*.35)*(1-flare)+FLARE_PITCH*flare;
 let turn=yaw-heading(here.x-before.x,here.z-before.z);turn=Math.atan2(Math.sin(turn),Math.cos(turn));
 const roll=t>dt?Math.max(-MAX_BANK,Math.min(MAX_BANK,turn/dt*1.6)):0;
 const gear=t<p.duration?smooth((t-(p.duration-8))/2):1;
 return {x:here.x,y:here.y,z:here.z,yaw,pitch,roll,gear,visible:true};
}
