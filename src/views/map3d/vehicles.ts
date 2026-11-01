import {lanePath} from "./highway";
import { hash } from "../mapLayout";
import { crossing, ringPath, towerRing, type Pt, type Pt3 } from "./roads";
import type { Scene3D } from "./scene";

// Routes for the decorative vehicles: each one tours a district's stone paths, out from the plaza
// around its headquarters to each agent's house and back, stopping at the door, and over the road
// bridges to its neighbors' plazas and back. Pure data, so the routes can be checked against the map
// without rendering anything.

export type VehicleKind = "sedan" | "van" | "service" | "sports" | "amazon" | "ups" | "bus" | "taxi" | "pickup" | "semi" | "gwagon" | "bmw" | "convertible";

export type { Pt };

/** One step of a vehicle's loop: drive from a to b, or wait at a (b is where it heads next). */
export interface Leg {
  a: Pt;
  b: Pt;
  /** Height above the terrace paving at a and at b: above zero only on a bridge. */
  ya: number;
  yb: number;
  /** Seconds this leg takes. */
  dur: number;
  hold: boolean;
}

export interface VehiclePlan {
  id: string;
  kind: VehicleKind;
  color: string;
  legs: Leg[];
  /** Seconds for one full loop. */
  period: number;
  /** Where in its loop the vehicle starts, in seconds, so they don't move in step. */
  offset: number;
  serviceWindow?: {start:number;duration:number};
}

/** At most this many vehicles, one per district, in the busiest districts. */
export const MAX_VEHICLES = 24;
const SPEED = 0.36; // world units per second, before each vehicle's own variation
const FLEET: { kind: VehicleKind; color: string }[] = [
  { kind: "taxi", color: "#edbd35" },
  { kind: "pickup", color: "#17232c" },
  { kind: "semi", color: "#293f4d" },
  { kind: "gwagon", color: "#161e24" },
  { kind: "bmw", color: "#3577c4" },
  { kind: "convertible", color: "#b94034" },
  { kind: "amazon", color: "#294657" },
  { kind: "ups", color: "#553722" },
  { kind: "bus", color: "#f1eee1" },
  { kind: "van", color: "#ece3cc" },
  { kind: "service", color: "#8fa58a" },
  { kind: "sedan", color: "#a88a4c" },
  { kind: "van", color: "#8fa58a" },
  { kind: "sports", color: "#a63836" },
  { kind: "sedan", color: "#c5ced6" },
  { kind: "amazon", color: "#294657" },
  { kind: "van", color: "#d9b971" },
  { kind: "ups", color: "#553722" },
];

/** Connected city tours: cross into a district, continue through it, and return in the opposite lane. */
export function planVehicles(scene: Scene3D): VehiclePlan[] {
  const rings = new Map(scene.towers.flatMap(t => {
    const plaza = scene.paving.filter(p => p.w > t.size && Math.abs(p.x+p.w/2-t.x)<1e-6 && Math.abs(p.z+p.d/2-t.z)<1e-6 && Math.abs(p.w-p.d)<1e-6).sort((a,b)=>a.w-b.w)[0];
    const ring = plaza && towerRing(t,plaza.w);
    return ring ? [[t.projectId,ring] as const] : [];
  }));
  const origins=scene.towers.filter(t => rings.has(t.projectId) && scene.carBridges.some(b=>b.ends.includes(t.projectId)));
  const city = Array.from({length:origins.length ? MAX_VEHICLES : 0},(_,i)=>origins[i%origins.length]).map((t,i) => {
    const points: Pt3[] = [], visited = new Set<string>();
    const append = (path: Pt3[]) => { for (const p of path) if (!points.length || Math.hypot(p[0]-points[points.length-1][0],p[2]-points[points.length-1][2],p[1]-points[points.length-1][1])>1e-7) points.push(p); };
    const tour = (id:string, arrival?:Pt) => {
      let at=arrival;
      for (const bridge of scene.carBridges) {
        const end=bridge.ends.indexOf(id);
        if(end<0 || visited.has(bridge.key) || !rings.has(bridge.ends[1-end])) continue;
        visited.add(bridge.key);
        const out=crossing(bridge,end as 0|1), exit:Pt=[out[0][0],out[0][2]];
        if(at) append([at,...ringPath(rings.get(id)!,at,exit)].map(p=>[p[0],0,p[1]]));
        append(out);
        const last=out[out.length-1];
        tour(bridge.ends[1-end],[last[0],last[2]]);
        const back=crossing(bridge,(1-end) as 0|1);
        append(back); at=[back[back.length-1][0],back[back.length-1][2]];
      }
      if(at && arrival) append([at,...ringPath(rings.get(id)!,at,arrival)].map(p=>[p[0],0,p[1]]));
    };
    tour(t.projectId);
    if(points.length) append([points[0]]);
    const speed=SPEED*(0.85+0.3*hash(`${t.key}:speed`)), legs:Leg[]=[];
    for(let k=1;k<points.length;k++) {
      const a=points[k-1],b=points[k],length=Math.hypot(b[0]-a[0],b[2]-a[2]);
      if(length>1e-7) legs.push({a:[a[0],a[2]],b:[b[0],b[2]],ya:a[1],yb:b[1],dur:length/(speed*(a[1]!==b[1]?0.7:1)),hold:false});
    }
    const period=legs.reduce((n,l)=>n+l.dur,0);
    return {id:`${t.key}:traffic:${i}`,...FLEET[i%FLEET.length],legs,period,offset:hash(`${t.key}:${i}:offset`)*period};
  });
  return city;
}

