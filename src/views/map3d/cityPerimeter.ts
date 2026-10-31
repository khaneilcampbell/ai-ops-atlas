import type {Rect} from './scene';
import type {Pt} from './roads';
import {roundedRoad} from './highway';
import {ACCESS} from './highwayAccess';
export interface CompactParcels {core:Rect;hills:Rect;financial:Rect;stadium:Rect;airport:Rect}
/** Trim the two empty western corners, retaining the original full-size district parcels. */
export function cityPerimeter(bounds:{left:number;right:number;top:number;bottom:number},parcels?:CompactParcels){
 const {left,right,top,bottom}=bounds;
 let northWest=left,southWest=left,northZ=top,southZ=bottom;
 if(parcels){
  const p=parcels,minStep=ACCESS.cornerRadius*2+2;
  const nx=Math.min(p.core.x,p.financial.x,p.stadium.x)-ACCESS.setback,nz=p.airport.z-ACCESS.setback;
  if(nx-left>minStep&&nz-top>minStep){northWest=nx;northZ=nz;}
  const sx=p.hills.x-ACCESS.setback,sz=Math.max(p.airport.z+p.airport.d,p.core.z+p.core.d,p.stadium.z+p.stadium.d,p.financial.z+p.financial.d)+ACCESS.setback;
  if(sx-left>minStep&&bottom-sz>minStep){southWest=sx;southZ=sz;}
 }
 const points:Pt[]=[[northWest,top],[right,top],[right,bottom],[southWest,bottom]];
 if(southWest!==left)points.push([southWest,southZ],[left,southZ]);
 points.push([left,northZ]);if(northWest!==left)points.push([northWest,northZ]);
 if(points[points.length-1][0]!==points[0][0]||points[points.length-1][1]!==points[0][1])points.push(points[0]);
 return {route:roundedRoad(points,ACCESS.cornerRadius,true),northWest};
}
