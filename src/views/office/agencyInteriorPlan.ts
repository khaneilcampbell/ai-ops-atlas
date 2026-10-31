import {AGENCY,AGENCY_NAME,cutAt,sweepSpan} from '../map3d/marketingAgencyPlan';

/**
 * Benjaire Marketing Agency interior (phase 2, KC approved the exterior 2026-10-31). Interior units
 * are the map building at the cutaway scale used by CityOutside (4 interior units per map unit),
 * so the floors line up with the city seen outside: 38.4 by 19.2, origin at the building centre,
 * x east along the long side, z south toward the plaza and the copper sweep.
 *
 * Arrangement after the reference plans: offices and studios in the west block, the diagonal
 * glazed slot as a light street, and in the east block a round atrium with a curved stair rising
 * through the galleries, the café and lobby on the plaza side, and a large hall on top.
 */
export const AGENCY_OFFICE_ID=`skyline-business:${AGENCY_NAME}`;
export const INTERIOR={
 scale:4,storey:AGENCY.storey*4,levels:4,slab:.3,
 width:AGENCY.length*4,depth:AGENCY.depth*4,
 /** Atrium: the void runs from the lobby up through floor 3, so the stair climbs every storey. */
 atrium:{x:(AGENCY.length*.7-AGENCY.length/2)*4,z:-.6,r:4.1,openTo:3},
 /** The curved stair hugs the atrium's west edge, one flight per storey. */
 stair:{radius:3.35,width:1.15,from:Math.PI*.55,sweep:Math.PI*.95,steps:22},
 lift:{x:2.2,z:-7.6,w:2.2,d:2.4},
} as const;

export type RoomKind='reception'|'lounge'|'cafe'|'shop'|'studio'|'desk'|'meeting'|'gallery'|'archive'|'lab'|'hall'|'green-room'|'services';
export interface AgencyRoom {id:string;level:number;name:string;kind:RoomKind;x:number;z:number;w:number;d:number;
 /** The planned agent role for the room. None of these run yet. */
 role:string;purpose:string}

/** Interior x of the slot's centre line at an interior z. */
export const slotX=(z:number)=>(cutAt(z/INTERIOR.scale+AGENCY.depth/2)-AGENCY.length/2)*INTERIOR.scale;
export const SLOT_HALF=AGENCY.cutW/2*INTERIOR.scale;
/** Where the plaza entrance meets the front, under the copper sweep. */
export function entranceX(){const [u0,u1]=sweepSpan();return (u0+(u1-u0)*.42-AGENCY.length/2)*INTERIOR.scale;}

const W=INTERIOR.width/2,D=INTERIOR.depth/2;
/** West block's inner edge (clear of the slot at every depth) and east block's, with a 0.4 margin. */
export const WEST_EDGE=Math.min(slotX(-D),slotX(D))-SLOT_HALF-.4;
export const EAST_EDGE=Math.max(slotX(-D),slotX(D))+SLOT_HALF+.4;

const room=(level:number,id:string,name:string,kind:RoomKind,x0:number,z0:number,x1:number,z1:number,role:string,purpose:string):AgencyRoom=>({id:`${level}-${id}`,level,name,kind,x:x0,z:z0,w:x1-x0,d:z1-z0,role,purpose});
const wx0=-W+.4,wx1=WEST_EDGE,ex1=W-.4,n0=-D+.4,s1=D-.4;

