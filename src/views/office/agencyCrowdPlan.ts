import {AGENCY_ROOMS,EAST_EDGE,INTERIOR,SLOT_DOOR_Z,WEST_EDGE,around,entranceX,flight,flightEnd,landing,rim,slotX,type AgencyRoom,type P3} from './agencyInteriorPlan';

/**
 * People in the Benjaire Marketing Agency (KC, 2026-10-31): scripted, looping movement, no AI and
 * no model calls. Every person is a closed path of points with a pause at each, so a pose is a
 * pure function of time: nothing is simulated, stored or sent anywhere. Desk workers and the hall
 * audience sit, visitors wander, a few people use the stair, and a presenter paces the stage.
 * They are illustrations of planned roles, not running agents.
 */
export type CrowdPose='walk'|'stand'|'sit'|'present';
export interface CrowdPerson{
 id:string;level:number;color:string;pose:CrowdPose;
 /** Path in interior units, y relative to this person's floor. One point means standing still. */
 path:P3[];
 /** Seconds paused at each point (same length as path). */
 dwell:number[];
 /** Walking speed in interior units per second, and a time offset so loops don't move in step. */
 speed:number;phase:number;
}
export interface Pose{x:number;y:number;z:number;yaw:number;moving:boolean}

const S=INTERIOR.storey,a=INTERIOR.atrium,D=INTERIOR.depth/2;
const SHIRTS=['#4f6b5d','#7a4b3a','#5d7a8c','#a1674a','#2f4a3a','#8c6a52','#3f5f86','#8c3b52','#6b6f4f','#b07a4a'];
const shirt=(i:number)=>SHIRTS[(i*7+3)%SHIRTS.length];
const flat=(p:P3,level:number):P3=>[p[0],p[1]-level*S,p[2]];
const centre=(r:AgencyRoom,dx=0,dz=0):P3=>[r.x+r.w/2+dx,0,r.z+r.d/2+dz];
const room=(level:number,id:string)=>AGENCY_ROOMS.find(r=>r.id===`${level}-${id}`)!;
/** Out and back along the same points, pausing at the far end and at home. */
const there=(pts:P3[],farDwell:number,homeDwell:number)=>{const back=pts.slice(1,-1).reverse();return {path:[...pts,...back],dwell:[homeDwell,...pts.slice(1,-1).map(()=>.3),farDwell,...back.map(()=>.3)]};};
/** Through the slot's doorway, from the east block to a point in the west block. */
const viaDoor=(to:P3):P3[]=>[[EAST_EDGE+.6,0,SLOT_DOOR_Z],[slotX(SLOT_DOOR_Z),0,SLOT_DOOR_Z],[WEST_EDGE-.6,0,SLOT_DOOR_Z],to];

/** Seat positions in the presentation hall, shared by the furniture and the audience. */
export function hallSeats(r:AgencyRoom):[number,number][]{
 const out:[number,number][]=[],cx=r.x+r.w/2;
 for(let pz=r.z+4.4;pz<r.z+r.d-.6;pz+=1.1){if(Math.abs(pz-SLOT_DOOR_Z)<.9)continue;
  for(let px=r.x+.8;px<r.x+r.w-.6;px+=.66){if(Math.abs(px-cx)<.55)continue;out.push([px,pz]);}}
 return out;
}

