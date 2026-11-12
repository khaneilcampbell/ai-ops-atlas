import type {Tower} from './scene';
import {headquartersEnvelope} from './financialPlan';
import {intelligenceHubHeight} from './intelligenceHubPlan';

/**
 * The Portfolio Site as a slim apartment tower, after KC's reference (the G+M+8 apartment
 * building in Dhaka by Khetro Sthapati, Behance screenshots 2026-11-08): white render, brown brick
 * and timber slats on the left side and back, and on the faces the map looks at:
 * - front (+z): a balcony per floor on the left (white slab, brown slatted railing, warm window
 *   wall behind), white box frames round the middle windows that shift left and right every two
 *   floors, and one solid white pier on the right from the ground up to the roof canopy;
 * - side (+x): cantilevered white balcony slabs in two bays split by a white fin, brown louvres,
 *   railings and trailing greenery;
 * - a recessed ground floor under a deep planted canopy, a chevron timber gate and a round
 *   terracotta name sign; a roof terrace under a flat white canopy, a stair and lift box behind.
 *
 * Plain data in the tower's own frame: x across, y up from the plinth top (FLOOR_BASE), z toward
 * the front. Horizontal sizes are fractions of the footprint `k`; heights are world units.
 * The renderer is PortfolioSite.tsx.
 */
export const PORTFOLIO_SITE={
 projectId:'portfolio-site',
 /**
  * Ground floor plus twelve floors: the reference is G+8, but KC asked for it taller (2026-11-08),
  * so the same floor repeats four more times and the roof stands near the old tower's height.
  */
 floors:12,
 ground:.66,
 storey:.5,
 /** Roof terrace: the canopy's underside above the roof, its thickness, the parapet height. */
 canopy:{lift:.6,h:.06},
 parapet:.12,
 /** Plan edges (fractions of k): the walls, the front columns and the side bays. */
 core:{x0:-.42,x1:.34,z0:-.44,z1:.3},
 /** Brick and timber cladding on the left side and back, this thick. */
 skin:.04,
 left:{x0:-.42,x1:-.11,out:.45},
 middle:{x:.05,w:.3,out:.41,shift:.03},
 pier:{x0:.2,x1:.36,z1:.44},
 side:{out:.5,inner:.46,bays:[[.02,.3],[-.42,-.04]] as [number,number][],fin:-.03},
 slab:.06,
 rail:.17,
} as const;

export const isPortfolioSite=(projectId:string)=>projectId===PORTFOLIO_SITE.projectId;

/** Roof slab top above the plinth, and the building's highest point (the canopy). */
export const portfolioSiteRoof=()=>PORTFOLIO_SITE.ground+PORTFOLIO_SITE.floors*PORTFOLIO_SITE.storey;
export const portfolioSiteTop=(roof=portfolioSiteRoof())=>roof+PORTFOLIO_SITE.canopy.lift+PORTFOLIO_SITE.canopy.h;

/** Match the Operations Center roof with Portfolio's canopy, preserving its twelve floors. */
export function sizePortfolioSite(towers:Tower[]){
 const roof=intelligenceHubHeight(headquartersEnvelope(towers))-PORTFOLIO_SITE.canopy.lift-PORTFOLIO_SITE.canopy.h;
 for(const t of towers)if(isPortfolioSite(t.projectId))t.customHeight=roof;
}

/** What a part is made of: each kind is one material in the renderer. */
export type Kind='white'|'slats'|'rail'|'dark'|'lobby';
/** An axis-aligned box: x and z as fractions of k, y in world units. */
export interface Box {kind:Kind;x0:number;x1:number;y0:number;y1:number;z0:number;z1:number}
/** A flat panel facing `face` (+z front, +x side, -z back, down = a ceiling), centred at x, y, z. */
export interface Panel {kind:'glass'|'gate'|'sign'|'ceiling';x:number;y:number;z:number;w:number;h:number;face:'front'|'side'|'back'|'down'}
export interface Plant {kind:'shrub'|'trail'|'tree';x:number;y:number;z:number;s:number}
export interface PortfolioSitePlan {lines:number[];roof:number;top:number;boxes:Box[];panels:Panel[];plants:Plant[]}

