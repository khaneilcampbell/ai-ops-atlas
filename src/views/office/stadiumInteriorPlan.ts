import {STADIUM,STADIUM_SCALE,sideGateFeet} from '../map3d/stadiumGeometry';

/**
 * Atlas Stadium interior (KC, 2026-11-07: "add interior to be able to enter the building").
 * Interior units are the map stadium at the cutaway scale CityOutside uses (4 interior units per
 * map unit), so the bowl lines up with the plaza and city seen outside. Origin at the stadium
 * centre, x east towards the main gate, z south, y up from the plaza.
 *
 * Two views and an open cutaway of both:
 * - Concourse: the glazed lobby ring under the stands, with stair cores, escalators, food
 *   kiosks, the stadium shop, first aid and the three gates of the exterior.
 * - Seating bowl: the pitch with goals and markings, three tiers of seat rows with aisles, a ring
 *   of hospitality boxes between the middle and upper tiers, and two scoreboards.
 *
 * It is a schematic of a planned venue: no events, tickets, attendance, scores or schedules exist.
 */
export const IU=4*STADIUM_SCALE;
export type Ellipse={rx:number;rz:number};
const grow=(e:Ellipse,k=IU):Ellipse=>({rx:e.rx*k,rz:e.rz*k});

export const STADIUM_INTERIOR={
 pitch:{w:STADIUM.pitch.w*IU,d:STADIUM.pitch.d*IU},
 /** Run-off round the pitch, then the first row of seats: set back so the pitch corners stay clear. */
 seatsInner:grow(STADIUM.seats.inner,IU*1.15),
 seatsOuter:grow(STADIUM.seats.outer),
 /** Seat rows rise from `low` to `high` across the three tiers. */
 seatLow:STADIUM.seats.low*IU,seatHigh:STADIUM.seats.high*IU*1.25,
 tiers:3,rowsPerTier:5,
 /** Aisles: radial gaps through every tier. */
 aisles:12,aisleWidth:.09,
 /** The concourse is the ring under the upper stands, out to the lobby glass. */
 concourseInner:grow({rx:STADIUM.seats.outer.rx*.82,rz:STADIUM.seats.outer.rz*.8}),
 glass:grow(STADIUM.lobby),
 /** Glass height on the concourse, matching the exterior lobby; it starts at plaza level inside. */
 glassH:(STADIUM.concourse.y+STADIUM.lobby.h)*IU,
 hospitality:{count:16,depth:1.6,height:1.7},
 scoreboard:{w:STADIUM.screens.w*IU,h:STADIUM.screens.h*IU},
} as const;

/** Point on an ellipse at angle a (radians, 0 = east, towards +z = south). */
export const onEllipse=(e:Ellipse,a:number):[number,number]=>[e.rx*Math.cos(a),e.rz*Math.sin(a)];
export const lerpEllipse=(a:Ellipse,b:Ellipse,t:number):Ellipse=>({rx:a.rx+(b.rx-a.rx)*t,rz:a.rz+(b.rz-a.rz)*t});
/** Inside an ellipse (value below 1). */
export const ellipseValue=(e:Ellipse,x:number,z:number)=>(x/e.rx)**2+(z/e.rz)**2;

export interface SeatRow {tier:number;row:number;ring:Ellipse;y:number}
/** Every seat row, front to back: tier 0 nearest the pitch. */
export function seatRows():SeatRow[]{
 const I=STADIUM_INTERIOR,n=I.tiers*I.rowsPerTier,out:SeatRow[]=[];
 for(let k=0;k<n;k++){
  // A small break between tiers, where the hospitality ring and the tier fronts sit.
  const tier=Math.floor(k/I.rowsPerTier),row=k%I.rowsPerTier,t=(k+tier*.6)/(n-1+(I.tiers-1)*.6);
  out.push({tier,row,ring:lerpEllipse(I.seatsInner,I.seatsOuter,t),y:I.seatLow+(I.seatHigh-I.seatLow)*t**1.15});
 }
 return out;
}
/** Angles of the aisle centres, kept off the long sides' middle so the halfway line view stays clear. */
export const aisleAngles=()=>Array.from({length:STADIUM_INTERIOR.aisles},(_,k)=>(k+.5)/STADIUM_INTERIOR.aisles*Math.PI*2);
export const inAisle=(a:number)=>aisleAngles().some(c=>Math.abs(Math.atan2(Math.sin(a-c),Math.cos(a-c)))<STADIUM_INTERIOR.aisleWidth);

