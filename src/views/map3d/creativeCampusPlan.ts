import type {Rect} from './scene';
import type {Pt} from './roads';
import {distanceToRoad} from './highway';

/**
 * Atlas Creative Campus (Khaneil, 2026-11-24): an original arts campus on a new island of its own in
 * the open water west of the airport, joined to the city by one road and walk bridge. Nothing on the
 * main island moves: the island is kept out of the planners' shared land, and the bridge's road
 * continues the street that already ends at the south-west meadow.
 *
 * The building follows Khaneil's reference board: three wings radiating from a round central atrium
 * (a star or "Y" plan, the south wing kinked), white sawtooth fins on every long face, tilted dark red
 * glass blocks at the wing ends, red ribbon ramps and stair bands, a stepped plaza, lawns and trees in
 * the courtyards, and sports fields, courts and a car park beside it.
 *
 * One map unit is ten metres. Pure: built from the finished city plan, tested without WebGL.
 */
export const CAMPUS_KEY='service:creative-campus';
export const CAMPUS_NAME='Atlas Creative Campus';

export const CAMPUS={
 /** Island size (x by z) and the open water kept between it and the city's shore. */
 island:{w:34,d:36},strait:5,
 /** Where the bridge reaches the island, from its north edge. */
 bridgeAt:29,
 /** The atrium's centre on the island, from its north-west corner. */
 centre:[13,15.5] as Pt,
 storeys:5,storey:.56,parapet:.14,
 wingW:2.2,
 /** Central atrium: glass drum, its height and the low skylight cone on top. */
 atrium:{r:1.7,h:3.3,cone:.7},
 /** Each wing: segments from the atrium out, as a heading in degrees (0 east, 90 south) and a length.
  *  The first segment starts at `from` (inside the atrium drum). */
 wings:[
  {id:'west',name:'West wing',from:1,segments:[{heading:-165,length:9}]},
  {id:'east',name:'East wing',from:1,segments:[{heading:-25,length:8.6}]},
  {id:'south',name:'South wing',from:1,segments:[{heading:100,length:4.6},{heading:58,length:5.2}]},
 ],
 /** Tilted red glass block at each wing end: length along the wing, height, lean outward (degrees). */
 endBlock:{length:2.6,h:3.5,lean:14,wide:.3},
 /** Sawtooth fins: tooth pitch along the face, depth out from the wall, and the share of each tooth
  *  the folded white panel covers (the rest shows the storey-tall glass behind it). */
 fin:{pitch:.34,depth:.3,blade:.74},
 /** Ground storey pulled in under the wings near the atrium (pilotis), as a share of each wing. */
 pilotis:{share:.42,inset:.32},
 /** Bridge deck: height above the ground where it crosses the shore rail, width, ramp lengths. */
 bridge:{rise:1.15,width:1.5,rampCity:4,rampIsland:3.5},
 road:{width:.9,walk:.35},
} as const;

export type WingId=typeof CAMPUS.wings[number]['id'];
/** One straight bar of a wing: its centre line, width, and which part it is. */
export interface WingBar{wing:WingId;index:number;a:Pt;b:Pt;dir:Pt;length:number;width:number;
 /** True on the wing's last bar, which ends in the red glass block. */
 last:boolean}
export interface Court{kind:'pitch'|'basketball'|'volleyball'|'badminton';rect:Rect}
export interface CreativeCampusPlan{
 /** New land: the island and two headlands that break its outline. */
 land:Rect[];
 island:Rect;
 /** Atrium centre (world). */
 cx:number;cz:number;
 bars:WingBar[];
 /** Bounding box of the building (world), for selection and the camera. */
 footprint:Rect;
 courts:Court[];
 parking:Rect;
 /** The road from the city street over the bridge to the drop-off, west to east is reversed: points in order from the island. */
 road:Pt[];
 /** Bridge deck span over water and the rail: island shore x, city shore x, the z it runs along. */
 bridge:{x0:number;x1:number;z:number;deck:number};
 /** Where the road meets the city's street (its existing end). */
 cityJoin:Pt;
 /** Stepped plaza fanning out from the atrium between the south and east wings: one arc band per step,
  *  inner and outer radius and its angle span (radians, clear of both wings), highest at the atrium. */
 plaza:{steps:{r0:number;r1:number;a0:number;a1:number}[];top:number;fall:number};
 /** Courtyard lawns and the tree the red ribbon loops round. */
 loopTree:Pt;
 paths:Pt[][];
 trees:Pt[];
 /** Main entrance on the plaza side of the atrium. */
 entry:Pt;
}