export const AGENCY_ROOMS:AgencyRoom[]=[
 // Lobby: reception in the atrium, the café and the brand shop on the plaza.
 room(0,'reception','Reception','reception',INTERIOR.atrium.x-1.9,INTERIOR.atrium.z-1.9,INTERIOR.atrium.x+1.9,INTERIOR.atrium.z+1.9,'Client Concierge','Welcomes visitors and books client meetings. Planned.'),
 room(0,'lobby','Lobby','lounge',EAST_EDGE,4.2,ex1-5.2,s1,'Client Concierge','Seating under the copper sweep, facing the reflecting pools.'),
 room(0,'cafe','Café','cafe',wx0,1.2,wx1,s1,'Café & Events Host','Coffee bar and tables on the plaza side.'),
 room(0,'shop','Brand shop','shop',wx0,n0,wx1,-1.2,'Merchandise Coordinator','Benjaire brand goods and printed work. No sales connected.'),
 room(0,'cloak','Cloakroom & services','services',ex1-5,n0,ex1,-4.6,'Facilities Coordinator','Cloakroom, washrooms and deliveries.'),
 // Floor 1: studios.
 room(1,'content','Content studio','studio',wx0,n0,wx1,-1.2,'Content Producer','Photo, video and copy production.'),
 room(1,'social','Social & community desk','desk',wx0,1.2,wx1,s1,'Social Media Manager','Planned social calendar and community replies. No accounts connected.'),
 room(1,'strategy','Strategy room','meeting',ex1-6,n0,ex1,-4,'Brand Strategist','Positioning, briefs and campaign plans.'),
 room(1,'review','Client review room','meeting',ex1-6,3.8,ex1,s1,'Account Director','Presenting work to clients for sign-off.'),
 room(1,'gallery','Campaign gallery','gallery',EAST_EDGE,4.4,ex1-6.6,s1,'Brand & Campaign Director','Current campaigns on show around the atrium.'),
 // Floor 2: galleries and research.
 room(2,'archive','Brand archive & library','archive',wx0,n0,wx1,-1.2,'Brand Librarian','Guidelines, past work and references.'),
 room(2,'insights','Insights lab','lab',wx0,1.2,wx1,s1,'Marketing Analyst','Planned reporting on campaign results. No ad accounts connected.'),
 room(2,'exhibition','Exhibition gallery','gallery',EAST_EDGE,4.4,ex1,s1,'Brand & Campaign Director','Permanent collection of Benjaire work.'),
 room(2,'workshop','Workshop room','meeting',ex1-6,n0,ex1,-4,'Creative Director','Ideas sessions and design critiques.'),
 // Floor 3: the stair arrives in a foyer round the atrium; the hall fills the west block, seats
 // facing a stage on the north wall, reached through the slot's doors.
 room(3,'hall','Presentation hall','hall',wx0,n0,wx1,s1,'Events Producer','Launches, talks and client presentations, about 120 seats.'),
 room(3,'foyer','Hall foyer','lounge',EAST_EDGE,4.4,ex1,s1,'Café & Events Host','Arrival from the atrium stair, with seating for breaks.'),
 room(3,'green','Green room & catering','green-room',ex1-6,n0,ex1,-4,'Café & Events Host','Speaker preparation and event catering.'),
];

export const AGENCY_FLOORS=['Lobby & reception','Studios','Galleries & research','Presentation hall'] as const;
export const AGENCY_OWNER='Brand & Campaign Director';

/** Atrium void on a level (true where the floor slab has the round opening). */
export const atriumOpen=(level:number)=>level>0&&level<=INTERIOR.atrium.openTo;

/** One flight of the curved stair, from `level` to the next, as step centres and headings. */
/** The landing where a flight meets the floor above, at the atrium's edge. */
/** Angle at which the flight from `level` reaches the floor above. */
export const flightEnd=(level:number)=>level%2?INTERIOR.stair.from:INTERIOR.stair.from+INTERIOR.stair.sweep;
export function stairLanding(level:number){
 const {radius,from,sweep,width}=INTERIOR.stair,a=INTERIOR.atrium,end=level%2?from:from+sweep;
 const mid=(radius+a.r+.6)/2;
 return {x:a.x+Math.cos(end)*mid,z:a.z+Math.sin(end)*mid,y:(level+1)*INTERIOR.storey,yaw:-end,length:a.r+.6-(radius-width/2),width:width+.3};
}
export function stairSteps(level:number){
 const {radius,from,sweep,steps}=INTERIOR.stair,a=INTERIOR.atrium,rise=INTERIOR.storey/steps,dir=level%2?-1:1,start=level%2?from+sweep:from;
 return Array.from({length:steps},(_,i)=>{const t=(i+.5)/steps,ang=start+dir*sweep*t;return {x:a.x+Math.cos(ang)*radius,z:a.z+Math.sin(ang)*radius,y:level*INTERIOR.storey+rise*(i+1),yaw:-ang};});
}

