import type {Rect,Scene3D} from './scene';
import {distanceToRoad} from './highway';
import {TRANSPORT} from './transportScale';
import {COMMUNITY} from './hillsCommunityPlan';
import {stadiumCrown} from './stadiumGeometry';
type Pt=[number,number];
/**
 * One skyline for the stadium centre (Khaneil, 2026-11-09): the wheel's hub sits at the station
 * platform's height and its rim tops out at the stadium roof's crown, so wheel, station and
 * stadium line up. The base scales with the wheel.
 */
const HUB=COMMUNITY.platformRise+.3;
export const WHEEL={hub:HUB,radius:stadiumCrown()-.04-HUB} as const;
export const PLAZA_WHEEL={width:4.1*WHEEL.radius/1.65,depth:1.5} as const;
/** The pavilion's footprint, slab included. */
const PAVILION={w:3.8,d:2.8} as const;
export interface StationPlaza {wheel:{x:number;z:number};building:Rect;bounds:Rect;walk:Pt[];entranceWalk:Pt[]}
/** Keep the wheel and pavilion off every street and its sidewalk; keep the plaza walks from crossing one. */
export const PLAZA_ROAD_CLEARANCE=TRANSPORT.cityWidth/2+.6;
export const PLAZA_WALK_CLEARANCE=TRANSPORT.cityWidth/2+.3;
export function wheelBase(p:StationPlaza):Rect{return {x:p.wheel.x-PLAZA_WHEEL.width/2,z:p.wheel.z-PLAZA_WHEEL.depth/2,w:PLAZA_WHEEL.width,d:PLAZA_WHEEL.depth};}

interface Site {roads?:Pt[][];obstacles?:Rect[];land?:Rect[]}
/** Two arrangements round one anchor: the wheel in front of the pavilion, or beside it. */
function arrange(x:number,z:number,ground:Pt,side:boolean):StationPlaza{
 if(!side)return {wheel:{x,z},building:{x:x-1.9,z:z+5.3,...PAVILION},bounds:{x:x-2.25,z:z-1.05,w:4.5,d:9.5},walk:[[x,z+.8],[x,z+4.3],[ground[0],z+4.3],ground],entranceWalk:[ground,[ground[0],z+8.6],[x,z+8.6],[x,z+8.15]]};
 // Pavilion centred on the anchor; the wheel to its east; one front walk joins both to the station.
 const wx=x+PAVILION.w/2+1.1+PLAZA_WHEEL.width/2,front=z+2.85;
 const x0=Math.min(x-2.25,ground[0]),x1=wx+PLAZA_WHEEL.width/2+.35;
 return {wheel:{x:wx,z},building:{x:x-PAVILION.w/2,z:z-PAVILION.d/2,...PAVILION},bounds:{x:x0,z:z-1.75,w:x1-x0,d:front+.35-(z-1.75)},walk:[[wx,z+.8],[wx,front],[ground[0],front],ground],entranceWalk:[[x,z+1.65],[x,front]]};
}
const inside=(r:Rect,x:number,z:number,m=0)=>x>=r.x-m&&x<=r.x+r.w+m&&z>=r.z-m&&z<=r.z+r.d+m;
const overlaps=(a:Rect,b:Rect,m=0)=>a.x<b.x+b.w+m&&b.x<a.x+a.w+m&&a.z<b.z+b.d+m&&b.z<a.z+a.d+m;
function samples(r:Rect,step=.4):Pt[]{const out:Pt[]=[];const nx=Math.max(1,Math.ceil(r.w/step)),nz=Math.max(1,Math.ceil(r.d/step));for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++)out.push([r.x+r.w*i/nx,r.z+r.d*j/nz]);return out;}
function along(path:Pt[],step=.25):Pt[]{const out:Pt[]=[];for(let i=1;i<path.length;i++){const [a,b]=[path[i-1],path[i]],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));for(let k=0;k<=n;k++)out.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);}return out;}

/** Checks one arrangement against the streets, the station walk, other buildings and the shoreline. */
export function plazaFits(p:StationPlaza,stationWalk:Pt[],site:Site):boolean{
 const roads=site.roads??[],boxes=[wheelBase(p),p.building];
 for(const b of boxes){
  if(site.obstacles?.some(o=>overlaps(b,o,.4)))return false;
  for(const pt of samples(b)){
   if(site.land&&!site.land.some(l=>inside(l,pt[0],pt[1],.001)))return false;
   if(distanceToRoad(pt,stationWalk)<.8)return false;
   if(roads.some(r=>distanceToRoad(pt,r)<PLAZA_ROAD_CLEARANCE))return false;
  }
 }
 // The shared forecourt under wheel and pavilion stays off the streets too.
 for(const pt of samples(p.bounds,.5))if(roads.some(r=>distanceToRoad(pt,r)<PLAZA_WALK_CLEARANCE))return false;
 for(const pt of [...along(p.walk),...along(p.entranceWalk)]){
  if(roads.some(r=>distanceToRoad(pt,r)<PLAZA_WALK_CLEARANCE))return false;
  if(site.land&&!site.land.some(l=>inside(l,pt[0],pt[1],.001)))return false;
 }
 // The walks may not cut through the pavilion or under the wheel.
 const [wb,bb]=[wheelBase(p),p.building];
 for(const pt of along(p.walk))if(inside(bb,pt[0],pt[1],-.05)||(inside(wb,pt[0],pt[1],-.05)&&Math.abs(pt[0]-p.wheel.x)>.3))return false;
 return true;
}

/**
 * The Ferris wheel and station pavilion on open meadow beside Stadium Station, walked to from its
 * ground-level stair: the nearest spot that keeps both off the streets, the stadium lot and other
 * buildings in the current map grouping.
 */
export function planStationPlaza(s:Pick<Scene3D,'stadium'|'communityRail'>,site:Site={}):StationPlaza|undefined {
 const stadium=s.stadium,stop=s.communityRail?.loop?.stops.find(s=>s.id==='service:stadium-station');
 if(!stadium||!stop)return;
 const g=[...stop.walk].reverse().find(p=>p[1]===0);if(!g)return;
 const ground:Pt=[g[0],g[2]],stationWalk=stop.walk.map(p=>[p[0],p[2]] as Pt);
 const lot={x:stadium.x-2,z:stadium.z-2,w:stadium.w+4,d:stadium.d+4};
 const fullSite={...site,obstacles:[...(site.obstacles??[]),lot]};
 // Nearest to the station's stair first, so the walk there stays short in every grouping.
 const candidates:{x:number;z:number;side:boolean;cost:number}[]=[];
 for(let dx=-12;dx<=12;dx+=.25)for(let dz=-12;dz<=12;dz+=.25)for(const side of [false,true])candidates.push({x:ground[0]+dx,z:ground[1]+dz,side,cost:Math.hypot(dx,dz)+(side?1.5:0)});
 candidates.sort((a,b)=>a.cost-b.cost);
 for(const c of candidates){const p=arrange(c.x,c.z,ground,c.side);if(plazaFits(p,stationWalk,fullSite))return p;}
 return;
}