const rad=(deg:number)=>deg*Math.PI/180;
const add=(p:Pt,d:Pt,k:number):Pt=>[p[0]+d[0]*k,p[1]+d[1]*k];
const overlaps=(a:Rect,b:Rect,pad=0)=>a.x<b.x+b.w+pad&&a.x+a.w+pad>b.x&&a.z<b.z+b.d+pad&&a.z+a.d+pad>b.z;
const inside=(r:Rect,x:number,z:number,pad=0)=>x>=r.x-pad&&x<=r.x+r.w+pad&&z>=r.z-pad&&z<=r.z+r.d+pad;

/** The wing bars around a centre: each segment's centre line from its start to its end. */
export function wingBars(c:Pt):WingBar[]{
 const out:WingBar[]=[];
 for(const w of CAMPUS.wings){
  let at=c,first=true;
  w.segments.forEach((s,i)=>{
   const dir:Pt=[Math.cos(rad(s.heading)),Math.sin(rad(s.heading))],a=first?add(at,dir,w.from):at,b=add(at,dir,(first?w.from:0)+s.length);
   out.push({wing:w.id,index:i,a,b,dir,length:Math.hypot(b[0]-a[0],b[1]-a[1]),width:CAMPUS.wingW,last:i===w.segments.length-1});
   at=b;first=false;
  });
 }
 return out;
}

/** A bar's four plan corners (start-left, end-left, end-right, start-right), `grow` added all round. */
export function barCorners(b:WingBar,grow=0):Pt[]{
 const n:Pt=[-b.dir[1],b.dir[0]],h=b.width/2+grow,a=add(b.a,b.dir,-grow),e=add(b.b,b.dir,grow);
 return [add(a,n,-h),add(e,n,-h),add(e,n,h),add(a,n,h)];
}
/** Whether a plan point is inside a bar (grown by pad). */
export function inBar(b:WingBar,p:Pt,pad=0){
 const v:Pt=[p[0]-b.a[0],p[1]-b.a[1]],along=v[0]*b.dir[0]+v[1]*b.dir[1],across=-v[0]*b.dir[1]+v[1]*b.dir[0];
 return along>=-pad&&along<=b.length+pad&&Math.abs(across)<=b.width/2+pad;
}
/** Whether a plan point is inside the building: a wing bar or the atrium drum. */
export function inBuilding(p:CreativeCampusPlan|{cx:number;cz:number;bars:WingBar[]},q:Pt,pad=0){
 return Math.hypot(q[0]-p.cx,q[1]-p.cz)<=CAMPUS.atrium.r+pad||p.bars.some(b=>inBar(b,q,pad));
}
/** Height of the building's main roof above the ground. */
export const campusRoof=()=>CAMPUS.storeys*CAMPUS.storey+CAMPUS.parapet;

export interface CampusSite{
 /** The finished city land (scene.land before the campus), its envelope's west edge is the shore. */
 land:Rect[];
 /** Street centre lines (district connections). */
 roads:Pt[][];
 /** Everything on the main island the new road must stay clear of: airport, terraces, plazas, buildings. */
 obstacles:Rect[];
 /** The shore rail's route, which the bridge crosses high. */
 rail?:Pt[];
}

/**
 * The street end the bridge road continues: a street's end point on the city's west half whose
 * straight run west to the shore is clear of every obstacle. The southernmost wins: the open meadow south of the runways.
 */
