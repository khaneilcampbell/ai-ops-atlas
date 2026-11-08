import {airportTrafficKeepOut} from './airport';
import {openLot} from './openLot';
import type {Rect,Scene3D} from './scene';
import {pathClear,type Box,type Pt} from './roads';
import type {DistrictConnection} from './connections';
import {CITY_SPACING,cityEnvelope,overlapsParcel} from './citySpacing';
import {routeAround} from './routing';
import {distanceToRoad} from './highway';
import {HILLS} from './hillsPlan';
import {COMMUNITY} from './hillsCommunityPlan';

/** Subtract occupied terrain, so adjoining parcels share edges rather than overlapping slabs. */
export function uncoveredLand(candidate:Rect,occupied:Rect[]):Rect[]{
 let pieces=[candidate];
 for(const r of occupied)pieces=pieces.flatMap(p=>{
  if(!overlapsParcel(p,r))return [p];
  const x0=Math.max(p.x,r.x),x1=Math.min(p.x+p.w,r.x+r.w),z0=Math.max(p.z,r.z),z1=Math.min(p.z+p.d,r.z+r.d);
  return [{x:p.x,z:p.z,w:x0-p.x,d:p.d},{x:x1,z:p.z,w:p.x+p.w-x1,d:p.d},{x:x0,z:p.z,w:x1-x0,d:z0-p.z},{x:x0,z:z1,w:x1-x0,d:p.z+p.d-z1}].filter(v=>v.w>.001&&v.d>.001);
 });
 return pieces;
}
function shortLandGaps(paths:Pt[][],land:Rect[]):Rect[]{
 const out:Rect[]=[],width=CITY_SPACING.causewayWidth;
 for(const path of paths)for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],vertical=a[0]===b[0],axis=vertical?1:0,line=a[1-axis],lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]);
  const ranges=land.filter(r=>line>=(vertical?r.x:r.z)&&line<=(vertical?r.x+r.w:r.z+r.d)).map(r=>[Math.max(lo,vertical?r.z:r.x),Math.min(hi,vertical?r.z+r.d:r.x+r.w)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  let end:number|undefined;
  for(const [start,stop]of ranges){
   if(end!==undefined&&start>end+.001&&start-end<=CITY_SPACING.maxCausewayGap)out.push(vertical?{x:line-width/2,z:end,w:width,d:start-end}:{x:end,z:line-width/2,w:start-end,d:width});
   end=Math.max(end??stop,stop);
  }
 }
 return out;
}
/**
 * Room for the Atlas Marketplace: the boulevard runs this much further east of the city, and the
 * green between it and the open lot reaches north to the city's terraces (or this far, if none),
 * so the mall's lot is about twice the Atlas Hills mansion's footprint and joins the city.
 */
/** minWidth: park edge to boulevard centre when the catalog shrinks, room for the full-size mall (MALL.maxW) plus its gaps. */
export const MALL_LOT={east:4,north:3,minWidth:14} as const;
type Input=Pick<Scene3D,'airport'|'hills'|'financial'|'stadium'|'parks'|'land'|'carBridges'|'paving'> & {marketplace?:Rect;coreLand:Rect[];links:DistrictConnection[];obstacles:Box[]};
/** The original grid's easternmost street end and the nearest open plaza, where the Hills boulevard joins the city. */
export function cityEastAccess(s:Pick<Scene3D,'carBridges'|'paving'>,obstacles:Box[]):{road:Pt;walk:Pt}|undefined{
 const streets=s.carBridges.flatMap(b=>b.roads).flat();if(!streets.length)return;
 const road=streets.reduce((a,b)=>b[0]>a[0]?b:a),target:Pt=[road[0]+6,road[1]+1.1];
 const walk=s.paving.map(p=>[p.x+p.w/2,p.z+p.d/2] as Pt).filter(p=>!obstacles.some(b=>Math.abs(p[0]-b.x)<b.w/2+.3&&Math.abs(p[1]-b.z)<b.d/2+.3))
  .sort((a,b)=>Math.hypot(a[0]-target[0],a[1]-target[1])-Math.hypot(b[0]-target[0],b[1]-target[1]))[0];
 return walk&&{road,walk};
}
/**
 * Where a building stands across the boulevard's last stretch (the wider Intelligence Hub district puts its tower at the
 * city street's end), routeAround steps round it in two short jogs beside the plaza, under the pedestrian walk. End the
 * boulevard at that building's edge instead, straight on (KC, 2026-11-08): the plaza lane round the headquarters, which
 * the street graph already joins, carries traffic the last few metres to the city street.
 */
