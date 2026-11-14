import {GOLD_JET_PASSENGERS} from '../map3d/goldJetIds';

/**
 * Inside the gold private jet (Khaneil, 2026-11-13, from the reference renders): one long main-deck cabin, dark wood and
 * leather with warm gold cove light and a starry ceiling. Interior units are metres. x runs along the cabin, nose +x,
 * tail -x; z across, the cutaway (camera) side +z; y up from the cabin floor. A schematic, not a fitted model.
 */
export const JET_CABIN={length:46,radius:3.3,floorY:0,noseX:23,tailX:-23} as const;
/** Cabin half width at floor level: the floor sits a little below the tube's centre. */
export const CABIN_FLOOR_DROP=1.1;
export const cabinHalfWidth=()=>Math.sqrt(JET_CABIN.radius**2-CABIN_FLOOR_DROP**2);

export type JetRoomKind='flightdeck'|'office'|'lounge'|'cinema'|'bar'|'dining'|'suite';
export interface JetRoom {id:JetRoomKind;name:string;what:string;x0:number;x1:number}
/** Rooms from the nose back, as in the reference: office, lounge, cinema, bar, dining, master suite. */
export const JET_ROOMS:JetRoom[]=[
 {id:'flightdeck',name:'Flight deck',what:'Two crew seats behind the windscreen',x0:18.5,x1:23},
 {id:'office',name:'Private office',what:'A desk facing aft and a world map on the wall',x0:11.5,x1:18.5},
 {id:'lounge',name:'Lounge',what:'Leather recliners under a starry ceiling',x0:3,x1:11.5},
 {id:'cinema',name:'Cinema',what:'A wide screen with two rows of recliners',x0:-5.5,x1:3},
 {id:'bar',name:'Bar and lounge',what:'A curved bar with stools and a long sofa',x0:-12.5,x1:-5.5},
 {id:'dining',name:'Dining room',what:'A long table for eight',x0:-19,x1:-12.5},
 {id:'suite',name:'Master suite',what:'A double bed and dressing table',x0:-23,x1:-19},
];
export const roomCentreX=(r:JetRoom)=>(r.x0+r.x1)/2;

/** Seats in the order passengers fill them: lounge recliners first, then cinema and dining. Yaw turns a seated
 * figure (which faces -z) to face the way the seat does. */
export interface JetSeat {x:number;z:number;yaw:number;room:JetRoomKind}
const FACE_FORWARD=-Math.PI/2,FACE_AFT=Math.PI/2;
export const JET_SEATS:JetSeat[]=[
 {x:9.2,z:-1.5,yaw:FACE_AFT,room:'lounge'},{x:5.4,z:-1.5,yaw:FACE_FORWARD,room:'lounge'},
 {x:9.2,z:1.2,yaw:FACE_AFT,room:'lounge'},{x:-1.6,z:-1,yaw:FACE_FORWARD,room:'cinema'},
 {x:-1.6,z:1,yaw:FACE_FORWARD,room:'cinema'},{x:-15.75,z:-1.1,yaw:Math.PI,room:'dining'},
 {x:5.4,z:1.2,yaw:FACE_FORWARD,room:'lounge'},{x:-3.8,z:-1,yaw:FACE_FORWARD,room:'cinema'},
];
/** The passengers on board sit in the first `aboard` seats: the same people who walked the jet bridge. */
export function seatedPassengers(aboard:number):JetSeat[]{return JET_SEATS.slice(0,Math.max(0,Math.min(aboard,GOLD_JET_PASSENGERS)));}

/** In-flight map: fit airport-local route points into a w x h box with a margin, mirrored when the airport is. */
export function fitRoute(points:{x:number;z:number}[],w:number,h:number,pad=12,west=false,mirrorWidth=8){
 const xs=points.map(p=>west?mirrorWidth-p.x:p.x),zs=points.map(p=>p.z);
 const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
 const k=Math.min((w-2*pad)/Math.max(1e-6,x1-x0),(h-2*pad)/Math.max(1e-6,z1-z0));
 const ox=(w-(x1-x0)*k)/2,oz=(h-(z1-z0)*k)/2;
 return (x:number,z:number):[number,number]=>[ox+((west?mirrorWidth-x:x)-x0)*k,oz+(z-z0)*k];
}