export function campusJoin(site:CampusSite,shoreX:number):Pt|undefined{
 const ends=site.roads.flatMap(r=>r.length>1?[r[0],r[r.length-1]]:[]);
 const clear=(p:Pt)=>{
  const run:Rect={x:shoreX,z:p[1]-CAMPUS.road.width,w:p[0]-shoreX,d:CAMPUS.road.width*2};
  // The street's own sidewalk ends beside its end point, so obstacles touching the end itself do not count.
  const end:Rect={x:p[0]-1,z:p[1]-1,w:2,d:2};
  if(run.w<=0||site.obstacles.some(o=>overlaps(run,o)&&!overlaps(end,o)))return false;
  // No other street crosses the run (it would need a junction the city does not have).
  return !site.roads.some(r=>r.some((q,i)=>i>0&&segmentHits(r[i-1],q,run,p)));
 };
 return ends.filter(clear).sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];
}
function segmentHits(a:Pt,b:Pt,run:Rect,end:Pt){
 // Ignore the street the run continues from.
 if((Math.abs(a[0]-end[0])<1e-6&&Math.abs(a[1]-end[1])<1e-6)||(Math.abs(b[0]-end[0])<1e-6&&Math.abs(b[1]-end[1])<1e-6))return false;
 const box:Rect={x:Math.min(a[0],b[0]),z:Math.min(a[1],b[1]),w:Math.abs(b[0]-a[0]),d:Math.abs(b[1]-a[1])};
 return overlaps(box,{x:run.x,z:run.z,w:run.w-.05,d:run.d});
}

/**
 * The campus plan, or undefined when the city has no street that can reach the west shore (other
 * groupings), so the island is simply left out.
 */
export function planCreativeCampus(site:CampusSite):CreativeCampusPlan|undefined{
 if(!site.land.length)return;
 const shoreX=Math.min(...site.land.map(r=>r.x));
 const join=campusJoin(site,shoreX);if(!join)return;
 const C=CAMPUS,x1=shoreX-C.strait,x0=x1-C.island.w,z0=join[1]-C.bridgeAt;
 const island:Rect={x:x0,z:z0,w:C.island.w,d:C.island.d};
 const L=(lx:number,lz:number):Pt=>[x0+lx,z0+lz];
 const R=(lx:number,lz:number,w:number,d:number):Rect=>({x:x0+lx,z:z0+lz,w,d});
 // Headlands: a tongue on the west shore and one on the north, so the island is not a plain square.
 const land=[island,R(-2.5,9,2.5,13),R(5,-2,11,2)];
 const [cx,cz]=L(...C.centre),bars=wingBars([cx,cz]);
 const pts=bars.flatMap(b=>barCorners(b,C.endBlock.wide+Math.tan(rad(C.endBlock.lean))*C.endBlock.h));
 const fx0=Math.min(cx-C.atrium.r,...pts.map(p=>p[0])),fx1=Math.max(cx+C.atrium.r,...pts.map(p=>p[0]));
 const fz0=Math.min(cz-C.atrium.r,...pts.map(p=>p[1])),fz1=Math.max(cz+C.atrium.r,...pts.map(p=>p[1]));
 const footprint:Rect={x:fx0,z:fz0,w:fx1-fx0,d:fz1-fz0};
 // Fields on the east side, toward the bridge: a full-size pitch (60 x 90 m), then the courts.
 const courts:Court[]=[
  {kind:'pitch',rect:R(24.5,1.5,6,9.5)},
  {kind:'basketball',rect:R(24,12.6,2.9,1.6)},
  {kind:'volleyball',rect:R(27.6,12.7,1.9,1.1)},
  {kind:'badminton',rect:R(24.2,15,1.5,.8)},{kind:'badminton',rect:R(26.1,15,1.5,.8)},{kind:'badminton',rect:R(28,15,1.5,.8)},
 ];
 const parking=R(24.5,18.6,7.5,6.4);
 // Road: from the drop-off at the plaza east along the bridge line, over the strait and the shore
 // rail, then on along the meadow to the city street's end.
 const bz=join[1],drop=L(19.5,C.bridgeAt);
 const road:Pt[]=[drop,[x1,bz],[shoreX,bz],join];
 const deck=C.bridge.rise;
 // Stepped plaza in the courtyard between the south and east wings, falling toward the drop-off.
 const east=C.wings.find(w=>w.id==='east')!.segments[0].heading,south=C.wings.find(w=>w.id==='south')!.segments[0].heading,clear=C.wingW/2+.25;
 const steps=Array.from({length:7},(_,k)=>{const r0=C.atrium.r+.35+k*.58,r1=r0+.58;return {r0,r1,a0:rad(east)+Math.asin(Math.min(1,clear/r0)),a1:rad(south)-Math.asin(Math.min(1,clear/r0))};});
 const loopTree=L(7.6,20.6);
 const entry:Pt=L(C.centre[0]+1.4,C.centre[1]+1.6);
 const paths:Pt[][]=[
  [L(19.5,C.bridgeAt-.6),L(17.2,22.2)],
  [L(22.6,C.bridgeAt),L(22.6,parking.z-z0+parking.d)],
  [L(23.2,11.6),L(23.2,17.2),L(24.4,17.2)],
  [L(9.5,24.2),L(16.6,25.4)],
 ];
 const plan:CreativeCampusPlan={land,island,cx,cz,bars,footprint,courts,parking,road,bridge:{x0:x1,x1:shoreX,z:bz,deck},cityJoin:join,plaza:{steps,top:.42,fall:.06},loopTree,paths,trees:[],entry};
 plan.trees=campusTrees(plan);
 return plan;
}