export function straighten(road:Pt[]|undefined,start:Pt,east:number,target:Pt,obstacles:Box[],margin:number):Pt[]|undefined{
 if(!road||road.length<=5)return road;
 const [lo,hi]=[Math.min(east,target[0]),Math.max(east,target[0])];
 const across=obstacles.filter(b=>Math.abs(b.z-target[1])<b.d/2+margin&&b.x+b.w/2>lo&&b.x-b.w/2<hi);
 if(!across.length)return road;
 const edge=east>target[0]?Math.max(...across.map(b=>b.x+b.w/2+margin)):Math.min(...across.map(b=>b.x-b.w/2-margin));
 const pts:Pt[]=[start,[east,start[1]],[east,target[1]],[edge,target[1]]];
 return pathClear(pts,obstacles,margin)?pts.filter((p,k)=>!k||Math.hypot(p[0]-pts[k-1][0],p[1]-pts[k-1][1])>1e-9):road;
}
/** Adjacent neighborhood streets and public green space use the same routes as the meshes. */
export function planNeighborhoodLinks(s:Input){
 const links:DistrictConnection[]=[],walks:Pt[][]=[],candidates:Rect[]=[],trees:Pt[]=[],raised:Rect[]=[],core=cityEnvelope(s.coreLand),h=s.marketplace??s.hills,d=cityEastAccess(s,s.obstacles);
 const route=(anchors:Pt[],margin:number):Pt[]|undefined=>{
  const out:Pt[]=[];
  for(let i=1;i<anchors.length;i++){const part=routeAround(anchors[i-1],anchors[i],s.obstacles,margin);if(!part)return;out.push(...part.slice(out.length?1:0));}
  return out;
 };
 if(core&&h&&d){
  const sky=openLot(s.parks),mallRoom=!!sky&&h.z>=sky.z+sky.d&&h.z-sky.z-sky.d<2;
  const start:Pt=[h.x+COMMUNITY.streetX,h.z+1.5],target=d.road,east=Math.max(core.x+core.w+.9,start[0],mallRoom?sky.x+sky.w+MALL_LOT.minWidth-MALL_LOT.east:-Infinity)+(mallRoom?MALL_LOT.east:0),walkX=east-.9;
  const road=straighten(route([start,[east,start[1]],[east,target[1]],target],.4),start,east,target,s.obstacles,.4);
  const walk=route([[h.x+HILLS.walkGateX,h.z+.5],[walkX,h.z+.5],[walkX,d.walk[1]],d.walk],.3);
  if(road&&walk){
   links.push({id:s.marketplace?'marketplace-city-boulevard':'hills-city-boulevard',road,walk});
   // A narrow land-backed local boulevard, not another elevated highway.
   candidates.push({x:east-CITY_SPACING.causewayWidth/2,z:Math.min(start[1],target[1]),w:CITY_SPACING.causewayWidth,d:Math.abs(start[1]-target[1])});
   const lot=sky;
   if(lot&&h.z>=lot.z+lot.d&&h.z-lot.z-lot.d<2&&walkX>lot.x+lot.w+2){
    const x0=lot.x+lot.w,x1=east+CITY_SPACING.causewayWidth/2;
    // The green runs north until it meets the city's own terraces, so the Marketplace lot, the open
    // lot and the city are one landmass with no channel between them.
    const above=s.coreLand.filter(r=>r.x<x1&&r.x+r.w>x0+1.5&&r.z+r.d<=lot.z+.01).map(r=>r.z+r.d);
    const top=mallRoom?(above.length?Math.max(...above):lot.z-MALL_LOT.north):lot.z;
    const green={x:x0,z:top,w:x1-x0,d:h.z-top};
    candidates.push(green);
    // Low city land inside the green (old channel edges) is lifted to the green's height, so the
    // open lot, the Marketplace lot and the city meet level, with no walls or gaps between them.
    for(const r of s.land){const x0=Math.max(r.x,green.x),x1=Math.min(r.x+r.w,green.x+green.w),z0=Math.max(r.z,green.z),z1=Math.min(r.z+r.d,green.z+green.d);if(x1-x0>.001&&z1-z0>.001)raised.push({x:x0,z:z0,w:x1-x0,d:z1-z0});}
    // The walk starts near the open lot's south-east corner, where Skyline's promenade ended.
    const promenade:Pt=[lot.x+lot.w/2+5.4,lot.z+lot.d/2+3.9],gate:Pt=[h.x+HILLS.walkGateX,h.z+.5];
    walks.push([promenade,[walkX,promenade[1]]],[[gate[0],promenade[1]],gate]);
    for(let x=green.x+2.2;x<walkX-1;x+=4)for(let z=green.z+2;z<green.z+green.d-1;z+=4){const p:Pt=[x,z];if([...walks,walk,road].every(path=>distanceToRoad(p,path)>1)&&!s.obstacles.some(b=>Math.abs(x-b.x)<b.w/2+1&&Math.abs(z-b.z)<b.d/2+1))trees.push(p);}
   }
  }
 }
 if(s.financial&&s.stadium){
  if(s.airport)s={...s,obstacles:[...s.obstacles,airportTrafficKeepOut(s.airport)]};
  const f=s.financial,stadium=s.stadium,outside=stadium.x+stadium.w+1;
  const road=route([f.street[f.street.length-1],[outside,stadium.z+stadium.d/2]],.4),walk=route([f.sidewalk[0],[outside+.6,stadium.z+stadium.d/2+.6]],.3);
  if(road&&walk)links.push({id:'financial-stadium-local',road,walk});
 }
 candidates.push(...shortLandGaps([...s.links,...links].flatMap(l=>[l.road,l.walk]),s.land));
 const land:Rect[]=[];for(const candidate of candidates)land.push(...uncoveredLand(candidate,[...s.land,...land]));
 return {links,land,walks,trees,raised};
}
