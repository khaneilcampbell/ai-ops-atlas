import * as THREE from 'three';
import {WATER_Y} from './scene';
import {YACHT,YACHT_SCALE,type YachtBerth} from './yachtPlan';
import {TRAVEL,TRAVEL_CLOCK,yachtCourse,yachtPoseAt,yachtSailing,type TravelPlan} from './travelLoops';
import type {YachtView} from './yachtRide';

/**
 * Following the Atlas yacht on her cruise (Khaneil, 2026-11-14: "follow the same rule like the gold jet. I should be able
 * to select the yacht wherever its at. I should be able to see the Atlas city wherever I am when Im inside the yacht").
 * One place works out where she is right now; her nameplate, selection outline, camera framing and the decks you ride
 * in all read it, so nothing stays behind at the mooring while she is out at sea.
 *
 * Decorative only: the cruise is the travel loops' visual simulation, not a real voyage.
 */

/** What the map's yacht last published: her berth, the travel plan she sails to and her own fallback clock. */
export const yachtLive:{berth?:YachtBerth;course?:{x:number;z:number;yaw:number}[];travel?:Pick<TravelPlan,'lap'|'yacht'>;clock:number}={clock:0};

/** Called by the map's yacht when its berth or travel plan changes. */
export function publishYacht(berth:YachtBerth,travel?:Pick<TravelPlan,'lap'|'yacht'>){
 if(yachtLive.berth!==berth){yachtLive.berth=berth;yachtLive.course=yachtCourse(berth);}
 yachtLive.travel=travel;
}

/** Seconds since she last cast off, on the train's clock when it runs (or her own clock otherwise). */
export function yachtSailingNow(){
 const t=yachtLive.travel;
 return t?.yacht?yachtSailing(t,TRAVEL_CLOCK.live?TRAVEL_CLOCK.t:yachtLive.clock):Infinity;
}

/** Where the yacht is on the map right now: hull centre at the waterline and heading (0: bow east). */
export function yachtLivePose():{x:number;z:number;yaw:number}|undefined{
 const b=yachtLive.berth;if(!b)return;
 if(!yachtLive.course||!yachtLive.travel?.yacht)return {x:b.x,z:b.z,yaw:b.yaw};
 return yachtPoseAt(yachtLive.course,yachtSailingNow());
}

export type YachtStage='berth'|'casting-off'|'outbound'|'homebound'|'alongside';
const STAGE_LABEL:Record<YachtStage,string>={berth:'Moored at the marina · Guests boarding','casting-off':'Casting off from the pontoon',outbound:'Cruising out to sea',homebound:'Heading back to the marina',alongside:'Coming alongside the pontoon'};
/** Her part of the cruise at `t` seconds since casting off, and seconds until she next sails (while moored). */
export function yachtCruiseState(t:number,period?:number):{stage:YachtStage;label:string;nextIn?:number}{
 const s=(stage:YachtStage,nextIn?:number)=>({stage,label:STAGE_LABEL[stage],nextIn});
 if(!(t<TRAVEL.sail))return s('berth',period&&Number.isFinite(t)?Math.max(0,period-t):undefined);
 if(t<TRAVEL.sailEase*1.5)return s('casting-off');
 if(t>TRAVEL.sail-TRAVEL.sailEase*1.5)return s('alongside');
 return s(t<TRAVEL.sail/2?'outbound':'homebound');
}

/** The selection box round the yacht in her own frame (bow +x), centred on the hull, up to the mast. */
export const YACHT_BOX={w:YACHT.length*YACHT_SCALE,d:YACHT.beam*YACHT_SCALE+.4,h:(YACHT.hull.deck+YACHT.sun.mastTop)*YACHT_SCALE};
/** The yacht's box laid flat on the map at a pose (axis-aligned round the turned box), for framing the camera. */
export function yachtBoundsAt(p:{x:number;z:number;yaw:number}){
 const c=Math.abs(Math.cos(p.yaw)),s=Math.abs(Math.sin(p.yaw)),B=YACHT_BOX;
 return {x:p.x,z:p.z,y0:WATER_Y,y1:WATER_Y+B.h,w:c*B.w+s*B.d,d:s*B.w+c*B.d};
}

// ------------------------------------------------------------------ riding inside

/** Interior metres per map unit of the design (yachtInteriorPlan.K, repeated so this stays free of the office modules). */
export const YACHT_METRES=58/YACHT.length;
/** Metres per map unit on the map, where the design is drawn YACHT_SCALE larger. */
export const DECK_PER_MAP=YACHT_METRES/YACHT_SCALE;
/** Height of each deck's floor above the waterline, in metres: the main deck from the hull, 3.2 m between decks. */
export const DECK_FLOOR:[number,number,number,number]=(()=>{const main=YACHT.hull.deck*YACHT_METRES,h=YACHT.deckH*YACHT_METRES;return [main-h,main,main+h,main+2*h];})();

/**
 * Deck point (metres; x along her length with the bow +x, z across with starboard +z, y up from the waterline) -> map
 * point, for the yacht at `pose`. Follows the map's own yacht group: at the pose on the water, turned to her heading.
 */