/** Trees round the island's edge and in the courtyards, clear of the building, fields, road and paths. */
function campusTrees(p:CreativeCampusPlan):Pt[]{
 const out:Pt[]=[],I=p.island,keep=(t:Pt)=>!inBuilding(p,t,.9)&&!p.courts.some(c=>inside(c.rect,t[0],t[1],.6))&&!inside(p.parking,t[0],t[1],.4)
  &&distanceToRoad(t,p.road.slice(0,2))>1.1&&!p.paths.some(path=>distanceToRoad(t,path)<.7)&&!inPlaza(p,t,.5)
  &&Math.hypot(t[0]-p.loopTree[0],t[1]-p.loopTree[1])>1.6;
 const ring=(inset:number,step:number)=>{
  for(let x=I.x+inset;x<=I.x+I.w-inset;x+=step)for(const z of [I.z+inset,I.z+I.d-inset])out.push([x,z]);
  for(let z=I.z+inset+step;z<=I.z+I.d-inset-step;z+=step)for(const x of [I.x+inset,I.x+I.w-inset])out.push([x,z]);
 };
 ring(.9,2.2);
 // North courtyard between the west and east wings, and the south-west lawn round the ribbon loop.
 for(const [dx,dz] of [[-2,-4.2],[0,-5.6],[2.2,-4.4],[-4.4,-6],[4.6,-6.6],[-6.2,3.2],[-3.6,5.2],[-7.8,6.4]] as const)out.push([p.cx+dx,p.cz+dz]);
 return out.filter(keep).filter(t=>p.land.some(r=>inside(r,t[0],t[1],-.5)));
}

/** Whether a plan point is on the stepped plaza. */
export function inPlaza(p:CreativeCampusPlan,q:Pt,pad=0){
 const r=Math.hypot(q[0]-p.cx,q[1]-p.cz),a=Math.atan2(q[1]-p.cz,q[0]-p.cx);
 return p.plaza.steps.some(s=>r>=s.r0-pad&&r<=s.r1+pad&&a>=s.a0-pad/r&&a<=s.a1+pad/r);
}

/** The road's run on the city's island: from the shore to the street end, for keeping trees off it. */
export function campusCityRoad(p:CreativeCampusPlan):Pt[]{return [[p.bridge.x1,p.bridge.z],p.cityJoin];}
