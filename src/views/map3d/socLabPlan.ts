import type {Tower} from './scene';
import {headquartersEnvelope} from './financialPlan';

/**
 * The SOC Lab as a glass and steel tower, after KC's reference image (2026-11-09):
 * - a blue glass curtain-wall core with thin vertical mullions;
 * - one full-height steel spine on the side the map looks at (+x), its face an exposed frame of
 *   columns, ties and zigzag diagonal braces;
 * - a full-height glass front, flush with the spine, so both faces the map shows line up (Khaneil,
 *   2026-11-13; it used to step back halfway between the terraces);
 * - three terraces standing out of that front (+z) as planted balconies, each a three-storey glass
 *   band with a cyan light strip along its top and bottom edges, and a green roof on top: lawn,
 *   a hedge along the edge, flowering shrubs and two small trees;
 * - a glass lobby podium at the foot of the front with a canopy over the entrance;
 * - a round flat disc crown on the roof with a cyan rim.
 *
 * Plain data in the tower's own frame: x across, y up from the plinth top (FLOOR_BASE), z toward
 * the front. Horizontal sizes are fractions of the tower's footprint `k`; heights are world units.
 * The renderer is SocLab.tsx.
 */
export const SOC_LAB={
 projectId:'soc-lab',
 /**
  * Roof height as a share of the Financial District's reference height (headquartersEnvelope),
  * so it stands among the Financial towers: above the Intelligence Hub (.9), under Atlas HQ (1.0).
  */
 share:.92,
 /** A storey aims for this height (the city's headquarters storey); the count fills the roof evenly. */
 storey:.48,
 /** The glass core and the steel spine beside it, in plan. */
 core:{x0:-.4,x1:.16,z0:-.42,z1:.02},
 /** The glass front fills the core forward to here (the spine's glass line), from the lobby roof up. */
 front:.4,
 spine:{x0:.16,x1:.4,z0:-.42,z1:.42,over:.18},
 /** Steel members: columns and ties this thick (world units), a diagonal brace every `bay` up. */
 member:.06,
 bay:1.1,
 /** The terraces: their bottoms as shares of the roof height, storeys tall, plan, and the green roof. */
 terraces:{at:[.3,.52,.74],storeys:3,x0:-.47,x1:.16,z1:.51,deck:.05,strip:.045},
 /** The lobby podium and its canopy. */
 lobby:{h:.95,x0:-.44,x1:.14,z1:.46,canopy:{x0:-.3,x1:-.02,out:.52,y:.62}},
 /** The disc crown: a drum then a flat disc, centred over the core. */
 crown:{x:-.1,z:-.1,drum:{r:.2,h:.32},disc:{r:.38,h:.07,rim:.02}},
} as const;

export const isSocLab=(projectId:string)=>projectId===SOC_LAB.projectId;

/** Roof height above the plinth top for a Financial reference height. */
export const socLabHeight=(reference:number)=>reference*SOC_LAB.share;

/** Give the SOC Lab its height from every tower's plain height (before any custom height). */
export function sizeSocLab(towers:Tower[]){
 const reference=headquartersEnvelope(towers);
 for(const t of towers)if(isSocLab(t.projectId))t.customHeight=socLabHeight(reference);
}

/** The disc crown's top above the roof. */
const crownRise=()=>SOC_LAB.crown.drum.h+SOC_LAB.crown.disc.h;
/** Height of the building's highest point above the plinth top: the disc crown. */
export const socLabTop=(height:number)=>height+crownRise();

/** What a part is made of: each kind is one look in the renderer. */
export type Kind='curtain'|'steel'|'brace'|'slab'|'cyan'|'lobby'|'lawn'|'hedge'|'pavilion';
/** An axis-aligned box: x and z as fractions of k, y in world units. */
export interface Box {kind:Kind;x0:number;x1:number;y0:number;y1:number;z0:number;z1:number}
/**
 * A diagonal steel brace on the spine's +x face, from (z0, y0) to (z1, y1) at x (fractions of k
 * for x and z, world units for y).
 */
export interface Brace {x:number;z0:number;y0:number;z1:number;y1:number}
export interface Plant {kind:'shrub'|'tree';x:number;y:number;z:number;s:number}
export interface Disc {x:number;z:number;y:number;r:number;h:number;kind:'steel'|'cyan'}
export interface SocLabPlan {
 height:number;storeys:number;storey:number;top:number;
 /** y of the bottom of each terrace's glass band. */
 terraces:number[];
 boxes:Box[];braces:Brace[];plants:Plant[];discs:Disc[];
}

