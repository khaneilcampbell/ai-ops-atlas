import type {Tower} from './scene';
import {headquartersEnvelope} from './financialPlan';

/**
 * The Intelligence Hub (the intelligence-hub HQ) as a ribbed white corner building: the street
 * corner cut on a diagonal and every corner softly rounded, white vertical-fin cladding, thin
 * black reveal bands at every floor that swell outward round the corner, one deep rounded
 * loggia bay per floor on the corner with a long planter of trailing green, rounded black-framed
 * windows on the side faces, upper floors cantilevered over a set-back glass ground floor with a
 * rounded soffit, and a rear wing that steps down two floors to a planted roof.
 * Design reference: KC's "Modern Residential Building" screenshots, 2026-11-08 (closest match:
 * the white corner render, with the black render's warm light lines between floors at night).
 *
 * Plain data in the tower's own frame: x across, y up from the plinth top (FLOOR_BASE), z toward
 * the front. Horizontal sizes are fractions of the tower's footprint `k`; heights are world units.
 * The renderer is IntelligenceHub.tsx; the meshes are intelligenceHubGeometry.ts.
 */
export const INTELLIGENCE_HUB={
 projectId:'intelligence-hub',
 /**
  * Roof height as a share of the Financial District's reference height (headquartersEnvelope),
  * so it stands among the Financial towers and rises with them. The shortest Financial tower is
  * 1.08 of the reference and Atlas HQ's roof is 1.0 of it; the GitHub crown is .97.
  */
 share:.9,
 /** The diagonal cut on the corner the map looks at (+x, +z), along each face, and the corner rounding. */
 chamfer:.3,
 radius:.075,
 /** The ground floor: this tall, set back this far under the cantilevered floors. */
 ground:{h:.62,inset:.07},
 /** The rounded soffit slab the upper floors stand on, and how far it swells out. */
 soffit:{h:.11,out:.012},
 /** A storey aims for this height; the count is whatever fills the tower evenly. */
 storey:.46,
 /** The plain parapet storey of fins above the top floor line. */
 parapet:.32,
 /** The rear wing (z below `from`) stops this many floors short, with a planted roof. */
 rear:{from:-.12,drop:2},
 /** Black reveal band at every floor: this tall, out this far on the faces, further on the corner. */
 band:{h:.032,out:.016,corner:.07},
 /** The corner loggia: share of the corner face and storey, frame projection and thickness. */
 bay:{width:.8,height:.74,depth:.07,frame:.05,radius:.06},
 /** Windows per face: centres along the face (0 one end, 1 the other), width share of k, height share of storey. */
 windows:{
  front:{at:[.28,.72],w:.12,h:.6},
  side:{at:[.5],w:.2,h:.56},
  rearSide:{at:[.5],w:.17,h:.56},
  back:{at:[.3,.7],w:.13,h:.56},
  frame:.018,depth:.01,
 },
 /** Cladding fins: one every this many world units round the building. */
 fin:.045,
} as const;

export const isIntelligenceHub=(projectId:string)=>projectId===INTELLIGENCE_HUB.projectId;

/** Roof height above the plinth top for a Financial reference height. */
export const intelligenceHubHeight=(reference:number)=>reference*INTELLIGENCE_HUB.share;

/** Give the Intelligence Hub its height from every tower's plain height (before any custom height). */
export function sizeIntelligenceHub(towers:Tower[]){
 const reference=headquartersEnvelope(towers);
 for(const t of towers)if(isIntelligenceHub(t.projectId))t.customHeight=intelligenceHubHeight(reference);
}

export type Pt=[number,number];
/** A face of the plan: from a to b (x, z in world units), with its outward normal. */
export interface Face {a:Pt;b:Pt;n:Pt;len:number}
export interface Bay {x:number;z:number;angle:number;y0:number;y1:number;w:number}
export interface Win {x:number;z:number;angle:number;y0:number;y1:number;w:number}
export interface IntelligenceHubPlan {
 k:number;height:number;storeys:number;storey:number;ground:number;
 /** The full plan and the front block's plan (above the rear wing), as polygons in x, z. */
 outline:Pt[];front:Pt[];
 /** Top of the upper floors' first floor line, the rear wing's roof, the main roof. */
 base:number;rearTop:number;roof:number;
 /** y of each floor line (the bands), bottom up. */
 lines:number[];
 bays:Bay[];windows:Win[];
}

/** The plan polygon (counter-clockwise from above, +x right, +z front), cut at z=zMin. */
export function hubOutline(k:number,zMin=-.5):Pt[]{
 const c=INTELLIGENCE_HUB.chamfer,h=.5;
 return ([[-h,zMin],[h,zMin],[h,h-c],[h-c,h],[-h,h]] as Pt[]).map(([x,z])=>[x*k,z*k]);
}

