import type {Rect} from './scene';
import type {Pt} from './roads';
import {roundedRoad} from './highway';
import {ACCESS} from './highwayAccess';
export interface CompactParcels {core:Rect;hills:Rect;financial:Rect;stadium:Rect;airport:Rect;/** Circa sits by the highway on purpose, with a tighter gap. */circa?:Rect}
export const CIRCA_HIGHWAY_GAP=2;
/** Smallest axis-aligned square enclosing the complete city, including airport clearances. */
export function squareCityBounds(bounds:{left:number;right:number;top:number;bottom:number}){
 const side=Math.max(bounds.right-bounds.left,bounds.bottom-bounds.top),cx=(bounds.left+bounds.right)/2,cz=(bounds.top+bounds.bottom)/2;
 return {left:cx-side/2,right:cx+side/2,top:cz-side/2,bottom:cz+side/2};
}
export function cityPerimeter(bounds:{left:number;right:number;top:number;bottom:number},..._legacy:[CompactParcels?]){
 const {left,right,top,bottom}=squareCityBounds(bounds);
 const points:Pt[]=[[left,top],[right,top],[right,bottom],[left,bottom],[left,top]];
 return {route:roundedRoad(points,ACCESS.cornerRadius,true),northWest:left};
}
