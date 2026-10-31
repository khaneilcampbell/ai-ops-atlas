import type {Pt} from './roads';

/**
 * Benjaire HQ, the ribbon tower (KC, 2026-10-31): one organic rounded-square tower wrapped in
 * dense horizontal champagne ribbons over dark glass, pinched at the waists, with a sky opening
 * through its upper middle and a crown with a hollow oculus over a roof garden. It rises out of a
 * flowing white terraced podium with planted edges, a round skylight and cafe umbrellas.
 * An original stylized Atlas building, no reference branding.
 *
 * Plain numbers only, in coordinates local to the tower (x across, z toward the viewer, y up from
 * the floor base), scaled by the tower's footprint. The plan is turned 45 degrees so the sky
 * opening faces the map's camera, and everything stays inside the old plinth, so the plaza,
 * kiosks, roads and links around it don't move.
 */
export const RIBBON={
 projectId:'benjaire-site',
 refSize:1.794,
 /** Half-size of the tower plan before shaping. */
 half:.58,
 roundness:3,
 ring:48,
 height:5.25,
 /** One ribbon every 0.125, so about 42 round the tower. */
 ribbonGap:.125,
 ribbonDepth:.05,
 ribbonThick:.024,
 /** Dark glass sits this much inside the ribbons. */
 glassInset:.93,
 /** The sky opening, as fractions of the tower's height. */
 portal:{from:.44,to:.8,width:.62},
 /** Crown: the hollow oculus is this share of the plan. */
 oculus:.52,
 podium:{levels:3,floor:.2,half:[.96,.86,.74],shift:[[-.04,.06],[-.1,.1],[-.14,.04]] as [number,number][]},
 turn:-Math.PI/4,
 /** The old plinth's half-size; nothing may stand outside it. */
 plinth:1.02,
} as const;

export const isRibbonTower=(projectId:string)=>projectId===RIBBON.projectId;
/** Roof height: the reference drawing's, or the height the scene gives it (matched to the Financial District). */
export const ribbonTop=(k=1,height?:number)=>height??RIBBON.height*k;

const rot=(x:number,z:number,a:number):Pt=>[x*Math.cos(a)-z*Math.sin(a),x*Math.sin(a)+z*Math.cos(a)];

/** A rounded square, counter-clockwise from above, with a soft organic ripple. */
function blob(cx:number,a:number,b:number,t:number,k:number,steps:number=RIBBON.ring):Pt[]{
 const n=RIBBON.roundness,pts:Pt[]=[];
 for(let i=0;i<steps;i++){
  const th=-i/steps*Math.PI*2,c=Math.cos(th),s=Math.sin(th);
  const ripple=1+.05*Math.sin(2*th+6*t)+.035*Math.sin(3*th-4*t);
  const x=a*Math.sign(c)*Math.abs(c)**(2/n)*ripple,z=b*Math.sign(s)*Math.abs(s)**(2/n)*ripple;
  pts.push(rot((cx+x)*k,z*k,RIBBON.turn));
 }
 return pts;
}

/** Pinched waists: the plan swells and narrows up the tower, about one and a half times. */
export function waist(t:number){return .92+.08*Math.cos(Math.PI*2*t*1.6);}

/** How wide the sky opening is at height t (0 base, 1 top), as a share of the plan. */
export function portalGap(t:number){
 const {from,to,width}=RIBBON.portal;
 if(t<=from||t>=to)return 0;
 return width*Math.sin(Math.PI*(t-from)/(to-from))**.6;
}

/**
 * The tower's plan outlines at height t: one ring, or two lobes where the sky opening splits it.
 * Each lobe keeps its outer edge where the whole plan's edge was, so the opening eats inward.
 */
export function ringsAt(t:number,k=1,scale=1,split=false):Pt[][]{
 const a=RIBBON.half*waist(t)*scale,g=portalGap(t)*a;
 if(g<=0&&!split)return [blob(0,a,a,t,k)];
 const lobe=(a-g/2)/2,c=(a+g/2)/2;
 return [blob(-c,lobe,a,t,k),blob(c,lobe,a,t,k)];
}

/** Ribbon heights from the ground to the crown. */
export function ribbonHeights(k=1,height=RIBBON.height*k){
 const n=Math.floor(height/(RIBBON.ribbonGap*k));
 return Array.from({length:n},(_,i)=>(i+1)*RIBBON.ribbonGap*k);
}

/** Podium terraces, bottom up: flowing rounded slabs offset toward the front-left. */
export function podiumRing(level:number,k=1):Pt[]{
 const h=RIBBON.podium.half[level],[sx,sz]=RIBBON.podium.shift[level],n=RIBBON.ring,pts:Pt[]=[];
 for(let i=0;i<n;i++){
  const th=-i/n*Math.PI*2,c=Math.cos(th),s=Math.sin(th);
  const r=1+.035*Math.sin(3*th+level)+.02*Math.sin(5*th-level*2);
  const x=h*Math.sign(c)*Math.abs(c)**(2/3.6)*r,z=h*Math.sign(s)*Math.abs(s)**(2/3.6)*r;
  // Shrink toward the shift so every terrace stays inside the bottom one.
  pts.push([(x*(1-Math.abs(sx))+sx)*k,(z*(1-Math.abs(sz))+sz)*k]);
 }
 return pts;
}
export const podiumHeight=(k=1)=>RIBBON.podium.levels*RIBBON.podium.floor*k;

/** Garden details on the podium: the round skylight, cafe umbrellas and a sweeping stair. */
export function podiumDetails(k=1){
 const top1=RIBBON.podium.floor*k*2;
 return {
  skylight:{x:.5*k,z:.48*k,r:.17*k,y:top1},
  umbrellas:[[.22,.74],[.42,.8],[.66,.62]].map(([x,z])=>({x:x*k,z:z*k,y:RIBBON.podium.floor*k})),
  stair:Array.from({length:4},(_,i)=>({x:(-.62+i*.03)*k,z:(.78-i*.07)*k,y:i*.05*k,w:.28*k})),
 };
}

/** Every outline on the ground plan, for clearance checks. */
export function footprint(k=1):Pt[]{
 const tower=ribbonHeights(1).flatMap(y=>ringsAt(y/RIBBON.height,k).flat());
 const podium=[0,1,2].flatMap(l=>podiumRing(l,k));
 return [...tower,...podium];
}

export function ribbonPieceCount(){
 const ribbons=ribbonHeights().length;
 return {meshes:['glass','ribbons','crown','garden','podiumSlabs','podiumGlass','planters','skylight','stair','umbrellas','signs'].length,ribbons,instances:9};
}