export function agencyCrowd():CrowdPerson[]{
 const people:CrowdPerson[]=[];let n=0;
 const add=(level:number,pose:CrowdPose,path:P3[],dwell:number[],speed=.75)=>{people.push({id:`${level}-${n}`,level,color:shirt(n),pose,path,dwell,speed,phase:(n*3.7)%11});n++;};
 const still=(level:number,pose:CrowdPose,p:P3)=>add(level,pose,[p],[1]);
 const ring=(level:number,from:number,to:number)=>around(level,from,to).map(p=>flat(p,level));
 // Seated workers and standing visitors placed by room.
 for(const r of AGENCY_ROOMS){
  const c=centre(r);
  switch(r.kind){
   case 'desk':case 'lab':for(const [dx,dz] of [[-1,-1.1],[1,.6],[-1,2.3]])if(Math.abs(dz)<r.d/2-.8)still(r.level,'sit',[c[0]+dx,0,c[2]+dz+.75]);break;
   case 'meeting':for(const k of [-.8,.8])still(r.level,'sit',[c[0]+k,0,c[2]+1.05]);still(r.level,'stand',[c[0],0,r.z+.9]);break;
   case 'studio':still(r.level,'stand',[r.x+3,0,c[2]]);still(r.level,'sit',[r.x+r.w-1.4,0,c[2]+1]);break;
   case 'archive':still(r.level,'sit',[c[0],0,r.z+r.d-.6]);break;
   case 'cafe':still(r.level,'stand',[r.x+1.4,0,c[2]]);for(const dz of [-1.5,1.5])still(r.level,'sit',[c[0]+1.2,0,c[2]+dz]);break;
   case 'lounge':still(r.level,'sit',[c[0]-1.4,0,c[2]+.6]);break;
   case 'green-room':still(r.level,'stand',[c[0],0,r.z+1.8]);break;
   case 'reception':still(r.level,'stand',[a.x,0,a.z-.6]);break;
  }
 }
 // Lobby: a visitor in from the doors to reception and on to the café, a lounge wanderer, a shop browser.
 const ex=entranceX(),desk:P3=[a.x,0,a.z+a.r+.6],cafe=room(0,'cafe'),shop=room(0,'shop'),lobby=room(0,'lobby');
 {const t=there([[ex,0,D-1.2],desk,...viaDoor(centre(cafe,1.5,0))],7,4);add(0,'walk',t.path,t.dwell);}
 {const t=there([[ex+1,0,D-1.6],desk,[EAST_EDGE+.6,0,SLOT_DOOR_Z],...viaDoor(centre(shop,0,1)).slice(1)],6,5);add(0,'walk',t.path,t.dwell,.65);}
 add(0,'walk',[centre(lobby,-2,-1),centre(lobby,1.5,-1.2),centre(lobby,2.4,1.4),centre(lobby,-1.2,1.6)],[3,1,4,1],.55);
 // Upper floors: people circling the atrium, visiting rooms, crossing to the west block, using the stair.
 for(const level of [1,2,3]){
  const lv=level;
  // A full lap of the atrium rim, pausing now and then at the balustrade.
  const lap=Array.from({length:16},(_,k)=>flat(rim(lv,(lv%2?-1:1)*k/16*Math.PI*2+lv),lv));
  add(lv,'walk',lap,lap.map((_,i)=>i%5===0?2.5:0),.7);
  const east=AGENCY_ROOMS.filter(r=>r.level===lv&&r.x>=EAST_EDGE-1e-6&&r.kind!=='hall');
  for(const [i,r] of east.entries()){const ang=Math.atan2(r.z+r.d/2-a.z,r.x+r.w/2-a.x),start=flightEnd(lv-1)+(i?Math.PI:0);
   const t=there([...ring(lv,start,ang),centre(r,i?-1:1,0)],6+i*2,3);add(lv,'walk',t.path,t.dwell,.8);}
  const west=AGENCY_ROOMS.filter(r=>r.level===lv&&r.x+r.w<=WEST_EDGE+1e-6&&r.kind!=='hall');
  for(const r of west.slice(0,1)){const t=there([flat(rim(lv,Math.PI*.85),lv),...viaDoor(centre(r,0,0))],8,3);add(lv,'walk',t.path,t.dwell,.75);}
 }
 // Stair traffic: up a flight and back down, pausing at each end.
 for(let level=0;level<a.openTo;level++){const up=flight(level).map(p=>flat(p,level)),top=flat(landing(level),level);
  add(level,'walk',[...up,top,...[...up].reverse()],[...up.map((_,i)=>i===0?5:0),3,...up.map(()=>0)],.55);}
 // Presentation hall: an audience in most seats and a presenter pacing the stage.
 const hall=AGENCY_ROOMS.find(r=>r.kind==='hall')!,seats=hallSeats(hall);
 seats.forEach(([x,z],i)=>{if((i*37)%10<7)still(hall.level,'sit',[x,0,z]);});
 const hx=hall.x+hall.w/2,sz=hall.z+2.2;
 add(hall.level,'present',[[hx-2.1,.5,sz],[hx,.5,sz+.3],[hx+2.1,.5,sz],[hx,.5,sz+.3]],[3.5,1.5,3.5,1.5],.45);
 // Floor 3 foyer: guests arriving from the stair and drifting toward the hall door.
 {const t=there([flat(rim(3,flightEnd(2)),3),...ring(3,flightEnd(2),Math.PI*.95).slice(1),[EAST_EDGE+.6,0,SLOT_DOOR_Z]],5,4);add(3,'walk',t.path,t.dwell,.7);}
 return people;
}

/** Where a person is at time t (seconds). Pure: the same t always gives the same pose. */
export function poseAt(p:CrowdPerson,t:number):Pose{
 const pts=p.path;if(pts.length===1)return {x:pts[0][0],y:pts[0][1],z:pts[0][2],yaw:0,moving:false};
 const legs=pts.map((q,i)=>{const r=pts[(i+1)%pts.length];return Math.hypot(r[0]-q[0],r[2]-q[2],(r[1]-q[1])*1.5)/p.speed;});
 const cycle=legs.reduce((s,l)=>s+l,0)+p.dwell.reduce((s,d)=>s+d,0);let u=((t+p.phase)%cycle+cycle)%cycle;
 for(let i=0;i<pts.length;i++){const q=pts[i],r=pts[(i+1)%pts.length],yaw=Math.atan2(r[0]-q[0],r[2]-q[2]);
  if(u<p.dwell[i])return {x:q[0],y:q[1],z:q[2],yaw,moving:false};u-=p.dwell[i];
  if(u<legs[i]){const k=u/(legs[i]||1),e=k*k*(3-2*k)*.35+k*.65;return {x:q[0]+(r[0]-q[0])*e,y:q[1]+(r[1]-q[1])*e,z:q[2]+(r[2]-q[2])*e,yaw,moving:true};}
  u-=legs[i];}
 return {x:pts[0][0],y:pts[0][1],z:pts[0][2],yaw:0,moving:false};
}
