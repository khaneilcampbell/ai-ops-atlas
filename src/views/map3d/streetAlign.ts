import type {DistrictConnection} from './connections';
import {pathClear,ROAD_W,type Box,type Pt} from './roads';

/**
 * One street per corridor (KC, 2026-11-09: "the road marking over the street is the issue ... keep
 * the street design consistent"). Links are routed one at a time, each with its own clearance, so two
 * links heading the same way could end up a few centimetres apart: two overlapping carriageways with
 * two sets of centre dashes, junction squares and zebras, and one link's walk painted down the middle
 * of the other's road. This snaps every straight run that overlaps an earlier one onto it, so the
 * corridor draws as one street, then moves any walk that would sit on a street out to the side.
 * A move is kept only when the path still clears every building, and a path's two ends (gates,
 * doors, junctions it was routed to) never move.
 */
export const STREET_ALIGN={
 /** Parallel runs closer than this share one carriageway: a road's width. */
 road:ROAD_W,
 /** A walk closer than this to a street's centre is on the carriageway or its sidewalk. */
 walkClear:ROAD_W/2+.18+.06,
 /** Where such a walk goes instead, as the district links lay walks beside their roads. */
 walkSide:.6,
 /** Parallel walks closer than this would overlap: a walk's width. */
 walk:.48,
} as const;

interface Run {x:boolean;c:number;lo:number;hi:number}
const run=(a:Pt,b:Pt):Run|undefined=>{
 if(Math.abs(a[1]-b[1])<1e-9&&Math.abs(a[0]-b[0])>1e-9)return {x:true,c:a[1],lo:Math.min(a[0],b[0]),hi:Math.max(a[0],b[0])};
 if(Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])>1e-9)return {x:false,c:a[0],lo:Math.min(a[1],b[1]),hi:Math.max(a[1],b[1])};
};
const overlap=(r:Run,o:Run)=>r.x===o.x&&Math.min(r.hi,o.hi)-Math.max(r.lo,o.lo)>.05;
/**
 * Set a run's cross coordinate. Its neighbours are perpendicular, so they only stretch or shrink.
 * Refused, leaving the path as it was, for a run at either end or when the path would hit a building.
 */
const place=(path:Pt[],i:number,r:Run,c:number,boxes:Box[],margin:number)=>{
 if(i===0||i+1===path.length-1)return false;
 const k=r.x?1:0,was=[path[i][k],path[i+1][k]],old:Pt[]=[[path[i][0],path[i][1]],[path[i+1][0],path[i+1][1]]];
 path[i][k]=c;path[i+1][k]=c;
 // What is new: the moved run, and the stretch each perpendicular neighbour gains to reach it. The
 // rest of the path is judged where it was routed (a neighbour may end at a gate inside a keep-out).
 if(pathClear([path[i],path[i+1]],boxes,margin)&&pathClear([old[0],path[i]],boxes,margin)&&pathClear([old[1],path[i+1]],boxes,margin)){r.c=c;return true;}
 path[i][k]=was[0];path[i+1][k]=was[1];return false;
};
const tidy=(path:Pt[])=>path.filter((p,i)=>!i||Math.hypot(p[0]-path[i-1][0],p[1]-path[i-1][1])>1e-9);

export function alignStreets<L extends DistrictConnection>(links:L[],boxes:Box[]=[]):L[]{
 const A=STREET_ALIGN,roads:Run[]=[],walks:Run[]=[];
 const out=links.map(l=>({...l,road:l.road.map(p=>[p[0],p[1]] as Pt),walk:l.walk.map(p=>[p[0],p[1]] as Pt)}));
 for(const l of out){
  for(let i=1;i<l.road.length;i++){
   const r=run(l.road[i-1],l.road[i]);if(!r)continue;
   const to=roads.find(o=>overlap(r,o)&&Math.abs(o.c-r.c)>1e-9&&Math.abs(o.c-r.c)<A.road);
   if(to)place(l.road,i-1,r,to.c,boxes,.3);
   roads.push(r);
  }
  l.road=tidy(l.road);
 }
 for(const l of out){
  for(let i=1;i<l.walk.length;i++){
   const r=run(l.walk[i-1],l.walk[i]);if(!r)continue;
   const street=roads.find(o=>overlap(r,o)&&Math.abs(o.c-r.c)<A.walkClear);
   // Out to the side it was nearer, else the other side if that one is blocked.
   if(street){const side=r.c<street.c?-1:1;if(!place(l.walk,i-1,r,street.c+side*A.walkSide,boxes,.23))place(l.walk,i-1,r,street.c-side*A.walkSide,boxes,.23);}
   const beside=walks.find(o=>overlap(r,o)&&Math.abs(o.c-r.c)>1e-9&&Math.abs(o.c-r.c)<A.walk);
   if(beside)place(l.walk,i-1,r,beside.c,boxes,.23);
   walks.push(r);
  }
  l.walk=tidy(l.walk);
 }
 return out;
}