/** Hospitality boxes: a ring between the middle and upper tiers, each with a glass front. */
export function hospitalityBoxes(){
 const rows=seatRows(),I=STADIUM_INTERIOR,front=rows.find(r=>r.tier===2&&r.row===0)!,tier1=rows.filter(r=>r.tier===1),back=tier1[tier1.length-1];
 const ring=lerpEllipse(back.ring,front.ring,.5),y=(back.y+front.y)/2;
 return Array.from({length:I.hospitality.count},(_,k)=>{const a=(k+.5)/I.hospitality.count*Math.PI*2,[x,z]=onEllipse(ring,a);return {x,z,y,yaw:-a,ring};});
}

export type SpaceKind='gate'|'stairs'|'escalator'|'food'|'shop'|'first-aid'|'restrooms'|'info';
export interface ConcourseSpace {id:string;name:string;kind:SpaceKind;angle:number;what:string}
/** Main gate faces east (angle 0); the side gates match the exterior's side gates. */
export const GATE_ANGLES=[0,...sideGateFeet().map(([x,z])=>Math.atan2(z/STADIUM.concourse.outer.rz,x/STADIUM.concourse.outer.rx))];
const space=(id:string,name:string,kind:SpaceKind,angle:number,what:string):ConcourseSpace=>({id,name,kind,angle,what});
export const CONCOURSE_SPACES:ConcourseSpace[]=[
 space('gate-main','Main gate','gate',GATE_ANGLES[0],'Entrance from the plaza, the city roads and Stadium Station'),
 space('gate-north','North-east gate','gate',GATE_ANGLES[1],'Side entrance to the plaza'),
 space('gate-south','South-east gate','gate',GATE_ANGLES[2],'Side entrance to the plaza'),
 space('stairs-ne','Stair core','stairs',-1.2,'Stairs up to the middle and upper tiers'),
 space('stairs-nw','Stair core','stairs',-2.2,'Stairs up to the middle and upper tiers'),
 space('stairs-sw','Stair core','stairs',2.2,'Stairs up to the middle and upper tiers'),
 space('stairs-se','Stair core','stairs',1.2,'Stairs up to the middle and upper tiers'),
 space('escalator-n','Escalators','escalator',-1.62,'Up to the hospitality ring'),
 space('escalator-s','Escalators','escalator',1.62,'Up to the hospitality ring'),
 space('food-n','Food kiosk','food',-.95,'Counter and queue rail'),
 space('food-w1','Food kiosk','food',-2.7,'Counter and queue rail'),
 space('food-w2','Food kiosk','food',2.7,'Counter and queue rail'),
 space('food-s','Food kiosk','food',.95,'Counter and queue rail'),
 space('shop','Atlas Stadium shop','shop',Math.PI,'Shelves and a pay counter, nothing for sale yet'),
 space('first-aid','First aid','first-aid',-.38,'Treatment room beside the main gate'),
 space('restrooms-n','Restrooms','restrooms',-1.95,'Restroom block'),
 space('restrooms-s','Restrooms','restrooms',1.95,'Restroom block'),
 space('info','Information desk','info',.38,'Help point beside the main gate'),
];
/** Mid line of the concourse, where its spaces stand. */
export const concourseMid=()=>lerpEllipse(STADIUM_INTERIOR.concourseInner,STADIUM_INTERIOR.glass,.5);
export const spacePoint=(s:Pick<ConcourseSpace,'angle'>)=>onEllipse(concourseMid(),s.angle);

export const STADIUM_VIEWS=['Concourse','Seating bowl'] as const;
export const STADIUM_STATUS='Planned · No live events';
