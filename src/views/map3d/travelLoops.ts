import {along,commuterRoute,type CommuterRoute} from './railCommuters';
import {PERIMETER_RAIL,type PerimeterRailPlan} from './perimeterRailPlan';
import type {Point3} from './hillsCommunityPlan';
import {buildStreetGraph,streetLines,streetRoute,type StreetGraph} from './streetGraph';
import {drivingGraph,loopLegs,JUNCTION_STOP,type Leg,type VehicleKind,type VehiclePlan} from './vehicles';
import {marinaSite} from './marinaPlan';
import {yachtBerth,boardingRoute,type YachtBerth} from './yachtPlan';
import {airportPoint} from './airport';
import {stadiumGate} from './stadiumGeometry';
import {TERRACE_H,type Scene3D} from './scene';
import type {Pt3} from './roads';

/**
 * Travel loops (Khaneil, 2026-11-13: "loops of people traveling on the train to the airport then board the plane...
 * cars going to the airport to drop off people... people from Team Residence going to train to go to yacht before it
 * leaves... after agents get to the yacht it sails off and comes back within 1 min"). Decorative only: the people are
 * the map's existing unnamed figures (the train passengers, the yacht's walkers and some Financial District office
 * walkers, "utilize people already in Atlas"), never real agents or real activity, and no dashboard data changes.
 * Later the same day: "make it longer have it sail in the ocean and return in 3 minutes": the yacht now cruises out to
 * sea for TRAVEL.sail seconds (under three minutes) every yachtLaps train laps.
 *
 * One general system. A traveller is a timeline of steps, each one walk (visible), a wait at a stop (visible, standing)
 * or a ride or stay (hidden: aboard a train, a car or the yacht, or inside a building). Rides are keyed to the existing
 * perimeter train timetable and to three shuttle cars, which are three of the city's 24 cars put on fixed rounds.
 * Everything repeats every train lap: each journey has two groups who ride on alternate laps. Pure and deterministic.
 */
export const TRAVEL={pace:.6,carSpeed:1,lane:.3,carStop:4,boardBy:2.5,sail:170,sailLead:4,sailEase:8,yachtSideStep:1.5} as const;

/** Where Atlas places are on the map: Team Residence Towers is the Financial District "circa" pair. */
const HOME_ID='circa';
const STATION={financial:'service:financial-station',hub:'service:atlas-station',arena:'service:stadium-station'} as const;

export interface TravelSeg {t0:number;t1:number;route:CommuterRoute;d0:number;pace:number;lane:number;y:'stair'|'absolute'}
export type Riding='train'|'car'|'yacht'|'inside';
export interface Traveller {id:string;journey:string;group:number;period:number;offset:number;segs:TravelSeg[];rides:{t0:number;t1:number;kind:Riding}[];span:[number,number]}
export interface Shuttle {plan:VehiclePlan;stops:Pt3[];names:string[];times:number[]}
export interface TravelPlan {lap:number;travellers:Traveller[];shuttles:Shuttle[];yacht?:{berth:YachtBerth;depart:number;back:number;period:number}}
export type TravellerState={visible:false;riding?:Riding}|{visible:true;x:number;y:number;z:number;yaw:number;absolute:boolean};

/** Shared clock (seconds since the map's train started), set each frame by the train so cars and yacht keep its time. */
export const TRAVEL_CLOCK={t:0,live:false};

const mod=(a:number,n:number)=>((a%n)+n)%n;
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a,lcm=(a:number,b:number)=>a/gcd(a,b)*b;
const flat=(a:Pt3,b:Pt3)=>Math.hypot(b[0]-a[0],b[2]-a[2]);

/** A walking route on the city's own streets, from a point to a point (agents walk the same way, agentCommutes.ts). */
function streetWalk(g:StreetGraph,from:Point3,to:Point3):Point3[]|undefined{
 const via=streetRoute(g,from,to);return via&&[from,...via,to];
}

// ---------------------------------------------------------------- cars

/**
 * Shortest drive from node a to node b on the directed street network, never turning back the way it came
 * (no U-turns), arriving from any node except `notFrom`. States are (previous node, node).
 */
