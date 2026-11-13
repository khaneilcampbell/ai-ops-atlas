import type {MarinaSite,Area} from './marinaPlan';
import {WATER_Y,TERRACE_H} from './scene';

/**
 * Atlas, the harbour yacht (Khaneil, 2026-11-13: "design a large yacht named Atlas... realistic...
 * enter the yacht... agents on board and a dock connector"). Architecture from Khaneil's reference
 * deck plan and renders: a four-deck tri-deck with a grey hull, white superstructure overhangs,
 * black glazing bands, a beach club at the stern and a sun deck with a jacuzzi. It carries only the
 * name Atlas: no builder mark, flag or real yacht name from the references.
 *
 * Map units: a person is about 0.2 tall, so one unit is about 9 m and the yacht is about 55 m long.
 * Local frame: x along the length (bow +x, stern -x), z across (starboard +z), y up from the waterline.
 */
export const YACHT_KEY='service:atlas-yacht';
export const YACHT_ID='atlas-yacht';
export const YACHT_NAME='Atlas';
/** Office id shared by the Enter button and the interior route. */
export const YACHT_OFFICE_ID='skyline-business:Atlas Yacht';

export const YACHT={
 length:6,beam:1.1,
 /** Hull: waterline to the main deck at the stern, rising `sheer` toward the bow. */
 hull:{deck:.42,sheer:.12,bootTop:.07,draft:.12,parallelTo:.9,transom:.94},
 /** Deck to deck height of each level above the main deck. */
 deckH:.33,
 /** Swim platform at the stern (the beach club opens onto it). */
 platform:{x0:-3.28,x1:-3,y:.1},
 /** Main deck: open aft deck, then the enclosed saloon to `x1`, side decks `side` wide. */
 main:{aftDeck:-1.55,x1:2.05,side:.07},
 /** Bridge deck slab (x0 to x1) over the aft deck; enclosed from `enclosed0` to the wheelhouse front at `x1`. */
 bridge:{x0:-2.45,x1:1.55,enclosed0:-.95},
 /** Sun deck slab, with the hard top over its forward part and the mast. */
 sun:{x0:-2.05,x1:.95,hardTop:[-.55,.95] as const,mast:.35,mastTop:1.3},
} as const;

/** Where Atlas is berthed and how the dock reaches it. All values in map coordinates. */
export interface YachtBerth {
 /** Centre of the hull at the waterline, and its heading (0: bow east). */
 x:number;z:number;yaw:number;
 /** Long pontoon that carries on east from the marina's cross dock, along the yacht's dock side. */
 pontoon:{x0:number;x1:number;z:number;w:number};
 /** Passerelle (gangway) from the pontoon up to the aft deck gate on the yacht's dock side. */
 gangway:{x:number;z0:number;z1:number;y0:number;y1:number};
}

/** Gap between the cross dock's east end and the yacht's transom. */
const STERN_GAP=2.2;
/** Pontoon width (narrower than the cross dock, so passing boats keep clear). */
const PONTOON_W=.32;

/**
 * Berth Atlas side-to inside the marina: bow east, starboard side to a pontoon that continues the
 * cross dock, in the water between the cliff and the boat lane. Nothing on land moves.
 */
export function yachtBerth(m:MarinaSite):YachtBerth{
 const dockZ=m.pierZ+1.05,x=m.x+STERN_GAP+YACHT.length/2,z=m.pierZ-.3;
 const deckY=WATER_Y+YACHT.hull.deck,dockTop=WATER_Y+.22,gate=x+(YACHT.main.aftDeck+YACHT.platform.x1)/2+.25;
 return {
  x,z,yaw:0,
  pontoon:{x0:m.x+1.6,x1:x+YACHT.length/2+.3,z:dockZ+.03,w:PONTOON_W},
  gangway:{x:gate,z0:dockZ+.03-PONTOON_W/2+.04,z1:z+YACHT.beam/2-.02,y0:dockTop,y1:deckY},
 };
}

/** Water the yacht and its pontoon take, with a margin: viaduct supports and other piers keep off it. */
export function yachtFootprint(b:YachtBerth):Area{
 const x0=b.x-YACHT.length/2-.5,x1=Math.max(b.pontoon.x1,b.x+YACHT.length/2)+.3;
 return {x:x0,z:b.z-YACHT.beam/2-.3,w:x1-x0,d:b.pontoon.z+b.pontoon.w/2+.2-(b.z-YACHT.beam/2-.3)};
}

/** Selection box for the map (anchors, framing, plaque): hull and superstructure up to the mast. */
export function yachtBounds(b:YachtBerth){
 return {x:b.x,z:b.z,y0:WATER_Y,y1:WATER_Y+YACHT.hull.deck+YACHT.sun.mastTop,w:YACHT.length,d:YACHT.beam+.4};
}

export type RoutePoint=[number,number,number];
/**
 * The way on board, from the city promenade: along the approach, down the marina stair, out along
 * the cross dock and pontoon, up the passerelle and across the aft deck to the saloon doors. Agents
 * and visitors walk this both ways. Points are [x, y, z]; the stair is one straight sloping leg.
 */
export function boardingRoute(m:MarinaSite,b:YachtBerth):RoutePoint[]{
 const cityTop=TERRACE_H+.03,dockTop=WATER_Y+.22,deckY=WATER_Y+YACHT.hull.deck+.01,dockZ=b.pontoon.z;
 const saloonX=b.x+YACHT.main.aftDeck-.12;
 return [
  [m.x,cityTop,m.cityWalkZ],
  [m.x,cityTop,m.pierZ-1.8],
  [m.x,dockTop,m.pierZ],
  [m.x,dockTop,dockZ],
  [b.gangway.x,dockTop,dockZ],
  [b.gangway.x,dockTop,b.gangway.z0],
  [b.gangway.x,deckY,b.gangway.z1],
  [b.gangway.x,deckY,b.z+.1],
  [saloonX,deckY,b.z+.1],
 ];
}

/** Lengths of each leg of a route and the whole, for walking it at a steady pace. */
export function routeLengths(r:RoutePoint[]){
 const legs=r.slice(1).map((p,i)=>Math.hypot(p[0]-r[i][0],p[1]-r[i][1],p[2]-r[i][2]));
 return {legs,total:legs.reduce((a,v)=>a+v,0)};
}

/** Point a distance `d` along a route. */
export function routeAt(r:RoutePoint[],legs:number[],d:number):{p:RoutePoint;dir:[number,number]}{
 let i=0;while(i<legs.length-1&&d>legs[i]){d-=legs[i];i++;}
 const a=r[i],b=r[i+1],t=legs[i]?Math.min(1,Math.max(0,d/legs[i])):0;
 const dx=b[0]-a[0],dz=b[2]-a[2],n=Math.hypot(dx,dz)||1;
 return {p:[a[0]+dx*t,a[1]+(b[1]-a[1])*t,a[2]+dz*t],dir:[dx/n,dz/n]};
}
