import {roundedRoad} from "./highway";
import type { Rect, Slab } from "./scene";
export const AIRPORT_KEY = "service:logistics-airport";
export const AIRPORT_LAYOUT={mirrorWidth:8,landX:-2,landZ:-16,landWidth:28,landDepth:43,terminalX:1.5,terminalZ:6,taxiX:11.5,runwayX:15,runwayZ:7.5,runwayWidth:2.2,runwayLength:21,gateX:7,gateZ:[0,4.5,9,13.5],cargoZ:18,departureZ:16.5} as const;
export const AIRPORT_REMOTE_STANDS=[{x:7,z:-6},{x:7,z:23}] as const;
export const AIRPORT_TERMINAL={x:1.5,z:6,width:3.8,depth:10.5,floorHeight:1.2,roof:2.61,arrivalsX:-1.5,parkingZ:-6.4} as const;
export function airportParkingBays(){return Array.from({length:5},(_,i)=>({x:-.35+i*.7,z:AIRPORT_TERMINAL.parkingZ+.7}));}
export const AIRCRAFT_LAYOUT={doorX:-.2,doorZ:-.8,doorY:.19,doorHeight:.29,halfSpan:1.35,halfLength:1.4} as const;
export const BOARDING_LAYOUT={floor:.22,ceiling:.54,fromX:3.375} as const;
export function boardingBridge(gateZ:number){const endX=AIRPORT_LAYOUT.gateX+AIRCRAFT_LAYOUT.doorX;return {x:(BOARDING_LAYOUT.fromX+endX)/2,z:gateZ+AIRCRAFT_LAYOUT.doorZ,w:endX-BOARDING_LAYOUT.fromX,endX};}
export interface AirportPlan { x:number; z:number; accessX: number; accessZ: number; west?: boolean; publicViaZ?:number }
/** Airport-local coordinates are the only source of truth, including west-facing campuses. */
export function airportPoint(a:AirportPlan,x:number,z:number):[number,number] {
 return [a.x+(a.west?AIRPORT_LAYOUT.mirrorWidth-x:x),a.z+z];
}
export function airportFootprint(a:AirportPlan):Rect {
 const p=airportPoint(a,a.west?AIRPORT_LAYOUT.landX+AIRPORT_LAYOUT.landWidth:AIRPORT_LAYOUT.landX,AIRPORT_LAYOUT.landZ);
 return {x:p[0],z:p[1],w:AIRPORT_LAYOUT.landWidth,d:AIRPORT_LAYOUT.landDepth};
}
export function airportPublicPath(a:AirportPlan):[number,number][] {
 const front=airportPoint(a,-.7,AIRPORT_LAYOUT.terminalZ);
 return a.publicViaZ===undefined?[[a.accessX,a.accessZ+.6],[front[0],a.accessZ+.6],front,airportPoint(a,-.45,AIRPORT_LAYOUT.terminalZ)]:[[a.accessX,a.accessZ+.6],[a.accessX,a.publicViaZ+.6],[front[0],a.publicViaZ+.6],front,airportPoint(a,-.45,AIRPORT_LAYOUT.terminalZ)];
}
export function airportCargoPoint(a:AirportPlan):[number,number] {return airportPoint(a,5,AIRPORT_LAYOUT.cargoZ);}
export const AIRPORT_TAXI_ROUTE=roundedRoad([[11.5,11.5],[11.5,17.5],[15,17.5],[15,16.5]],.65);
const TAXI_LENGTH=AIRPORT_TAXI_ROUTE.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b[0]-AIRPORT_TAXI_ROUTE[i][0],b[1]-AIRPORT_TAXI_ROUTE[i][1]),0);
/** A waiting aircraft taxis to the threshold, holds, then follows the existing city circuit. */
export function airportFlightPose(seconds:number,moving=true,circuit?:FlightCircuit){
 const t=moving?seconds%210:0;
 if(t<24){
  let remaining=Math.min(1,t/20)*TAXI_LENGTH;
  for(let i=1;i<AIRPORT_TAXI_ROUTE.length;i++){
   const a=AIRPORT_TAXI_ROUTE[i-1],b=AIRPORT_TAXI_ROUTE[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
   if(remaining<=d||i===AIRPORT_TAXI_ROUTE.length-1){const u=Math.min(1,remaining/d);return {x:a[0]+(b[0]-a[0])*u,y:0,z:a[1]+(b[1]-a[1])*u,yaw:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1])),pitch:0,roll:0,gear:1,visible:true};}
   remaining-=d;
  }

 }
 const p=departurePose(Math.min(t-24,179),true,circuit);
 return {...p,yaw:t<27?0:p.yaw,x:15+p.x,y:p.y-.28,z:16.5+p.z-10.4};
}
/** Reserve new land outside the city; connect to the outermost existing paved edge. */
export function planAirport(land: Rect[], paving: Slab[], skyline?: Rect): AirportPlan | undefined {
  if (!land.length || !paving.length) return undefined;
  if(skyline) {
    const paths=paving.filter(p=>p.x>=skyline.x-.1&&p.x<=skyline.x+skyline.w&&p.z>=skyline.z&&p.z+p.d<=skyline.z+skyline.d);
    if(paths.length) {
      const access=paths.reduce((a,b)=>b.x<a.x?b:a);
      const accessZ=access.z+access.d/2;
      return {x:Math.min(...land.map(r=>r.x))-11.2,z:accessZ-6,accessX:access.x+.1,accessZ,west:true,publicViaZ:skyline.x>Math.min(...land.map(r=>r.x))+3?skyline.z+skyline.d+1.5:undefined};
    }
  }
  const edge = Math.max(...land.map(r => r.x + r.w));
  const access = paving.reduce((a,b) => b.x+b.w>a.x+a.w ? b : a);
  const accessZ = access.z + access.d / 2;
  return { x: edge + 1.2, z: accessZ - 6, accessX: access.x+access.w-.1, accessZ };
}