function drive(nodes:Pt3[],next:number[][],a:number,b:number,prev:number,notFrom:number):number[]|undefined{
 const key=(p:number,c:number)=>p*nodes.length+c,cost=new Map<number,number>(),came=new Map<number,number>(),open:[number,number,number][]=[[0,prev,a]];
 cost.set(key(prev<0?nodes.length:prev,a),0);
 while(open.length){
  let k=0;for(let i=1;i<open.length;i++)if(open[i][0]<open[k][0])k=i;
  const [c,p,u]=open.splice(k,1)[0];
  if(u===b&&p!==notFrom&&c>0){const path=[u];let s=key(p<0?nodes.length:p,u);while(came.has(s)){const t=came.get(s)!;path.push(t%nodes.length);s=t;}return path.reverse().filter((n,i,all)=>!i||n!==all[i-1]);}
  for(const n of next[u]){
   if(n===p)continue;
   if(p>=0){const dx=nodes[u][0]-nodes[p][0],dz=nodes[u][2]-nodes[p][2],ex=nodes[n][0]-nodes[u][0],ez=nodes[n][2]-nodes[u][2];if((dx*ex+dz*ez)/((Math.hypot(dx,dz)||1)*(Math.hypot(ex,ez)||1))<-.5)continue;}
   const s=key(u,n),nc=c+flat(nodes[u],nodes[n]);
   if(nc<(cost.get(s)??Infinity)){cost.set(s,nc);came.set(s,key(p<0?nodes.length:p,u));open.push([nc,u,n]);}
  }
 }
}

/**
 * A shuttle: one of the city's cars on a fixed round through `stops` (street points near each place), holding
 * TRAVEL.carStop seconds at each while people get in or out, timed to take exactly one train lap. `first` is when
 * it pulls up at its first stop, in train-clock seconds (mod the lap).
 */
