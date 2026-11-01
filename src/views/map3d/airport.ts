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
   if(remaining<=d||i===AIRPORT_TAXI_ROUTE.length-1){const u=Math.min(1,remaining/d);return {x:a[0]+(b[0]-a[0])*u,y:0,z:a[1]+(b[1]-a[1])*u,yaw:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1])),pitch:0,visible:true};}
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

export interface FlightCircuit { x:number; z:number; rx:number; rz:number; altitude?:number }
/** Decorative three-minute cycle: takeoff, two city circuits, departure, then reset offscreen. */
export function departurePose(seconds:number,moving=true,circuit:FlightCircuit={x:-18,z:-4,rx:22,rz:18}) {
  const t=moving?seconds%180:0,cruise=circuit.altitude??14;
  const smooth=(u:number)=>{const v=Math.max(0,Math.min(1,u));return v*v*(3-2*v);};
  // Reach skyline clearance on the runway heading before the first city turn.
  const climb=(time:number)=>circuit.altitude===undefined?.28+Math.max(0,time-10)**1.3*.16:.28+(cruise-.28)*smooth((time-10)/8);
  const position=(time:number)=>{
    if(time<18){const roll=Math.max(0,time-3);return {x:0,z:10.4-Math.min(roll,9)**2*.12-Math.max(0,roll-9)*1.4,y:climb(time)};}
    const startZ=10.4-9**2*.12-6*1.4;
    if(time<30){
      const u=(time-18)/12,v=1-u;
      return {x:3*v*u*u*(circuit.x-10)+u**3*circuit.x,z:v**3*startZ+3*v*v*u*(startZ-12)+(3*v*u*u+u**3)*(circuit.z-circuit.rz),y:climb(18)+(cruise-climb(18))*(u*u*(3-2*u))};
    }
    if(time<150){const angle=(time-30)*Math.PI/30;return {x:circuit.x+circuit.rx*Math.sin(angle),z:circuit.z-circuit.rz*Math.cos(angle),y:cruise};}
    return {x:circuit.x+(time-150)*circuit.rx*Math.PI/30,z:circuit.z-circuit.rz-(time-150)**2*.06,y:cruise+(time-150)*.15};
  };
  const p=position(t),next=position(t+.01);
  return {...p,yaw:Math.atan2(-(next.x-p.x),-(next.z-p.z)),pitch:t<18?-Math.min(.16,Math.max(0,t-10)*.025):0,visible:t<162};
}