/** Landside plaza joining the terminal entrance to the district terrace across from it (KC, 2026-10-31):
 * terrace-height land over the meadow gap, centred on the entrance and clipped to the facing terrace. */
export const AIRPORT_FORECOURT={reach:5,half:3.2} as const;
export function airportForecourt(a:AirportPlan,terraces:Rect[]):Rect|undefined{
 const f=airportFootprint(a),edge=a.west?f.x+f.w:f.x,ez=a.z+AIRPORT_LAYOUT.terminalZ;
 const gap=(t:Rect)=>a.west?t.x-edge:edge-(t.x+t.w);
 const facing=terraces.filter(t=>t.z<=ez&&t.z+t.d>=ez&&gap(t)>.05&&gap(t)<=AIRPORT_FORECOURT.reach).sort((p,q)=>gap(p)-gap(q))[0];
 if(!facing)return undefined;
 const z0=Math.max(facing.z,ez-AIRPORT_FORECOURT.half),z1=Math.min(facing.z+facing.d,ez+AIRPORT_FORECOURT.half);
 return {x:a.west?edge:facing.x+facing.w,z:z0,w:gap(facing),d:z1-z0};
}
/** True when a polyline passes over the rectangle (with a margin). */
export function pathCrossesRect(path:[number,number][],r:Rect,margin=0):boolean{
 const inside=(x:number,z:number)=>x>r.x-margin&&x<r.x+r.w+margin&&z>r.z-margin&&z<r.z+r.d+margin;
 if(path.length===1)return inside(path[0][0],path[0][1]);
 return path.slice(1).some((b,i)=>{const p=path[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-p[0],b[1]-p[1])/.05));for(let k=0;k<=n;k++)if(inside(p[0]+(b[0]-p[0])*k/n,p[1]+(b[1]-p[1])*k/n))return true;return false;});
}