export function planShuttle(scene:Scene3D,id:string,kind:VehicleKind,color:string,places:{name:string;at:Pt3;cost?:(node:Pt3)=>number}[],lap:number,first:number):Shuttle|undefined{
 const graph=drivingGraph(scene);if(!graph)return;
 const {nodes,next,lane}=graph,live=nodes.map((_,i)=>i).filter(i=>next[i].length>0&&Math.abs(nodes[i][1])<1e-6);
 // Drive stop to stop, never leaving a stop back the way the car came in (no U-turn); repeat until the round closes on itself.
 const round=(at:number[])=>{
  let legs:number[][]=[];
  for(let pass=0;pass<4;pass++){
   const out:number[][]=[];
   for(let k=0;k<at.length;k++){const before=k?out[k-1]:legs[at.length-1],prev=before?before[before.length-2]:-1,path=drive(nodes,next,at[k],at[(k+1)%at.length],prev,-2);if(!path)return;out.push(path);}
   const same=out.every((p,k)=>legs[k]?.join()===p.join());legs=out;if(same)break;
  }
  return legs;
 };
 // The kerb for each place: a few nearby street junctions with the shortest walks from the place (cost); of every mix of
 // them, the one with the shortest round plus walks, so the car never has to circle a district to turn round.
 const cands=places.map(p=>{const cost=p.cost??(n=>flat(n,p.at));return [...live].sort((a,b)=>flat(nodes[a],p.at)-flat(nodes[b],p.at)).slice(0,12).map(i=>({i,c:cost(nodes[i])})).filter(x=>Number.isFinite(x.c)).sort((a,b)=>a.c-b.c).slice(0,4);});
 let best:{at:number[];legs:number[][];score:number}|undefined;
 const pick=(k:number,chosen:number[])=>{
  if(k===places.length){if(new Set(chosen).size!==chosen.length)return;const legs=round(chosen);if(!legs)return;
   const score=legs.flat().reduce((n,v,i,all)=>i?n+flat(nodes[all[i-1]],nodes[v]):0,0)+6*chosen.reduce((n,c,j)=>n+cands[j].find(x=>x.i===c)!.c,0);
   if(!best||score<best.score)best={at:[...chosen],legs,score};return;}
  for(const c of cands[k])pick(k+1,[...chosen,c.i]);
 };
 pick(0,[]);if(!best)return;
 const {at,legs}=best;
 const order=legs.flatMap(p=>p.slice(0,-1));
 const raw=loopLegs(order.map(n=>nodes[n]),order.map(n=>next[n].length>=3),order.map((n,i)=>lane(n,order[(i+1)%order.length])),1);
 // A hold at each stop, after the moving leg that ends nearest the stop's node.
 const stopAt=at.map(n=>{let best=-1,d=Infinity;raw.forEach((l,i)=>{if(l.hold)return;const e=Math.hypot(l.b[0]-nodes[n][0],l.b[1]-nodes[n][2]);if(e<d){d=e;best=i;}});return best;});
 if(stopAt.some(i=>i<0)||new Set(stopAt).size!==stopAt.length)return;
 const moving=raw.filter(l=>!l.hold).reduce((n,l)=>n+l.dur,0),holds=raw.filter(l=>l.hold).length*JUNCTION_STOP+at.length*TRAVEL.carStop;
 // One round a train lap, or every second or third lap when one lap would need more than a brisk city speed.
 const laps=[1,2,3].find(n=>moving/(n*lap-holds)<=TRAVEL.carSpeed)??3,period=laps*lap,speed=moving/(period-holds);if(!(speed>.3&&speed<=TRAVEL.carSpeed))return;
 const out:Leg[]=[],times:number[]=[];let t=0;
 raw.forEach((l,i)=>{const leg={...l,dur:l.hold?l.dur:l.dur/speed};out.push(leg);t+=leg.dur;const s=stopAt.indexOf(i);
  if(s>=0){const nxt=raw[(i+1)%raw.length];times[s]=t;out.push({a:l.b,b:nxt.b,ya:l.yb,yb:l.yb,dur:TRAVEL.carStop,hold:true});t+=TRAVEL.carStop;}});
 // vehicleAt(t + offset): at train clock `first` the car is pulling up at stop 0.
 const offset=mod(times[0]-first,period);
 return {plan:{id,kind,color,legs:out,period,offset,scheduled:true},stops:stopAt.map(i=>[raw[i].b[0],0,raw[i].b[1]] as Pt3),names:places.map(p=>p.name),times:times.map(x=>mod(x-offset,period))};
}

// ---------------------------------------------------------------- yacht

/** Laps of the train between the yacht's sailings: she is away TRAVEL.sail seconds and needs time at the berth to board. */
export const yachtLaps=(lap:number)=>Math.ceil((TRAVEL.sail+60)/lap);

/** Corners of the yacht's cruise, relative to the point she side-steps out to (bow east): out to sea and back round. */
const CRUISE:[number,number][]=[[0,0],[8,0],[20,8],[25,22],[14,33],[-4,32],[-14,20],[-11,6],[-4,0],[0,0]];

/**
 * The yacht's cruise from her berth (side-to, bow east): side-step off the pontoon, run east, then a long rounded loop out
 * into the open sea south of the city and back, ending on the same line heading east, and side-step onto the berth.
 * Points every 0.1 with headings.
 */