/** Each face of a polygon, with its outward normal (the polygon runs counter-clockwise seen from above with z toward the viewer). */
export function faces(poly:Pt[]):Face[]{
 return poly.map((a,i)=>{
  const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
  return {a,b,len,n:[dz/len,-dx/len] as Pt};
 });
}

/**
 * Move each face of a convex polygon out by its own distance and return the new corners: a
 * uniform offset inflates the plan, a bigger one on one face makes the band swell there.
 */
export function offsetPolygon(poly:Pt[],out:number[]):Pt[]{
 const fs=faces(poly);
 return poly.map((_,i)=>{
  const f0=fs[(i-1+fs.length)%fs.length],f1=fs[i],o0=out[(i-1+fs.length)%fs.length],o1=out[i];
  // Intersect the two offset lines: p = a + n*o + t*dir.
  const p0:Pt=[f0.a[0]+f0.n[0]*o0,f0.a[1]+f0.n[1]*o0],d0:Pt=[(f0.b[0]-f0.a[0])/f0.len,(f0.b[1]-f0.a[1])/f0.len];
  const p1:Pt=[f1.a[0]+f1.n[0]*o1,f1.a[1]+f1.n[1]*o1],d1:Pt=[(f1.b[0]-f1.a[0])/f1.len,(f1.b[1]-f1.a[1])/f1.len];
  const den=d0[0]*d1[1]-d0[1]*d1[0];
  if(Math.abs(den)<1e-9)return p1;
  const t=((p1[0]-p0[0])*d1[1]-(p1[1]-p0[1])*d1[0])/den;
  return [p0[0]+d0[0]*t,p0[1]+d0[1]*t];
 });
}

/**
 * Lay out the building for footprint k and roof height `height` (above the plinth top): a
 * ground floor, then storeys of equal height up to the parapet, the rear wing two floors short.
 */
export function planIntelligenceHub(k:number,height:number):IntelligenceHubPlan{
 const I=INTELLIGENCE_HUB,ground=I.ground.h;
 const storeys=Math.max(6,Math.round((height-ground-I.parapet)/I.storey)),storey=(height-ground-I.parapet)/storeys;
 const outline=hubOutline(k),front=hubOutline(k,I.rear.from);
 const lines=Array.from({length:storeys+1},(_,i)=>ground+i*storey);
 const rearTop=lines[storeys-I.rear.drop]+.12;
 const bays:Bay[]=[],windows:Win[]=[];
 const corner=faces(outline)[2],cx=(corner.a[0]+corner.b[0])/2,cz=(corner.a[1]+corner.b[1])/2;
 const angle=(f:Face)=>Math.atan2(f.n[0],f.n[1]);
 const along=(f:Face,s:number):Pt=>[f.a[0]+(f.b[0]-f.a[0])*s,f.a[1]+(f.b[1]-f.a[1])*s];
 const [south,east,,north,west]=faces(outline);
 const W=I.windows;
 for(let i=0;i<storeys;i++){
  const y0=lines[i],mid=y0+storey/2;
  bays.push({x:cx,z:cz,angle:angle(corner),w:corner.len*I.bay.width,y0:mid-storey*I.bay.height/2,y1:mid+storey*I.bay.height/2});
  const add=(f:Face,set:{at:readonly number[];w:number;h:number},from=0,to=1)=>{
   for(const s of set.at){const [x,z]=along(f,from+(to-from)*s);windows.push({x,z,angle:angle(f),w:set.w*k,y0:mid-storey*set.h/2,y1:mid+storey*set.h/2});}
  };
  // The +z face runs from the -x corner to the chamfer; the +x face from the back to the chamfer.
  add(north,W.front);
  const split=(I.rear.from+.5)/(1-I.chamfer);
  add(east,W.side,split,1);
  if(i<storeys-I.rear.drop){add(east,W.rearSide,0,split);add(west,W.back);add(south,W.back);}
  else{
   // Above the rear wing, the front block's back and west walls still get windows.
   const fwest=faces(front)[4];add(fwest,{at:[.5],w:W.back.w,h:W.back.h});
   const fback=faces(front)[0];add(fback,W.back);
  }
 }
 return {k,height,storeys,storey,ground,outline,front,base:ground,rearTop,roof:height,lines,bays,windows};
}

/** Height of the building's highest point above the plinth top: its roof garden's trees. */
export const intelligenceHubTop=(height:number)=>height+.32;