/** Something tall near the departure path, in departure coordinates: centre, half width/depth and roof height. */
export interface FlightObstacle { x:number; z:number; hw:number; hd:number; h:number }
export interface FlightCircuit { x:number; z:number; rx:number; rz:number; altitude?:number; obstacles?:FlightObstacle[] }
/** Takeoff timing in departure seconds: line up, accelerate, rotate, lift off, then climb out. */
export const TAKEOFF={hold:2,accel:.32,liftoff:9.5,rotate:1.1,climbAccel:.25,climbTop:30,climbRamp:4,rotationPitch:.17,cruisePitch:.04,maxPitch:.45,maxBank:.42,gearUp:1.5,gearTime:2,mainGearZ:.5} as const;
const clamp01=(u:number)=>Math.max(0,Math.min(1,u));
const smooth=(u:number)=>{const v=clamp01(u);return v*v*(3-2*v);};
const T=TAKEOFF,LIFT_SPEED=T.accel*(T.liftoff-T.hold),LIFT_DISTANCE=.5*T.accel*(T.liftoff-T.hold)**2;
/** Distance travelled down the runway heading: constant acceleration to rotation speed, then a gentler climb-out acceleration. */
export function takeoffDistance(t:number){
  if(t<=T.hold)return 0;
  if(t<=T.liftoff)return .5*T.accel*(t-T.hold)**2;
  const u=t-T.liftoff;return LIFT_DISTANCE+LIFT_SPEED*u+.5*T.climbAccel*u*u;
}
/** Pitch on the runway: nose rises over the rotation window while the main gear stays down. */
export const rotationPitch=(t:number)=>T.rotationPitch*smooth((t-(T.liftoff-T.rotate))/T.rotate);
/** Share of the climb to cruise completed: vertical speed ramps up after liftoff, holds steady, then eases off to level flight. */
export function climbFraction(t:number,top:number=T.climbTop){
  const d=top-T.liftoff,r=T.climbRamp,u=Math.max(0,Math.min(d,t-T.liftoff)),v=1/(d-r);
  if(u<r)return v*u*u/(2*r);
  if(u<d-r)return v*(u-r/2);
  return 1-v*(d-u)**2/(2*r);
}
/** Landing gear: 1 = down, 0 = stowed. Retracts shortly after a positive climb. */
export const gearDown=(t:number)=>1-smooth((t-T.liftoff-T.gearUp)/T.gearTime);
const DEFAULT_CIRCUIT:FlightCircuit={x:-18,z:-4,rx:22,rz:18};
/** Circuit angular speed: one lap every 60 seconds. */
const ORBIT=Math.PI/30,STRAIGHT=18;
/** The climb-out joins the circuit at JOIN; two laps later the aircraft leaves at EXIT and is hidden at HIDE. */
export const DEPARTURE_TIMES={join:40,exit:160,hide:172} as const;
const {join:JOIN,exit:EXIT,hide:HIDE}=DEPARTURE_TIMES;
type XZ={x:number;z:number};
const orbitPoint=(c:FlightCircuit,a:number):XZ=>({x:c.x+c.rx*Math.sin(a),z:c.z-c.rz*Math.cos(a)});
/** Departures fly the circuit in the direction that leaves the runway heading with a gentle turn. */
const SPIN=-1;
const orbitVelocity=(c:FlightCircuit,a:number):XZ=>({x:SPIN*c.rx*Math.cos(a)*ORBIT,z:SPIN*c.rz*Math.sin(a)*ORBIT});
/** Cubic Hermite curve between two points, with tangents a and b. */
function hermite(s:XZ,a:XZ,j:XZ,b:XZ,u:number):XZ{
  const h00=2*u**3-3*u*u+1,h10=u**3-2*u*u+u,h01=-2*u**3+3*u*u,h11=u**3-u*u;
  return {x:s.x*h00+a.x*h10+j.x*h01+b.x*h11,z:s.z*h00+a.z*h10+j.z*h01+b.z*h11};
}
const climbOutEnd=():{at:XZ;velocity:XZ}=>({at:{x:0,z:10.4-takeoffDistance(STRAIGHT)},velocity:{x:0,z:-(LIFT_SPEED+T.climbAccel*(STRAIGHT-T.liftoff))}});
const speedOf=(v:XZ)=>Math.hypot(v.x,v.z);
interface JoinTurn {angle:number;a:XZ;b:XZ;end:XZ;lengths:number[];length:number;v0:number;v1:number;climbTop:number}
/** Clearance kept around and above anything under the climb-out (matches the scene's flight clearance test). */
const OBSTACLE_RADIUS=2.2,OBSTACLE_GAP=.8,CLIMB_TOPS=[30,27,24,21,18,15];
/** Point on a join turn after `time` seconds: distance follows a smooth speed change from climb-out speed to circuit speed. */
function turnPosition(turn:Omit<JoinTurn,'climbTop'>,time:number):XZ{
  const {at}=climbOutEnd(),d=JOIN-STRAIGHT,u=Math.max(0,Math.min(1,time/d));
  const s=Math.max(0,Math.min(turn.length,(u**3-2*u*u+u)*d*turn.v0+(-2*u**3+3*u*u)*turn.length+(u**3-u*u)*d*turn.v1));
  let lo=0,hi=SAMPLES;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(turn.lengths[mid]<=s)lo=mid;else hi=mid;}
  const span=turn.lengths[hi]-turn.lengths[lo],f=span>1e-9?(s-turn.lengths[lo])/span:0;
  return hermite(at,turn.a,turn.end,turn.b,(lo+f)/SAMPLES);
}
/** True when the climb-out and turn stay above every obstacle they pass over. */
function climbClears(c:FlightCircuit,turn:Omit<JoinTurn,'climbTop'>,top:number){
  const obstacles=c.obstacles??[],cruise=c.altitude??14;
  if(!obstacles.length)return true;
  for(let time=T.liftoff;time<=JOIN;time+=.2){
    const p=time<STRAIGHT?{x:0,z:10.4-takeoffDistance(time)}:turnPosition(turn,time-STRAIGHT),y=(cruise-.28)*climbFraction(time,top);
    for(const o of obstacles)if(Math.abs(p.x-o.x)<o.hw+OBSTACLE_RADIUS&&Math.abs(p.z-o.z)<o.hd+OBSTACLE_RADIUS&&y-.2<o.h+OBSTACLE_GAP)return false;
  }
  return true;
}
const SAMPLES=120,joinCache=new WeakMap<FlightCircuit,JoinTurn>();
/** The turn from the runway heading onto the circuit. The join point and curve shape are chosen once per circuit for
 * the gentlest turn, and the aircraft then moves along the curve at a smoothly changing speed (no slow-down or hairpin). */