export function deckToMap(pose:{x:number;z:number;yaw:number}):THREE.Matrix4{
 const m=new THREE.Matrix4(),t=new THREE.Matrix4();
 m.makeTranslation(pose.x,WATER_Y,pose.z);
 m.multiply(t.makeRotationY(pose.yaw));
 m.multiply(t.makeScale(1/DECK_PER_MAP,1/DECK_PER_MAP,1/DECK_PER_MAP));
 return m;
}

/** Decks drawn for a view: every deck, or the chosen deck and those under it, so you look down into it. */
export const decksShown=(view:YachtView):(0|1|2|3)[]=>view===-1||view==='sundeck'?[0,1,2,3]:([0,1,2,3] as const).filter(d=>d<=view);

const UP=new THREE.Vector3(0,1,0);
/** Camera eye and target in deck metres for each view, before the overlay's turn and zoom. */
function baseView(view:YachtView,portrait:boolean){
 // Standing up by the hard top, above the sun deck's rails, looking out level with the skyline.
 if(view==='sundeck'){const y=DECK_FLOOR[3]+2.6;return {eye:new THREE.Vector3(-14,y,0),target:new THREE.Vector3(40,y-9,0),orbit:false};}
 if(view===-1)return portrait
  // A portrait phone can't fit her side-on: it looks along her from off the starboard quarter.
  ?{eye:new THREE.Vector3(-58,34,46),target:new THREE.Vector3(2,6,0),orbit:true}
  // Off her starboard side, a little above the sun deck: every deck shows through the open side, the city beyond.
  :{eye:new THREE.Vector3(4,20,72),target:new THREE.Vector3(0,8,0),orbit:true};
 const y=DECK_FLOOR[view];
 // High enough to look down into the deck's rooms, far enough back to keep the city in the top of the view.
 return portrait?{eye:new THREE.Vector3(-46,y+28,40),target:new THREE.Vector3(0,y+1,0),orbit:true}:{eye:new THREE.Vector3(0,y+17,60),target:new THREE.Vector3(0,y+1,0),orbit:true};
}
/**
 * Extra turn for the view so the Atlas city stays in sight wherever she is on her cruise (Khaneil: "I should be able to
 * see the Atlas city wherever I am"): the orbiting views put the camera on her far side from the city, looking across her
 * decks toward it; the sun deck view turns to look at it. `city` is a map point (the map's centre).
 */
export function cityFacing(view:YachtView,portrait:boolean,pose:{x:number;z:number;yaw:number},city:{x:number;z:number}){
 const dx=city.x-pose.x,dz=city.z-pose.z,c=Math.cos(pose.yaw),s=Math.sin(pose.yaw);
 // The city in her own frame (bow +x, starboard +z): undo her heading (rotation.y = yaw).
 const lx=dx*c-dz*s,lz=dx*s+dz*c;
 if(Math.hypot(lx,lz)<1e-6)return 0;
 const base=baseView(view,portrait),d=base.orbit?base.eye.clone().sub(base.target):base.target.clone().sub(base.eye);
 // Turning by a about the vertical takes the direction (x, z) to (x cos a + z sin a, -x sin a + z cos a).
 const from=Math.atan2(d.x,d.z),to=base.orbit?Math.atan2(-lx,-lz):Math.atan2(lx,lz);
 return Math.atan2(Math.sin(to-from),Math.cos(to-from));
}
/** Eases an angle toward another the short way round, about two seconds to settle, so a turn is a glide, not a jump. */
export function easeAngle(from:number,to:number,dt:number){
 const d=Math.atan2(Math.sin(to-from),Math.cos(to-from));
 return from+d*Math.min(1,dt*1.8);
}
/** Which side the decks open on (+1 starboard, -1 port): the camera's side, switching only once it is well round. */
export function openSide(v:{eye:THREE.Vector3;target:THREE.Vector3},prev:1|-1):1|-1{
 const z=v.eye.z-v.target.z,len=Math.hypot(v.eye.x-v.target.x,z)||1;
 return prev>0&&z<-.25*len?-1:prev<0&&z>.25*len?1:prev;
}

/** The camera's eye and target in deck metres: the view's framing, turned by yaw and pitch and zoomed. The sun deck view
 * keeps the eye where you stand and turns the look; the others orbit the yacht. */
export function yachtRideView(view:YachtView,portrait:boolean,yaw:number,pitch:number,zoom:number){
 const base=baseView(view,portrait),pivot=base.orbit?base.target:base.eye,other=base.orbit?base.eye:base.target;
 const v=other.clone().sub(pivot).applyAxisAngle(UP,yaw),side=v.clone().cross(UP).normalize();
 const elev=Math.asin(Math.max(-1,Math.min(1,v.y/v.length())));
 // Orbiting stays above the water; standing on the sun deck you can look up at the sky or down at the bow.
 const p=base.orbit?Math.max(.05-elev,Math.min(1.35-elev,pitch)):Math.max(-.9-elev,Math.min(.9-elev,pitch));
 v.applyAxisAngle(side,p).multiplyScalar(base.orbit?zoom:1);
 return base.orbit?{eye:pivot.clone().add(v),target:pivot.clone()}:{eye:pivot.clone(),target:pivot.clone().add(v)};
}