/** Lay out every part of the building for roof height `height` above the plinth top. */
export function planSocLab(height:number):SocLabPlan{
 const S=SOC_LAB,C=S.core,P=S.spine,T=S.terraces,L=S.lobby,m=S.member;
 const storeys=Math.max(8,Math.round(height/S.storey)),storey=height/storeys;
 const boxes:Box[]=[],braces:Brace[]=[],plants:Plant[]=[],discs:Disc[]=[];
 const box=(kind:Kind,x0:number,x1:number,y0:number,y1:number,z0:number,z1:number)=>boxes.push({kind,x0,x1,y0,y1,z0,z1});

 // The glass core, and the spine: glass behind its steel frame, the frame rising a little past the roof.
 box('curtain',C.x0,C.x1,0,height,C.z0,C.z1);
 box('curtain',P.x0,P.x1-.02,0,height,P.z0+.02,P.z1-.02);
 box('steel',P.x0,P.x1,height,height+P.over,P.z0,P.z1);
 // Steel corner columns on the spine's front face, framing its glass the way the reference does.
 for(const x of [P.x0,P.x1-.05])box('brace',x,x+.05,0,height,P.z1-.03,P.z1);

 // The exposed frame on the spine's +x face: two columns, a tie at every bay, a zigzag of braces.
 const fx=P.x1-.005,bays=Math.max(4,Math.round(height/S.bay)),bay=height/bays,zA=P.z0+.06,zB=P.z1-.06;
 box('brace',P.x1-.04,P.x1+.01,0,height,zA-.04,zA+.04);
 box('brace',P.x1-.04,P.x1+.01,0,height,zB-.04,zB+.04);
 for(let i=0;i<=bays;i++){const y=Math.min(i*bay,height-m);box('brace',P.x1-.03,P.x1+.005,y,y+m,zA,zB);}
 for(let i=0;i<bays;i++){
  const up=i%2===0;
  braces.push({x:fx,z0:up?zA:zB,y0:i*bay,z1:up?zB:zA,y1:(i+1)*bay});
 }
 // The full-height glass front, flush with the spine, from the lobby roof up.
 const F=S.front;
 box('curtain',C.x0,C.x1,L.h,height,C.z1,F);
 // The roof: a plain parapet slab over the core and its front.
 box('slab',C.x0-.01,C.x1,height,height+.06,C.z0-.01,F+.01);

 // Lobby podium: warm glass, a white frame along its top and corners, a canopy over the door.
 box('lobby',L.x0,L.x1,0,L.h,C.z1,L.z1);
 box('slab',L.x0-.01,L.x1+.01,L.h,L.h+.07,C.z1,L.z1+.01);
 for(const x of [L.x0,(L.x0+L.x1)/2,L.x1])box('slab',x-.012,x+.012,0,L.h,L.z1,L.z1+.012);
 box('slab',L.canopy.x0,L.canopy.x1,L.canopy.y,L.canopy.y+.04,L.z1,L.canopy.out);
 for(let x=L.x0+.04;x<L.x1;x+=.1)plants.push({kind:'shrub',x,y:L.h+.07,z:L.z1-.03,s:.04});

 // The terraces.
 const terraces=T.at.map(a=>Math.round(height*a/storey)*storey);
 for(const y0 of terraces){
  const y1=y0+T.storeys*storey,deck=y1+T.deck,back=F-.06;
  // The band starts a little inside the front, so its side shows where it wraps the corner.
  box('curtain',T.x0,T.x1,y0,y1,back,T.z1);
  // Floor slab edges at each storey of the band, the way the reference shows its floors.
  for(let s=1;s<T.storeys;s++)box('slab',T.x0-.005,T.x1,y0+s*storey-.015,y0+s*storey+.015,T.z1-.004,T.z1+.005);
  box('slab',T.x0-.01,T.x1,y1,deck,back,T.z1+.01);
  // Cyan light strips along the front and the open side, at the band's top and bottom.
  const st=T.strip;
  for(const y of [y0,y1-st]){
   box('cyan',T.x0-.012,T.x1,y,y+st,T.z1+.005,T.z1+.018);
   box('cyan',T.x0-.018,T.x0-.005,y,y+st,back,T.z1+.018);
  }
  // The planted balcony on top: lawn, a hedge along the edge, flowering shrubs and two small trees.
  box('lawn',T.x0+.02,T.x1-.02,deck,deck+.03,F,T.z1-.015);
  box('hedge',T.x0+.03,T.x1-.03,deck,deck+.07,T.z1-.045,T.z1-.02);
  box('hedge',T.x0+.02,T.x0+.05,deck,deck+.07,back,T.z1-.045);
  plants.push({kind:'tree',x:-.43,y:deck+.03,z:F+.05,s:.6});
  plants.push({kind:'tree',x:.11,y:deck+.03,z:F+.05,s:.55});
  for(const x of [-.33,-.22,-.11,0])plants.push({kind:'shrub',x,y:deck+.03,z:F+.05,s:.04});
 }

 // The disc crown.
 const R=S.crown;
 discs.push({x:R.x,z:R.z,y:height+.06,r:R.drum.r,h:R.drum.h-.06,kind:'steel'});
 discs.push({x:R.x,z:R.z,y:height+R.drum.h,r:R.disc.r,h:R.disc.h,kind:'steel'});
 discs.push({x:R.x,z:R.z,y:height+R.drum.h+R.disc.h*.35,r:R.disc.r+R.disc.rim,h:R.disc.h*.3,kind:'cyan'});
 return {height,storeys,storey,top:socLabTop(height),terraces,boxes,braces,plants,discs};
}

/** The parts' extent from the centre, as a fraction of k: the footprint the building keeps. */
export function socLabReach(p:SocLabPlan){
 let r=0;
 for(const b of p.boxes)r=Math.max(r,Math.abs(b.x0),Math.abs(b.x1),Math.abs(b.z0),Math.abs(b.z1));
 for(const q of p.plants)r=Math.max(r,Math.abs(q.x),Math.abs(q.z));
 for(const d of p.discs)r=Math.max(r,Math.abs(d.x)+d.r,Math.abs(d.z)+d.r);
 return r;
}

/** Triangles the building draws (unit boxes 12, braces 12, discs 56, trees and shrubs as drawn). */
export function socLabTriangles(p:SocLabPlan){
 const trees=p.plants.filter(q=>q.kind==='tree').length,shrubs=p.plants.length-trees;
 return (p.boxes.length+p.braces.length)*12+p.discs.length*56+trees*(320+24)+shrubs*36;
}