/**
 * Where a vehicle is at time t, its height above the terrace paving, which way it should face (for
 * a wait, the way it leaves) and how steeply it climbs (rise over run).
 */
export function vehicleAt(v: VehiclePlan, t: number): { x: number; y: number; z: number; dx: number; dz: number; slope: number } {
  let u = (((t + v.offset) % v.period) + v.period) % v.period;
  const at = (l: Leg, f: number) => {
    const run = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    return {
      x: l.a[0] + (l.b[0] - l.a[0]) * f,
      y: l.ya + (l.yb - l.ya) * f,
      z: l.a[1] + (l.b[1] - l.a[1]) * f,
      dx: l.b[0] - l.a[0],
      dz: l.b[1] - l.a[1],
      slope: l.hold || run < 1e-6 ? 0 : (l.yb - l.ya) / run,
    };
  };
  for (const l of v.legs) {
    if (u <= l.dur) return at(l, l.hold ? 0 : u / l.dur);
    u -= l.dur;
  }
  return at(v.legs[v.legs.length - 1], 1);
}

/** Seconds a service car always has left in its interval, so a visit never overruns the next. */
const DEALER_VISIT_SLACK=8;
/** Service visits are decorative and share the exact driveway/bridge centerline. */
export function planDealershipTraffic(scene:Pick<Scene3D,'dealership'>):VehiclePlan[]{
 const d=scene.dealership;if(!d)return [];
 const source=[...d.service,...d.drive.slice(1),[d.x+d.showroom.cx+d.showroom.w/2+.06,d.z+d.showroom.cz] as Pt].filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>1e-7);
 return [{id:'bmw-service-out',interval:60,path:[...source].reverse(),kind:'bmw' as const,color:'#3577c4'}, {id:'bmw-service-in',interval:90,path:source,kind:'gwagon' as const,color:'#202a30'}].map(v=>{
  const path=lanePath(v.path,.12),length=path.slice(1).reduce((n,b,i)=>n+Math.hypot(b[0]-path[i][0],b[1]-path[i][1]),0);
  // Cruise at .9, but speed up on a longer drive so every visit ends well inside its interval.
  const speed=Math.max(.9,length/(v.interval-DEALER_VISIT_SLACK));
  const legs:Leg[]=path.slice(1).map((b,i)=>({a:path[i],b,ya:.03,yb:.03,dur:Math.hypot(b[0]-path[i][0],b[1]-path[i][1])/speed,hold:false}));
  const duration=legs.reduce((n,l)=>n+l.dur,0),end=v.path[v.path.length-1];
  legs.push({a:end,b:end,ya:.03,yb:.03,dur:Math.max(.1,v.interval-duration),hold:true});
  return {id:v.id,kind:v.kind,color:v.color,legs,period:v.interval,offset:0,serviceWindow:{start:v.interval,duration}};
 });
}
export function vehicleVisible(v:VehiclePlan,seconds:number){return !v.serviceWindow||(seconds>=v.serviceWindow.start&&seconds%v.period<v.serviceWindow.duration);}

/** Door follows the same service-visit schedule as the cars, with time to clear the opening. */
export function dealershipGarageOpen(plans:VehiclePlan[],seconds:number):number{
 let open=0;
 for(const v of plans){if(!v.serviceWindow)continue;const cycle=Math.floor(seconds/v.period);
  for(const n of [cycle,cycle+1]){if(n<1)continue;const event=n*v.period+(v.id.endsWith('-in')?v.serviceWindow.duration:0),start=event-(v.id.endsWith('-in')?3:2),end=event+(v.id.endsWith('-in')?2:4);
   open=Math.max(open,Math.max(0,Math.min(1,seconds-start,end-seconds)));
  }
 }
 return open;
}

/** Highway cruising is faster than city driving, with evenly spaced traffic in both lanes. */
export const HIGHWAY_TRAFFIC_SPEED=1.55;
export const HIGHWAY_TRAFFIC_COUNT=16;
export function planHighwayTraffic(scene:Pick<Scene3D,'freight'>):VehiclePlan[]{
 if(!scene.freight)return [];
 const fleet:VehicleKind[]=['taxi','pickup','bmw','van','gwagon','convertible','sedan','semi'];
 const road=scene.freight.highway;
 const lanes=[road,[...road].reverse()].map(center=>{
  const path=lanePath(center);
  const legs:Leg[]=path.slice(1).map((b,j)=>({a:path[j],b,ya:.03,yb:.03,dur:Math.hypot(b[0]-path[j][0],b[1]-path[j][1])/HIGHWAY_TRAFFIC_SPEED,hold:false}));
  return {legs,period:legs.reduce((sum,l)=>sum+l.dur,0)};
 });
 return Array.from({length:HIGHWAY_TRAFFIC_COUNT},(_,i)=>{
  const lane=lanes[i%2],slot=Math.floor(i/2),kind=fleet[(slot+(i%2)*3)%fleet.length];
  return {id:`highway-${i}-${kind}`,kind,color:['#d7aa43','#172326','#e5dfcf','#2163ad','#91a4ac','#813f38'][i%6],...lane,offset:lane.period*(slot+.25+(i%2)*.35)/(HIGHWAY_TRAFFIC_COUNT/2)};
 });
}