export function yachtCourse(b:Pick<YachtBerth,'x'|'z'>):{x:number;z:number;yaw:number}[]{
 const z1=b.z+TRAVEL.yachtSideStep,pts:{x:number;z:number;yaw:number}[]=[];
 const line=(x0:number,z0:number,x1:number,z1:number,yaw:number)=>{const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,z1-z0)/.1));for(let i=0;i<n;i++)pts.push({x:x0+(x1-x0)*i/n,z:z0+(z1-z0)*i/n,yaw});};
 // Rounded corners (Chaikin), ends kept: the first and last legs stay straight east.
 let way=CRUISE.map(([x,z]):[number,number]=>[b.x+x,z1+z]);
 for(let k=0;k<4;k++)way=[way[0],...way.slice(0,-1).flatMap((a,i)=>{const c=way[i+1];return [[a[0]*.75+c[0]*.25,a[1]*.75+c[1]*.25],[a[0]*.25+c[0]*.75,a[1]*.25+c[1]*.75]] as [number,number][];}).slice(1,-1),way[way.length-1]];
 line(b.x,b.z,b.x,z1,0);
 // Heading from the direction of travel: yaw = atan2(-dz, dx) (bow east is 0).
 for(let i=0;i<way.length-1;i++){const [x0,z0]=way[i],[x1,z1b]=way[i+1];line(x0,z0,x1,z1b,Math.atan2(-(z1b-z0),x1-x0));}
 line(b.x,z1,b.x,b.z,0);pts.push({x:b.x,z:b.z,yaw:0});
 return pts;
}
/** Where the yacht is `t` seconds after casting off: gathering way and slowing over TRAVEL.sailEase, back at TRAVEL.sail. */
export function yachtPoseAt(course:{x:number;z:number;yaw:number}[],t:number){
 if(t<=0||t>=TRAVEL.sail)return course[course.length-1];
 // Trapezoid speed: distance travelled as a share of the course, smooth at both ends.
 const T=TRAVEL.sail,r=Math.min(TRAVEL.sailEase,T/2),v=1/(T-r),u=t<r?v*t*t/(2*r):t>T-r?1-v*(T-t)*(T-t)/(2*r):v*(t-r/2);
 const f=Math.min(1,Math.max(0,u))*(course.length-1),i=Math.min(course.length-2,Math.floor(f)),k=f-i,a=course[i],b=course[i+1];
 const dyaw=Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw));
 return {x:a.x+(b.x-a.x)*k,z:a.z+(b.z-a.z)*k,yaw:a.yaw+dyaw*k};
}
/** Seconds since the yacht last cast off, on the train clock; she is away while this is under TRAVEL.sail. */
export function yachtSailing(p:Pick<TravelPlan,'lap'|'yacht'>,seconds:number){return p.yacht?mod(seconds-p.yacht.depart,p.yacht.period):Infinity;}

// ---------------------------------------------------------------- travellers

class Timeline{
 t:number;segs:TravelSeg[]=[];rides:Traveller['rides']=[];start:number;
 constructor(t:number,readonly pace:number,private lane:number){this.t=t;this.start=t;}
 /** Seconds this person takes to walk a route. */
 time(points:Point3[]){return commuterRoute(points).length/this.pace;}
 walk(points:Point3[],y:TravelSeg['y']='stair'){const route=commuterRoute(points),d=route.length/this.pace;this.segs.push({t0:this.t,t1:this.t+d,route,d0:0,pace:this.pace,lane:this.lane,y});this.t+=d;return this;}
 /** Stand at the end of the last walk until `until` (waiting at a curb or on a platform). */
 wait(until:number){const last=this.segs[this.segs.length-1];if(until>this.t&&last)this.segs.push({t0:this.t,t1:until,route:last.route,d0:last.route.length,pace:0,lane:last.lane,y:last.y});this.t=Math.max(this.t,until);return this;}
 hide(until:number,kind:Riding){if(until>this.t)this.rides.push({t0:this.t,t1:until,kind});this.t=Math.max(this.t,until);return this;}
}
/** The next time at or after `t` that is `phase` on a clock repeating every `lap` seconds. */
const nextAt=(t:number,phase:number,lap:number)=>t+mod(phase-t,lap);

interface Journey {id:string;people:number;cars?:(Shuttle|undefined)[];build:(tl:Timeline,k:number)=>Timeline|undefined|null|false|''}

/**
 * The whole travel picture for a scene: three shuttles, the yacht's sailing time and every traveller's timeline.
 * Undefined when the map has no perimeter train or the places it needs (other groupings).
 */