/** Lay out every part of the building. */
export function planPortfolioSite(roof=portfolioSiteRoof()):PortfolioSitePlan{
 const P=PORTFOLIO_SITE,C=P.core,G=P.ground,S=(roof-G)/P.floors,top=portfolioSiteTop(roof);
 const lines=Array.from({length:P.floors+1},(_,i)=>G+i*S);
 const boxes:Box[]=[],panels:Panel[]=[],plants:Plant[]=[];
 const box=(kind:Kind,x0:number,x1:number,y0:number,y1:number,z0:number,z1:number)=>boxes.push({kind,x0,x1,y0,y1,z0,z1});

 // The white body over the ground floor, with brick and timber on the left side and back.
 box('white',C.x0,C.x1,G-P.slab,roof,C.z0,C.z1);
 box('slats',C.x0-P.skin,C.x0,G-P.slab,roof,C.z0-P.skin,C.z1);
 box('slats',C.x0,C.x1,G-P.slab,roof,C.z0-P.skin,C.z0);
 // The right-hand pier, from the ground up to the roof canopy it holds.
 box('white',P.pier.x0,P.pier.x1,0,top,C.z1,P.pier.z1);

 // Ground floor: a dark lobby set back under a deep canopy, a timber screen on the side.
 box('lobby',C.x0+.02,C.x1-.02,0,G-P.slab,C.z0+.02,C.z1-.06);
 box('white',C.x0-P.skin,C.x0+.03,0,G-P.slab,C.z0-P.skin,C.z1-.02);
 box('white',C.x0+.03,-.12,0,G-P.slab,C.z1-.08,C.z1-.05);
 box('white',C.x0-P.skin,P.pier.x0,G-P.slab,G,C.z1,.52);
 box('white',C.x0-P.skin,P.pier.x0,G,G+.08,.49,.52);
 box('slats',C.x1-.03,C.x1,0,G-P.slab,C.z0+.02,C.z1-.06);
 panels.push({kind:'gate',x:.04,y:(G-P.slab)/2,z:C.z1-.06+.004,w:.26,h:G-P.slab-.04,face:'front'});
 panels.push({kind:'sign',x:-.27,y:(G-P.slab)*.48,z:C.z1-.05+.004,w:.17,h:.17,face:'front'});
 panels.push({kind:'ceiling',x:(C.x0+P.pier.x0)/2,y:G-P.slab-.003,z:(C.z1+.52)/2,w:P.pier.x0-C.x0,h:.52-C.z1,face:'down'});
 for(let x=C.x0+.03;x<P.pier.x0-.02;x+=.09){
  plants.push({kind:'shrub',x,y:G+.08,z:.505,s:.05});
  plants.push({kind:'trail',x:x+.045,y:G-P.slab-.1,z:.525,s:.11});
 }

 // Upper floors.
 const L=P.left,M=P.middle,sd=P.side;
 for(let i=0;i<P.floors;i++){
  const y0=lines[i],y1=lines[i+1],mid=(y0+y1)/2,pair=Math.floor(i/2)%2;
  // Front left: a balcony, deeper on alternate pairs of floors.
  const out=pair?L.out-.03:L.out;
  if(i>0)box('white',L.x0-.03,L.x1,y0-P.slab,y0,C.z1,out);
  box('rail',L.x0-.03,L.x1,y0,y0+P.rail,out-.015,out);
  panels.push({kind:'glass',x:(L.x0+L.x1)/2,y:mid-.02,z:C.z1+.003,w:L.x1-L.x0-.04,h:S-P.slab-.04,face:'front'});
  // Front middle: a white box frame round a tall window, shifting every two floors.
  const cx=M.x+(pair?-M.shift:M.shift),w=M.w,t=.035,fy0=y0+.01,fy1=y1-.03;
  box('white',cx-w/2,cx+w/2,fy0,fy0+t,C.z1,M.out);
  box('white',cx-w/2,cx+w/2,fy1-t,fy1,C.z1,M.out);
  box('white',cx-w/2,cx-w/2+t,fy0,fy1,C.z1,M.out);
  box('white',cx+w/2-t,cx+w/2,fy0,fy1,C.z1,M.out);
  panels.push({kind:'glass',x:cx,y:(fy0+fy1)/2,z:C.z1+.004,w:w-t*2-.01,h:fy1-fy0-t*2-.01,face:'front'});
  // Planting between the left balconies and the frames.
  plants.push({kind:'trail',x:-.09,y:y0+.06,z:C.z1+.04,s:i%2?.16:.24});
  if(i%2===0)plants.push({kind:'shrub',x:L.x1-.03,y:y0+.01,z:out-.06,s:.05});
  // Side: two bays of cantilevered slabs split by a white fin.
  for(const [b,[z0,z1]] of sd.bays.entries()){
   const o=(b===0?pair:1-pair)?sd.inner:sd.out;
   box('white',C.x1,o,y0-P.slab,y0,z0,z1);
   box('rail',o-.015,o,y0,y0+P.rail,z0,z1);
   panels.push({kind:'glass',x:C.x1+.003,y:mid-.02,z:(z0+z1)/2,w:(z1-z0)*.8,h:S-P.slab-.04,face:'side'});
   panels.push({kind:'ceiling',x:(C.x1+o)/2,y:y1-P.slab-.003,z:(z0+z1)/2,w:o-C.x1,h:z1-z0,face:'down'});
   // Brown louvres on the outer half of the back bay, alternate floors on the front bay.
   if(b===1||i%2)box('slats',C.x1+.02,C.x1+.05,y0+P.rail,y1-P.slab,b===1?z0+.02:z1-.1,b===1?z0+.14:z1-.02);
   if((i+b)%2===0)for(const s of [.3,.8])plants.push({kind:'trail',x:o+.012,y:y0-P.slab-.08,z:z0+(z1-z0)*s,s:.13});
   if((i+b)%2===1)plants.push({kind:'shrub',x:o-.04,y:y0+.01,z:z0+(z1-z0)*.2,s:.05});
  }
  box('white',C.x1,sd.out,y0-P.slab,y1,sd.fin-.02,sd.fin+.02);
  // Back: one window a floor in the brick.
  panels.push({kind:'glass',x:-.05,y:mid,z:C.z0-P.skin-.003,w:.2,h:S*.55,face:'back'});
 }
 // The top floor's slab edges, so the last balconies have ceilings.
 box('white',L.x0-.03,L.x1,roof-P.slab,roof,C.z1,L.out);
 for(const [z0,z1] of sd.bays)box('white',C.x1,sd.out,roof-P.slab,roof,z0,z1);

 // Roof terrace: a parapet of planters, a stair and lift box, and the canopy on slim columns.
 box('white',C.x0,C.x1,roof,roof+P.parapet,C.z1-.03,C.z1);
 box('white',C.x1-.03,C.x1,roof,roof+P.parapet,C.z0,C.z1);
 box('white',-.4,-.06,roof,roof+P.canopy.lift,C.z0,-.12);
 box('white',C.x0-P.skin,P.pier.x1,roof+P.canopy.lift,top,C.z0-P.skin,P.pier.z1);
 box('white',C.x0-P.skin,C.x0+.01,roof,roof+P.canopy.lift,P.pier.z1-.05,P.pier.z1);
 box('dark',C.x0+.01,C.x1-.04,roof+P.canopy.lift-.02,roof+P.canopy.lift,C.z0+.1,C.z1);
 for(let x=C.x0+.05;x<C.x1-.04;x+=.1)plants.push({kind:'shrub',x,y:roof+P.parapet,z:C.z1-.015,s:.045});
 for(let z=C.z0+.05;z<C.z1-.04;z+=.11)plants.push({kind:'shrub',x:C.x1-.015,y:roof+P.parapet,z,s:.045});
 plants.push({kind:'tree',x:.18,y:roof,z:-.28,s:1});
 for(let x=C.x0+.04;x<C.x1;x+=.12)plants.push({kind:'trail',x,y:roof-.06,z:C.z1+.01,s:.1});
 return {lines,roof,top,boxes,panels,plants};
}

/** The parts' extent from the centre, as a fraction of k: the footprint the building keeps. */
export function portfolioSiteReach(p:PortfolioSitePlan){
 let r=0;
 for(const b of p.boxes)r=Math.max(r,Math.abs(b.x0),Math.abs(b.x1),Math.abs(b.z0),Math.abs(b.z1));
 for(const q of p.plants)r=Math.max(r,Math.abs(q.x),Math.abs(q.z));
 return r;
}
