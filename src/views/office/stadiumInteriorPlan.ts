import {STADIUM,STADIUM_SCALE,sideGateFeet} from '../map3d/stadiumGeometry';

/**
 * Atlas Stadium interior (Khaneil, 2026-11-07: "add interior to be able to enter the building"; then
 * the steel-truss arena from Khaneil's reference). Interior units are the map stadium at the cutaway
 * scale CityOutside uses (4 interior units per map unit), so the hall lines up with the plaza and
 * city seen outside. Origin at the stadium centre (the main hall's centre), x east towards the
 * main gate, z south, y up from the plaza.
 *
 * Two views and an open cutaway of both:
 * - Concourse: the glazed ring between the hall's curtain walls and the stands, with stair cores,
 *   escalators, food kiosks, the stadium shop, first aid and the three gates of the exterior.
 * - Seating bowl: an octagonal bowl (a rectangle with chamfered corners) round one show court,
 *   a lower and an upper tier with aisles, a ring of hospitality boxes between them, and the
 *   exposed roof trusses overhead.
 *
 * It is a schematic of a planned venue: no events, tickets, attendance, scores or schedules exist.
 */
export const IU=4*STADIUM_SCALE;
/**
 * A ring is an octagon: half-widths rx and rz, with its corners cut where |x|/rx + |z|/rz > k.
 * k = 2 is a plain rectangle; smaller k cuts deeper chamfers.
 */
export type Ring={rx:number;rz:number;k:number};
const ring=(rx:number,rz:number,k:number):Ring=>({rx:rx*IU,rz:rz*IU,k});

export const STADIUM_INTERIOR={
 /** One show court, doubles size, in the hall's design proportions. */
 court:{w:1.38*IU,d:.64*IU},
 /** The court's surround, out to the first row of seats. */
 seatsInner:ring(1.18,.74,1.55),
 seatsOuter:ring(2.3,1.6,1.55),
 /** Seat rows rise from `low` to `high` across the two tiers. */
 seatLow:.1*IU,seatHigh:1.2*IU,
 tiers:2,rowsPerTier:7,
 /** Aisles: radial gaps through every tier; vomitories at the four chamfered corners. */
 aisles:12,aisleWidth:.09,
 /** The concourse ring sits under the upper stands, out to the curtain wall. */
 concourseInner:ring(2.05,1.4,1.55),
 /** The main hall's curtain walls: a rectangle. */
 glass:ring(STADIUM.hall.x1-.04,STADIUM.hall.z-.04,2),
 /** Glass height from the plaza to the roof's low eave. */
 glassH:(STADIUM.roof.low-STADIUM.roof.thick)*IU,
 hospitality:{count:16,depth:1.6,height:1.7},
 /** Roof trusses over the bowl: the exterior's count, at the height of the roof's underside. */
 trusses:STADIUM.trusses.main,
} as const;

/** How far out a point is on a ring: 1 on the ring, below 1 inside. */
export const ringValue=(e:Ring,x:number,z:number)=>{const ax=Math.abs(x)/e.rx,az=Math.abs(z)/e.rz;return Math.max(ax,az,(ax+az)/e.k);};
/** Point on a ring at angle a (radians, 0 = east, towards +z = south). */
export const onRing=(e:Ring,a:number):[number,number]=>{const c=Math.cos(a),s=Math.sin(a),t=1/ringValue(e,c,s);return [c*t,s*t];};
export const lerpRing=(a:Ring,b:Ring,t:number):Ring=>({rx:a.rx+(b.rx-a.rx)*t,rz:a.rz+(b.rz-a.rz)*t,k:a.k+(b.k-a.k)*t});

export interface SeatRow {tier:number;row:number;ring:Ring;y:number}
/** Every seat row, front to back: tier 0 nearest the court. */
export function seatRows():SeatRow[]{
 const I=STADIUM_INTERIOR,n=I.tiers*I.rowsPerTier,out:SeatRow[]=[];
 for(let k=0;k<n;k++){
  // A break between the tiers, where the hospitality ring and the upper tier's front sit.
  const tier=Math.floor(k/I.rowsPerTier),row=k%I.rowsPerTier,t=(k+tier*.9)/(n-1+(I.tiers-1)*.9);
  out.push({tier,row,ring:lerpRing(I.seatsInner,I.seatsOuter,t),y:I.seatLow+(I.seatHigh-I.seatLow)*t**1.15});
 }
 return out;
}
/** Angles of the aisle centres: four on the chamfered corners (the vomitories), the rest between. */
export const aisleAngles=()=>{const I=STADIUM_INTERIOR,corner=Math.atan2(I.seatsOuter.rz,I.seatsOuter.rx);
 const out=[corner,Math.PI-corner,Math.PI+corner,-corner];
 for(const a of [.32,-.32,Math.PI-.32,Math.PI+.32,Math.PI/2-.42,Math.PI/2+.42,-Math.PI/2-.42,-Math.PI/2+.42])out.push(a);
 return out.slice(0,I.aisles);};
export const inAisle=(a:number)=>aisleAngles().some(c=>Math.abs(Math.atan2(Math.sin(a-c),Math.cos(a-c)))<STADIUM_INTERIOR.aisleWidth);

/** Hospitality boxes: a ring between the lower and upper tiers, each with a glass front. */
export function hospitalityBoxes(){
 const rows=seatRows(),I=STADIUM_INTERIOR,front=rows.find(r=>r.tier===1&&r.row===0)!,lower=rows.filter(r=>r.tier===0),back=lower[lower.length-1];
 const r=lerpRing(back.ring,front.ring,.5),y=(back.y+front.y)/2;
 return Array.from({length:I.hospitality.count},(_,k)=>{const a=(k+.5)/I.hospitality.count*Math.PI*2,[x,z]=onRing(r,a);return {x,z,y,yaw:-a,ring:r};});
}

export type SpaceKind='gate'|'stairs'|'escalator'|'food'|'shop'|'first-aid'|'restrooms'|'info';
export interface ConcourseSpace {id:string;name:string;kind:SpaceKind;angle:number;what:string}
/** Main gate faces east (angle 0); the side gates match the exterior's side gates. */
export const GATE_ANGLES=[0,...sideGateFeet().map(([x,z])=>Math.atan2(z,x))];
const space=(id:string,name:string,kind:SpaceKind,angle:number,what:string):ConcourseSpace=>({id,name,kind,angle,what});
export const CONCOURSE_SPACES:ConcourseSpace[]=[
 space('gate-main','Main gate','gate',GATE_ANGLES[0],'Entrance from the grand stair, the city roads and Stadium Station'),
 space('gate-north','North gate','gate',GATE_ANGLES[1],'Side entrance from the north flight'),
 space('gate-south','South gate','gate',GATE_ANGLES[2],'Side entrance from the south flight'),
 space('stairs-ne','Stair core','stairs',-1.2,'Stairs up to the upper tier'),
 space('stairs-nw','Stair core','stairs',-2.2,'Stairs up to the upper tier'),
 space('stairs-sw','Stair core','stairs',2.2,'Stairs up to the upper tier'),
 space('stairs-se','Stair core','stairs',1.2,'Stairs up to the upper tier'),
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
export const concourseMid=()=>lerpRing(STADIUM_INTERIOR.concourseInner,STADIUM_INTERIOR.glass,.5);
export const spacePoint=(s:Pick<ConcourseSpace,'angle'>)=>onRing(concourseMid(),s.angle);

export const STADIUM_VIEWS=['Concourse','Seating bowl'] as const;
export const STADIUM_STATUS='Planned · No live events';
