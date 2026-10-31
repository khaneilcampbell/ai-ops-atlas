import type {Rect,Scene3D} from './scene';
import type {Box,Pt} from './roads';
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
 * green between it and the Skyline park reaches this much further north, so the mall's lot is
 * about twice the Atlas Hills mansion's footprint.
 */
export const MALL_LOT={east:4,north:3} as const;
type Input=Pick<Scene3D,'hills'|'financial'|'stadium'|'dealership'|'parks'|'land'> & {coreLand:Rect[];links:DistrictConnection[];obstacles:Box[]};
/** Adjacent neighborhood streets and public green space use the same routes as the meshes. */
export function planNeighborhoodLinks(s:Input){
 const links:DistrictConnection[]=[],walks:Pt[][]=[],candidates:Rect[]=[],trees:Pt[]=[],core=cityEnvelope(s.coreLand),h=s.hills,d=s.dealership;
 const route=(anchors:Pt[],margin:number):Pt[]|undefined=>{
  const out:Pt[]=[];
  for(let i=1;i<anchors.length;i++){const part=routeAround(anchors[i-1],anchors[i],s.obstacles,margin);if(!part)return;out.push(...part.slice(out.length?1:0));}
  return out;
 };
 if(core&&h&&d){
  const sky=s.parks.find(p=>p.label==='Skyline'),mallRoom=!!sky&&h.z>=sky.z+sky.d&&h.z-sky.z-sky.d<2;
  const start:Pt=[h.x+COMMUNITY.streetX,h.z+1.5],target=d.road[0],east=Math.max(core.x+core.w+.9,start[0])+(mallRoom?MALL_LOT.east:0),walkX=east-.9;
  const road=route([start,[east,start[1]],[east,target[1]],target],.4);
  const walk=route([[h.x+HILLS.walkGateX,h.z+.5],[walkX,h.z+.5],[walkX,d.walk[0][1]],d.walk[0]],.3);
  if(road&&walk){
   links.push({id:'hills-city-boulevard',road,walk});
   // A narrow land-backed local boulevard, not another elevated highway.
   candidates.push({x:east-CITY_SPACING.causewayWidth/2,z:Math.min(start[1],target[1]),w:CITY_SPACING.causewayWidth,d:Math.abs(start[1]-target[1])});
   const skyline=s.parks.find(p=>p.label==='Skyline');
   if(skyline&&h.z>=skyline.z+skyline.d&&h.z-skyline.z-skyline.d<2&&walkX>skyline.x+skyline.w+2){
    const north=mallRoom?MALL_LOT.north:0,green={x:skyline.x+skyline.w,z:skyline.z-north,w:east+CITY_SPACING.causewayWidth/2-skyline.x-skyline.w,d:h.z-skyline.z+north};
    candidates.push(green);
    const promenade:Pt=[skyline.x+skyline.w/2+5.4,skyline.z+skyline.d/2+3.9],gate:Pt=[h.x+HILLS.walkGateX,h.z+.5];
    walks.push([promenade,[walkX,promenade[1]]],[[gate[0],promenade[1]],gate]);
    for(let x=green.x+2.2;x<walkX-1;x+=4)for(let z=green.z+2;z<green.z+green.d-1;z+=4){const p:Pt=[x,z];if([...walks,walk,road].every(path=>distanceToRoad(p,path)>1)&&!s.obstacles.some(b=>Math.abs(x-b.x)<b.w/2+1&&Math.abs(z-b.z)<b.d/2+1))trees.push(p);}
   }
  }
 }
 if(s.financial&&s.stadium){
  const f=s.financial,stadium=s.stadium,outside=stadium.x+stadium.w+1;
  const road=route([f.street[f.street.length-1],[outside,stadium.z+stadium.d/2]],.4),walk=route([f.sidewalk[0],[outside+.6,stadium.z+stadium.d/2+.6]],.3);
  if(road&&walk)links.push({id:'financial-stadium-local',road,walk});
 }
 candidates.push(...shortLandGaps([...s.links,...links].flatMap(l=>[l.road,l.walk]),s.land));
 const land:Rect[]=[];for(const candidate of candidates)land.push(...uncoveredLand(candidate,[...s.land,...land]));
 return {links,land,walks,trees};
}
