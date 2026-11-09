import {MODELS,SCALE,type Part} from './vehicleModels';
import type {Pt} from './roads';

/**
 * The Galleria car park's fleet (KC, 2026-11-09): executive coupes and saloons, boxy luxury SUVs,
 * wedge supercars, pickups, taxis, a stretch limo and a concept truck. Styled after the cars KC
 * named, with no badges or names on them. Built from the map's own vehicle parts, so parked and
 * moving cars match the traffic on the streets.
 */
export type GalleriaCarKind='coupe'|'suv'|'supercar'|'pickup'|'taxi'|'limo'|'prototype';
const GLASS='#3d4d55',TIRE='#262b2e';

/** A sedan pulled long, with a third window pane and a chrome line: the stretch limo. */
const LIMO:Part[]=[
 ...[-1,1].flatMap(f=>[-1,1].map(sd=>({at:[f*.1,0,sd*.045],size:[.044,.04,.022],color:TIRE}) as Part)),
 {at:[0,.014,0],size:[.29,.044,.1],color:null},
 {at:[-.01,.058,0],size:[.2,.034,.088],color:GLASS},
 {at:[-.01,.092,0],size:[.19,.008,.08],color:null},
 ...[-1,1].map(sd=>({at:[0,.04,sd*.0505],size:[.27,.004,.002],color:'#c9cdd0'}) as Part),
];
/** A low concept truck: one long wedge, a glass cab set forward, a covered bed and a cyan light bar. */
const PROTOTYPE:Part[]=[
 ...[-1,1].flatMap(f=>[-1,1].map(sd=>({at:[f*.085,0,sd*.047],size:[.05,.044,.024],color:TIRE}) as Part)),
 {at:[0,.014,0],size:[.27,.048,.112],color:null},
 {at:[.035,.062,0],size:[.12,.034,.1],color:GLASS},
 {at:[-.075,.062,0],size:[.11,.008,.1],color:'#9aa3a8'},
 {at:[.136,.035,0],size:[.006,.008,.108],color:'#5fd3f3'},
 {at:[-.136,.035,0],size:[.006,.008,.108],color:'#e0574a'},
];
export const GALLERIA_FLEET:Record<GalleriaCarKind,{parts:Part[];paints:string[]}>={
 coupe:{parts:MODELS.bmw.parts,paints:['#1f3b5a','#c9ccd0','#16191b','#e8e6e1']},
 suv:{parts:MODELS.gwagon.parts,paints:['#1b1d1f','#eceae4','#6b7075','#24324a']},
 supercar:{parts:MODELS.sports.parts,paints:['#f2a516','#9bd13a','#f5d020','#c8352c']},
 pickup:{parts:MODELS.pickup.parts,paints:['#8c3b34','#3f4a3c','#d8d6cf','#2a3440']},
 taxi:{parts:MODELS.taxi.parts,paints:['#f1c232']},
 limo:{parts:LIMO,paints:['#121416','#f1f0ec']},
 prototype:{parts:PROTOTYPE,paints:['#d9dde0','#2b2f33']},
};
/** The order cars take bays in: a mix, with the eye-catchers spread out. */
const ORDER:GalleriaCarKind[]=['coupe','suv','supercar','taxi','pickup','coupe','limo','suv','prototype','supercar','coupe','pickup'];
export function galleriaCar(k:number):{kind:GalleriaCarKind;c:string}{
 const kind=ORDER[k%ORDER.length],p=GALLERIA_FLEET[kind].paints;
 return {kind,c:p[Math.floor(k/ORDER.length+k)%p.length]};
}
/** Most parts any fleet car has, so a moving fleet can share one instanced mesh with a fixed stride. */
export const FLEET_STRIDE=Math.max(...Object.values(GALLERIA_FLEET).map(f=>f.parts.length));

/** One posed box of a car: centre-bottom position, size and yaw, for the map's bottom-anchored box. */
export interface CarBox {x:number;y:number;z:number;w:number;h:number;d:number;r:number;c:string}
/**
 * A car's boxes at (x, z), its nose pointing along `yaw` (0 is +z, as the map's walkers and drivers
 * use). Models face +x in their own frame, so they turn by yaw minus a quarter turn.
 */
export function carBoxes(kind:GalleriaCarKind,paint:string,[x,z]:Pt,yaw:number,y=0):CarBox[]{
 const r=yaw-Math.PI/2,cos=Math.cos(r),sin=Math.sin(r);
 return GALLERIA_FLEET[kind].parts.map(p=>{
  const ax=p.at[0]*SCALE,az=p.at[2]*SCALE;
  return {x:x+ax*cos+az*sin,y:y+p.at[1]*SCALE,z:z-ax*sin+az*cos,w:p.size[0]*SCALE,h:p.size[1]*SCALE,d:p.size[2]*SCALE,r,c:p.color??paint};
 });
}
