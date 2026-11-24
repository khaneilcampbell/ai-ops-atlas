import {CAMPUS,CAMPUS_NAME,wingBars,type WingBar,type WingId} from '../map3d/creativeCampusPlan';

/**
 * Atlas Creative Campus interior. Interior units are the map building at the cutaway scale CityOutside
 * uses (4 interior units per map unit), origin at the atrium's centre, so every wing, the atrium and
 * the floors line up with the building seen from outside (creativeCampusPlan.ts).
 *
 * Arrangement after the reference: a tall round atrium open to a triangulated skylight, with red stair
 * flights crossing it between floors and red balustrade bands round each gallery. Each wing has a
 * corridor along one long side and studios along the other, and its leaning red end block is a lab.
 * Khaneil chose empty desks for now (2026-11-24): every studio has open desks and no agent is seated.
 */
export const CAMPUS_OFFICE_ID=`skyline-business:${CAMPUS_NAME}`;
const S=4;
export const CAMPUS_INTERIOR={
 scale:S,levels:CAMPUS.storeys,storey:CAMPUS.storey*S,slab:.25,
 /** The void and the gallery ring round it. */
 atrium:{r:CAMPUS.atrium.r*S,gallery:3},
 corridor:2.4,
 /** Ground storey pulled in on both long faces (the pilotis). */
 groundInset:CAMPUS.pilotis.inset*S,
 endBlock:CAMPUS.endBlock.length*S,
 stair:{width:1.5,steps:12},
} as const;
const A=CAMPUS_INTERIOR.atrium;
export const RING_R=A.r+A.gallery;

/** The wing bars in interior units, about the atrium's centre. */
export const CAMPUS_BARS:WingBar[]=wingBars([0,0]).map(b=>({...b,a:[b.a[0]*S,b.a[1]*S],b:[b.b[0]*S,b.b[1]*S],length:b.length*S,width:b.width*S}));

export type CampusRoomKind='reception'|'cafe'|'gallery'|'hall'|'archive'|'shop'|'workshop'|'lab'|'studio'|'critique'|'lounge';
export interface CampusRoom{id:string;level:number;name:string;kind:CampusRoomKind;wing:WingId;
 /** Bar index within the wing, and the room's span along the bar from its start (s) and across it (v, + to the left of travel). */
 bar:number;s0:number;s1:number;v0:number;v1:number;
 /** Plan centre, size along and across the bar, and yaw for three.js (rotation about y). */
 x:number;z:number;w:number;d:number;yaw:number;
 role:string;purpose:string;desks:number}

const WING_LABEL:Record<WingId,string>={west:'Design',east:'Media',south:'Making'};
/** Distance along a bar where it clears the atrium's gallery ring. */
const clearOfRing=(b:WingBar)=>{const t0=Math.hypot(b.a[0],b.a[1]),hw=b.width/2;return Math.max(0,Math.sqrt(Math.max(0,RING_R*RING_R-hw*hw))-t0-.2);};

/** Rooms the ground floor holds, per bar (wing:index), in order out from the atrium; the last of a final bar is its end block. */
const GROUND:Record<string,[string,CampusRoomKind,string][]>={
 'west:0':[['Café','cafe','Coffee and long tables under the Design wing.'],['Exhibition gallery','gallery','Work on show from every studio.'],['Print room','workshop','Large-format printers and cutting tables.'],['Project gallery','gallery','The red end block: large pieces under its leaning glass.']],
 'east:0':[['Lecture hall','hall','Talks and reviews for about 80 people.'],['Material library','archive','Samples, books and print references.'],['Screening room','hall','Projection for films and motion work.'],['Media lab','lab','The red end block: screens and editing benches.']],
 'south:0':[['Supplies shop','shop','Paper, tools and printing for the studios.'],['Workshop','workshop','Benches and tools for building models.']],
 'south:1':[['Model workshop','workshop','Large benches beside the courtyard.'],['Fabrication lab','lab','The red end block: cutters and printers.']],
};
const END_LAB:Record<WingId,string>={west:'Concept lab',east:'Motion lab',south:'Prototype lab'};