type P3=[number,number,number];
/** Doorway centre through the slot's glass walls (both walls open at z 0). */
export const SLOT_DOOR_Z=0;
const flight=(level:number):P3[]=>stairSteps(level).map(st=>[st.x,st.y,st.z]);
const landing=(level:number):P3=>{const l=stairLanding(level);return [l.x,l.y,l.z];};
/** Point on the floor at `level`, just outside the atrium edge at an angle. */
const rim=(level:number,ang:number,out=.9):P3=>[INTERIOR.atrium.x+Math.cos(ang)*(INTERIOR.atrium.r+out),level*INTERIOR.storey,INTERIOR.atrium.z+Math.sin(ang)*(INTERIOR.atrium.r+out)];

/** Rim points walking round the atrium on a floor from one angle to another, the short way. */
function around(level:number,from:number,to:number):P3[]{
 const d=Math.atan2(Math.sin(to-from),Math.cos(to-from)),n=Math.max(1,Math.ceil(Math.abs(d)/.45));
 return Array.from({length:n+1},(_,i)=>rim(level,from+d*i/n));
}

/**
 * The walk-through test route (KC, 2026-10-31): in from the plaza, round reception, up the atrium
 * stair to every floor, across the slot into the hall on floor 3, then back down and out the front
 * door. Points are [x, y, z] in interior units with y the floor height. A deterministic script, no
 * model calls; tests check that it reaches every floor, stays on floors or stairs, never crosses a
 * wall except through a door and ends outside.
 */
export function walkRoute():P3[]{
 const S=INTERIOR.storey,ex=entranceX(),{from,sweep}=INTERIOR.stair,a=INTERIOR.atrium,out:P3[]=[];
 const lobbyFoot=rim(0,from,.4);
 // Outside on the causeway, through the doors, to reception.
 out.push([ex,0,D+6],[ex,0,D+1.2],[ex,0,D-1.4],[a.x,0,a.z+a.r+.6],lobbyFoot);
 const up:P3[]=[];
 for(let level=0;level<a.openTo;level++){up.push(...flight(level),landing(level));
  const end=level%2?from:from+sweep;
  const room=AGENCY_ROOMS.find(r=>r.level===level+1&&r.x>=EAST_EDGE-1e-6&&r.z>0);
  if(room){const stop:P3=[room.x+room.w/2,(level+1)*S,room.z+room.d/2],arc=around(level+1,end,Math.atan2(stop[2]-a.z,stop[0]-a.x));
   up.push(...arc,stop,...[...arc].reverse(),landing(level));}
 }
 out.push(...up);
 // Floor 3: through the slot doorway to the middle of the hall, then back to the stair.
 const top=a.openTo*S,arrive=rim(a.openTo,(a.openTo-1)%2?from:from+sweep);
 out.push(arrive,[EAST_EDGE+.6,top,SLOT_DOOR_Z],[slotX(SLOT_DOOR_Z),top,SLOT_DOOR_Z],[WEST_EDGE-.6,top,SLOT_DOOR_Z],[(-W+.4+WEST_EDGE)/2,top,SLOT_DOOR_Z],[WEST_EDGE-.6,top,SLOT_DOOR_Z],[slotX(SLOT_DOOR_Z),top,SLOT_DOOR_Z],[EAST_EDGE+.6,top,SLOT_DOOR_Z],arrive);
 // Back down the same stair and out of the front door.
 const down:P3[]=[];
 for(let level=a.openTo-1;level>=0;level--){down.push(landing(level),...flight(level).reverse());}
 out.push(...down,lobbyFoot,[a.x,0,a.z+a.r+.6],[ex,0,D-1.4],[ex,0,D+1.2],[ex,0,D+6]);
 return out;
}