export function planTravel(scene:Scene3D):TravelPlan|undefined{
 const loop:PerimeterRailPlan|undefined=scene.communityRail?.loop,f=scene.financial,stadium=scene.stadium,airport=scene.airport,galleria=scene.galleria;
 if(!loop||!f||!stadium||!airport||!galleria)return;
 const lap=loop.period,dwell=PERIMETER_RAIL.dwell,stop=(id:string)=>loop.stops.findIndex(s=>s.id===id);
 const fin=stop(STATION.financial),hub=stop(STATION.hub),arena=stop(STATION.arena);if(fin<0||hub<0||arena<0)return;
 const home=f.buildings.find(b=>b.id===HOME_ID&&b.approach.length>1);if(!home)return;
 const g=buildStreetGraph(streetLines(scene));
 const door:Point3[]=home.approach.map(p=>[p[0],0,p[1]]),homeKerb=door[door.length-1];
 const [gx,gz]=stadiumGate(stadium),gate:Point3=[gx,0,gz];
 const front=airportPoint(airport,-.7,6),terminal:Point3=[front[0],0,front[1]];
 const vendor:Point3=[galleria.entrance.x,0,galleria.entrance.z];
 const marina=marinaSite(scene,TERRACE_H),berth=yachtBerth(marina);
 // Station walks run street → platform door; reversed they lead off the train.
 const toTrain=(i:number)=>loop.stops[i].walk,offTrain=(i:number)=>[...loop.stops[i].walk].reverse();
 // Events Arena Station's forecourt walk runs on along the shore to the marina stair (scene.ts), then the yacht's own way aboard.
 const plaza=scene.stationPlaza,marinaTop:Point3=[marina.x,0,marina.cityWalkZ];
 const ground=(i:number)=>toTrain(i).filter((p,j,all)=>p[1]===0&&(!j||flat(p,all[j-1])>1e-6));
 const stairFoot=(i:number)=>{const off=offTrain(i);return off.slice(0,off.findIndex(p=>p[1]===0)+1);};
 const yachtWalk=((): Point3[]|undefined=>{
  if(!plaza)return;const w=plaza.walk,west=ground(arena)[ground(arena).length-1],shore=w[1];
  if(Math.hypot(w[w.length-1][0]-west[0],w[w.length-1][1]-west[2])>.05)return;
  const aboard=boardingRoute(marina,berth).map(([x,y,z]):Point3=>[x,y-TERRACE_H,z]);
  return [west,[west[0],0,shore[1]],[marina.x,0,shore[1]],marinaTop,...aboard.slice(1)];
 })();
 /** Board the train at stop `from` in its dwell that opens at or after `t` - dwell; alight at `to`. */
 const train=(from:number,to:number,t:number,k:number)=>{const open=nextAt(t-dwell+TRAVEL.boardBy,loop.stops[from].arrival,lap),leave=open+dwell;
  return {alight:leave+mod(loop.stops[to].arrival-loop.stops[from].arrival,lap)-dwell+1.6+k*.6};};
 const arrivalAt=(i:number)=>loop.stops[i].arrival,walkTime=(p:Point3[])=>commuterRoute(p).length/TRAVEL.pace;
 const walkCost=(from:Point3)=>(n:Pt3)=>{const w=streetWalk(g,from,n);return w?commuterRoute(w).length:Infinity;};
 /** Shift a shuttle's round so it pulls up at stop `i` at `at` on the lap clock. */
 const retime=(s:Shuttle|undefined,i:number,at:number)=>{if(!s)return;const shift=at-s.times[i],n=s.plan.period;s.times=s.times.map(t=>mod(t+shift,n));s.plan.offset=mod(s.plan.offset-shift,n);};

 // Shuttles: three of the city's cars. Times they pull up at their first stop are chosen to meet the train.
 const arenaOff=offTrain(arena),taxiFirst=arrivalAt(arena)+1.2+walkTime(arenaOff)+5;
 // Taxi: Events Arena Station → airport terminal → back, meeting the train from Financial District Station.
 const taxi=planShuttle(scene,'travel:taxi','taxi','#edbd35',[{name:'Events Arena Station',at:arenaOff[arenaOff.length-1],cost:walkCost(arenaOff[arenaOff.length-1])},{name:'Airport terminal',at:terminal,cost:walkCost(terminal)}],lap,taxiFirst);
 // People mover from Team Residence Towers: the airport terminal, then Events Arena Station (arena and yacht).
 // It reaches Events Arena Station as the train does, so its yacht guests and the train's board together.
 const van=planShuttle(scene,'travel:van','van','#ece3cc',[{name:'Team Residence Towers',at:homeKerb,cost:walkCost(homeKerb)},{name:'Airport terminal',at:terminal,cost:walkCost(terminal)},{name:'Events Arena Station',at:gate,cost:walkCost(gate)}],lap,0);
 retime(van,2,arrivalAt(arena)+4);const vanFirst=van?.times[0]??0;
 // Car from Team Residence Towers to the Vendor & Supplier Hub and back, half a lap after the van.
 const car=planShuttle(scene,'travel:car','sedan','#c5ced6',[{name:'Team Residence Towers',at:homeKerb,cost:walkCost(homeKerb)},{name:'Vendor & Supplier Hub',at:vendor,cost:walkCost(vendor)}],lap,mod(vanFirst+lap/2,lap));
 const shuttles=[taxi,van,car].filter((s):s is Shuttle=>!!s);

 /** Walk (after `prefix`) to a shuttle's stop, get in as it pulls up, ride to stop `to`. First leg of a trip: leave just in time. */
 const carRide=(tl:Timeline,s:Shuttle|undefined,from:number,to:number,prefix:Point3[],k:number)=>{
  if(!s)return;const tail=streetWalk(g,prefix[prefix.length-1],s.stops[from]);if(!tail)return;
  const route=[...prefix,...tail.slice(1)],walk=tl.time(route);
  let pull:number;
  if(!tl.segs.length){pull=s.times[from];tl.t=tl.start=pull-walk-.4-k*.3;}
  else pull=nextAt(tl.t+walk+.3,s.times[from],s.plan.period);
  tl.walk(route).wait(pull+.6+k*.4).hide(nextAt(pull,s.times[to],s.plan.period)+.8+k*.5,'car');
  return s.stops[to];
 };
 const trainRide=(tl:Timeline,to:number,k:number)=>{
  const walk=streetWalk(g,homeKerb,toTrain(fin)[0]);if(!walk)return;
  const route=[...door,...walk.slice(1),...toTrain(fin).slice(1)];
  // Reach the train doors a little after they open: leave home in time for this lap's departure.
  tl.t=tl.start=arrivalAt(fin)+2+k*1.1-tl.time(route);tl.walk(route);tl.hide(train(fin,to,tl.t,k).alight,'train');return true;
 };
 const yachtArrivals:number[]=[];
 const aboardYacht=(tl:Timeline,path:Point3[])=>{if(!yachtWalk)return;tl.walk([...path,...yachtWalk.slice(1)],'absolute');yachtArrivals.push(tl.t);return tl;};
 const journeys:Journey[]=[
  // By train to the Vendor & Supplier Hub (Workflow Automation Hub stop), then a short walk in.
  {id:'train-vendor',people:2,build:(tl,k)=>{if(!trainRide(tl,hub,k))return;const off=offTrain(hub),w=streetWalk(g,off[off.length-1],vendor);return w&&tl.walk([...off,...w.slice(1)]);}},
  // By train to Events Arena Station, down the stair, along the forecourt and the marina, aboard the yacht before she sails.
  {id:'train-yacht',people:4,build:(tl,k)=>trainRide(tl,arena,k)?aboardYacht(tl,stairFoot(arena)):undefined},
  // By train to Events Arena Station, then the taxi to the airport terminal; inside, they board their flight.
  {id:'train-airport',cars:[taxi],people:2,build:(tl,k)=>{if(!trainRide(tl,arena,k))return;const end=carRide(tl,taxi,0,1,arenaOff,k),w=end&&streetWalk(g,end,terminal);return w&&tl.walk(w);}},
  // By car from Team Residence Towers to the arena gate.
  {id:'car-arena',cars:[van],people:2,build:(tl,k)=>{const end=carRide(tl,van,0,2,door,k),w=end&&streetWalk(g,end,gate);return w&&tl.walk(w);}},
  // By car to Events Arena Station, then past the gate and the station on foot to the yacht.
  {id:'car-yacht',cars:[van],people:2,build:(tl,k)=>{const end=carRide(tl,van,0,2,door,k),w=end&&streetWalk(g,end,gate);return w?aboardYacht(tl,[...w,...ground(arena).slice(1)]):undefined;}},
  // By car to the airport terminal.
  {id:'car-airport',cars:[van],people:2,build:(tl,k)=>{const end=carRide(tl,van,0,1,door,k),w=end&&streetWalk(g,end,terminal);return w&&tl.walk(w);}},
  // By car to the Vendor & Supplier Hub.
  {id:'car-vendor',cars:[car],people:4,build:(tl,k)=>{const end=carRide(tl,car,0,1,door,k),w=end&&streetWalk(g,end,vendor);return w&&tl.walk(w);}},
 ];
 const travellers:Traveller[]=[],sailLaps=yachtLaps(lap);
 for(const j of journeys)for(let i=0;i<j.people;i++){
  // People take turns on the laps their cars run (every lap for the train): a person's own loop is the fewest laps
  // that holds their whole trip and fits their car's round, and the journey's people start on different laps.
  // Yacht guests keep to her sailings: their loops and lap offsets are whole numbers of her sailing period.
  const carLaps=Math.max(1,...(j.cars??[]).map(c=>Math.round((c?.plan.period??lap)/lap))),unit=j.id.endsWith('-yacht')?lcm(carLaps,sailLaps):carLaps;
  const k=Math.floor(i/2),pace=TRAVEL.pace+((i*3)%5-2)*.02,tl=new Timeline(0,pace,TRAVEL.lane+((i%3)-1)*.05);
  const built=j.build(tl,k);if(!built||!built.segs.length)continue;
  const t0=Math.min(...built.segs.map(s=>s.t0)),t1=Math.max(...built.segs.map(s=>s.t1));
  const laps=unit*Math.ceil(Math.max(2,Math.ceil((t1-t0+10)/lap))/unit),slots=laps/unit,group=i%slots;
  travellers.push({id:`travel:${j.id}:${i}`,journey:j.id,group,period:laps*lap,offset:group*unit*lap,segs:built.segs,rides:built.rides,span:[t0,t1]});
 }
 // The yacht casts off once the last guest is aboard: the arrival before the longest quiet spell in her sailing period.
 // She is back TRAVEL.sail seconds later.
 const period=sailLaps*lap;
 const yacht=yachtArrivals.length?(()=>{const at=yachtArrivals.map(t=>mod(t,period)).sort((a,b)=>a-b);let last=at[at.length-1],gap=at[0]+period-last;
  for(let i=1;i<at.length;i++)if(at[i]-at[i-1]>gap){gap=at[i]-at[i-1];last=at[i-1];}
  const depart=mod(last+TRAVEL.sailLead,period);return {berth,depart,back:mod(depart+TRAVEL.sail,period),period};})():undefined;
 return {lap,travellers,shuttles,yacht};
}

const cache=new WeakMap<Scene3D,TravelPlan|null>();
/** planTravel, once per scene (the train, the cars and the yacht all read the same plan). */
export function travelPlan(scene:Scene3D):TravelPlan|undefined{
 if(!cache.has(scene))cache.set(scene,planTravel(scene)??null);
 return cache.get(scene)??undefined;
}

/** Where a traveller is on the train clock: walking or standing (visible), or aboard / inside (hidden). */
export function travellerAt(p:Traveller,seconds:number):TravellerState{
 const base=mod(seconds-p.offset,p.period);
 for(const t of [base,base-p.period,base+p.period]){
  if(t<p.span[0]||t>=p.span[1])continue;
  for(const s of p.segs)if(t>=s.t0&&t<s.t1){const q=along(s.route,s.d0+(t-s.t0)*s.pace,s.lane);return {visible:true,...q,absolute:s.y==='absolute'};}
  for(const r of p.rides)if(t>=r.t0&&t<r.t1)return {visible:false,riding:r.kind};
 }
 return {visible:false};
}