function rooms():CampusRoom[]{
 const C=CAMPUS_INTERIOR,out:CampusRoom[]=[];
 for(let level=0;level<C.levels;level++)for(const b of CAMPUS_BARS){
  // Upstairs a corridor runs along one long side; the ground floor's rooms fill the pulled-in storey.
  const hw=b.width/2,v0=level===0?-hw+C.groundInset+.2:-hw+C.corridor,v1=level===0?hw-C.groundInset-.2:hw-.2;
  const start=clearOfRing(b),endBlock=b.last?C.endBlock:0,stop=b.length-endBlock;
  const n=Math.max(1,Math.round((stop-start)/7.5));
  const spans:[number,number][]=Array.from({length:n},(_,i)=>[start+(stop-start)*i/n,start+(stop-start)*(i+1)/n]);
  if(b.last)spans.push([stop,b.length-.2]);
  const g=GROUND[`${b.wing}:${b.index}`];
  spans.forEach(([s0,s1],i)=>{
   const end=b.last&&i===spans.length-1,label=WING_LABEL[b.wing];
   let name:string,kind:CampusRoomKind,purpose:string,desks:number;
   if(level===0){[name,kind,purpose]=end?g[g.length-1]:g[Math.min(i,g.length-(b.last?2:1))];desks=0;}
   else if(end){name=END_LAB[b.wing];kind='lab';purpose=`The red end block of the ${label} wing, under its leaning glass. Open desks, no agent assigned yet.`;desks=4;}
   else if(level===4&&i===0){name=`${label} lounge`;kind='lounge';purpose='Seating by the atrium gallery, under the skylight.';desks=0;}
   else if((level+i+b.index)%3===2){name=`${label} critique room`;kind='critique';purpose='Pin-up walls and a long table for reviews.';desks=0;}
   else {name=`${label} studio`;kind='studio';purpose='Open desks, no agent assigned yet.';desks=Math.max(2,Math.floor((s1-s0)/2.2))*2;}
   const sm=(s0+s1)/2,vm=(v0+v1)/2,x=b.a[0]+b.dir[0]*sm-b.dir[1]*vm,z=b.a[1]+b.dir[1]*sm+b.dir[0]*vm;
   const id=`${level}-${b.wing}${out.filter(o=>o.level===level&&o.wing===b.wing).length+1}`;
   out.push({id,level,name,kind,wing:b.wing,bar:b.index,s0,s1,v0,v1,x,z,w:s1-s0,d:v1-v0,yaw:-Math.atan2(b.dir[1],b.dir[0]),
    role:level===0?'Campus Host':`${label} studio lead`,purpose,desks});
  });
 }
 // Reception in the atrium.
 out.push({id:'0-reception',level:0,name:'Reception',kind:'reception',wing:'south',bar:-1,s0:0,s1:0,v0:0,v1:0,x:0,z:0,w:4,d:4,yaw:0,role:'Campus Host',purpose:'Welcomes visitors under the atrium skylight.',desks:0});
 return out;
}
export const CAMPUS_ROOMS=rooms();
/** Rooms an agent can be given a desk in: the upstairs rooms with desks (catalog/workplaces.ts lists the same ids). */
export const CAMPUS_DESK_ROOMS=CAMPUS_ROOMS.filter(r=>r.level>=1&&r.desks>0);
export const CAMPUS_FLOORS=['Lobby, galleries & workshops','Studios','Studios','Studios','Studios & lounges'] as const;
export const CAMPUS_OWNER='Creative Director';
export const campusBar=(r:Pick<CampusRoom,'wing'|'bar'>)=>CAMPUS_BARS.find(b=>b.wing===r.wing&&b.index===r.bar);

/** Plan point of a bar-local (s along, v across) coordinate. */
export const barPoint=(b:WingBar,s:number,v:number):[number,number]=>[b.a[0]+b.dir[0]*s-b.dir[1]*v,b.a[1]+b.dir[1]*s+b.dir[0]*v];

export interface CampusDesk{x:number;z:number;yaw:number}
/**
 * A room's desks, in two rows facing each other across its middle, each with the standard chair on the
 * corridor or window side. Pure; interior units; yaw so the seated figure faces the desk.
 */
export function campusDesks(r:CampusRoom):CampusDesk[]{
 const b=campusBar(r);if(!b||!r.desks)return [];
 const per=r.desks/2,vm=(r.v0+r.v1)/2,out:CampusDesk[]=[];
 for(let i=0;i<per;i++){const s=r.s0+(r.s1-r.s0)*(i+.5)/per;
  for(const k of [-1,1]){const [x,z]=barPoint(b,s,vm+k*.75);out.push({x,z,yaw:r.yaw+(k>0?0:Math.PI)+Math.PI/2});}}
 return out;
}

/**
 * One red stair flight across the atrium, from `level` to the next: a straight run through the void
 * from one side of the gallery ring to the other. Each floor's flight turns by 60 degrees, so the
 * flights cross one another as they climb, as in the reference's atrium.
 */
export function flightAngle(level:number){return Math.PI*.18+level*Math.PI/3;}
export function campusFlight(level:number){
 const {steps}=CAMPUS_INTERIOR.stair,H=CAMPUS_INTERIOR.storey,a=flightAngle(level),run=(A.r+.6)*2,rise=H/steps;
 return Array.from({length:steps},(_,i)=>{const t=-run/2+run*(i+.5)/steps;return {x:Math.cos(a)*t,z:Math.sin(a)*t,y:level*H+rise*(i+1),yaw:-a};});
}
/** The two ends of a flight on the gallery ring: where it leaves `level` and where it reaches the floor above. */
export function flightEnds(level:number){const a=flightAngle(level),r=A.r+.6;return {from:[-Math.cos(a)*r,-Math.sin(a)*r] as [number,number],to:[Math.cos(a)*r,Math.sin(a)*r] as [number,number]};}
/** Plaza entrance on the atrium's ground floor, between the east and south wings. */
export const ENTRANCE_ANGLE=(()=>{const e=CAMPUS.wings.find(w=>w.id==='east')!.segments[0].heading,s=CAMPUS.wings.find(w=>w.id==='south')!.segments[0].heading;return (e+s)/2*Math.PI/180;})();