export function circuitJoin(c:FlightCircuit):JoinTurn{
  const cached=joinCache.get(c);if(cached)return cached;
  const {at,velocity}=climbOutEnd(),d=JOIN-STRAIGHT,v0=speedOf(velocity),dir0={x:velocity.x/v0,z:velocity.z/v0};
  const options:{cost:number;turn:Omit<JoinTurn,'climbTop'>}[]=[];
  for(let k=0;k<180;k++){
    const angle=k*Math.PI/90,end=orbitPoint(c,angle),w=orbitVelocity(c,angle),v1=speedOf(w),dir1={x:w.x/v1,z:w.z/v1};
    const cruise=(v0+v1)/2;
    for(const scale of [.5,.7,.9,1.1,1.3,1.6]){
      const a={x:dir0.x*cruise*d*scale,z:dir0.z*cruise*d*scale},b={x:dir1.x*cruise*d*scale,z:dir1.z*cruise*d*scale};
      const lengths=[0];let prev=at,heading=Math.atan2(-dir0.x,-dir0.z),sharpest=0,total=0;
      for(let i=1;i<=SAMPLES;i++){
        const p=hermite(at,a,end,b,i/SAMPLES),dx=p.x-prev.x,dz=p.z-prev.z,step=Math.hypot(dx,dz),h=step>1e-9?Math.atan2(-dx,-dz):heading;
        let turn=h-heading;turn=Math.abs(Math.atan2(Math.sin(turn),Math.cos(turn)));
        sharpest=Math.max(sharpest,turn/Math.max(step,1e-6));total+=turn;lengths.push(lengths[i-1]+step);heading=h;prev=p;
      }
      const length=lengths[SAMPLES],pace=length/d/cruise;
      // Turn rate at cruise speed, total turning, and a penalty when the curve is too long or short for the time allowed.
      const cost=sharpest*cruise+total*.3+Math.max(0,pace-1.3,.75-pace)*20;
      options.push({cost,turn:{angle,a,b,end,lengths,length,v0,v1}});
    }
  }
  options.sort((p,q)=>p.cost-q.cost);
  // Prefer the gentlest climb; climb more steeply only when every smooth turn would pass too low over a tower.
  let chosen:JoinTurn={...options[0].turn,climbTop:CLIMB_TOPS[CLIMB_TOPS.length-1]};
  // A slightly steeper climb is better than a much tighter turn, so first look only at turns close to the gentlest.
  search:for(const limit of [options[0].cost*1.4,Infinity])for(const top of CLIMB_TOPS)for(const o of options){if(o.cost>limit)break;if(climbClears(c,o.turn,top)){chosen={...o.turn,climbTop:top};break search;}}
  joinCache.set(c,chosen);return chosen;
}
export const circuitJoinAngle=(c:FlightCircuit)=>circuitJoin(c).angle;
/** Decorative three-minute cycle: takeoff, a smooth turn onto two city circuits, departure, then reset offscreen. */
export function departurePose(seconds:number,moving=true,circuit:FlightCircuit=DEFAULT_CIRCUIT) {
  const t=moving?seconds%180:0,cruise=circuit.altitude??14,turnPlan=circuitJoin(circuit),join=turnPlan.angle;
  // One continuous climb from liftoff to cruise: vertical speed builds gently, then levels off at the circuit.
  const climb=(time:number)=>.28+(cruise-.28)*climbFraction(time,turnPlan.climbTop);
  const exitAt=orbitPoint(circuit,join),exitVelocity=orbitVelocity(circuit,join),centre={x:exitAt.x-circuit.x,z:exitAt.z-circuit.z},outward=Math.hypot(centre.x,centre.z)||1;
  const position=(time:number)=>{
    if(time<STRAIGHT)return {x:0,z:10.4-takeoffDistance(time),y:climb(time)};
    if(time<JOIN)return {...turnPosition(turnPlan,time-STRAIGHT),y:climb(time)};
    if(time<EXIT)return {...orbitPoint(circuit,join+SPIN*(time-JOIN)*ORBIT),y:cruise};
    // Leave along the circuit heading, drifting outward and climbing away.
    const u=time-EXIT;return {x:exitAt.x+exitVelocity.x*u+centre.x/outward*u*u*.06,z:exitAt.z+exitVelocity.z*u+centre.z/outward*u*u*.06,y:cruise+u*.15};
  };
  const dt=.02,p=position(t),next=position(t+dt),before=position(Math.max(0,t-dt));
  const heading=(a:XZ,b:XZ)=>Math.hypot(b.x-a.x,b.z-a.z)<1e-9?0:Math.atan2(-(b.x-a.x),-(b.z-a.z));
  const horizontal=Math.hypot(next.x-p.x,next.z-p.z);
  const airborne=smooth((t-T.liftoff)/1.5);
  // Nose follows the flight path plus a small angle of attack, holding the rotation attitude through the initial climb.
  const path=horizontal>1e-6?Math.atan2(next.y-p.y,horizontal):0;
  const climbHold=t<T.liftoff+3?1:1-smooth((t-T.liftoff-3)/4);
  const pitch=Math.min(T.maxPitch,Math.max(rotationPitch(t)*climbHold,airborne*(path+T.cruisePitch)));
  // Bank into turns in proportion to the turn rate (airborne only).
  let turn=heading(p,next)-heading(before,p);turn=Math.atan2(Math.sin(turn),Math.cos(turn));
  const roll=t>dt&&t<HIDE?Math.max(-T.maxBank,Math.min(T.maxBank,turn/dt*3))*airborne:0;
  // Rotate about the main gear rather than the fuselage centre, so the tail stays clear of the runway.
  return {...p,y:p.y+T.mainGearZ*Math.sin(pitch)*(1-airborne),yaw:heading(p,next),pitch,roll,gear:gearDown(t),visible:t<HIDE};
}
