import type {DistrictConnection} from './connections';
import type {Rect} from './scene';
import {pathClear,ROAD_W,type Box,type Pt} from './roads';
import {RING_ROAD_ID} from './ringRoad';

/**
 * New York style avenues (Khaneil, 2026-11-13): the city's north-south streets run through instead
 * of stopping at a district, so traffic can drive round the city on a grid of avenues and cross
 * streets. Most of each avenue already exists; this only adds the missing stretches that join an
 * existing street to the next one down:
 *
 * - West avenue: the street beside the airport runs on south past Atlas Commons' west side to the
 *   ring road's south side.
 * - Middle avenue: the avenue down from the Financial District continues south from the
 *   Career & Portfolio cross street to the cross street by Security & Infrastructure.
 * - East avenue: the street out to the AI Engineering tower runs on south along the east shore and
 *   turns west onto the Marketplace boulevard, short of Atlas Central Station's stairs.
 *
 * No district or building moves. A stretch is added only where both ends meet an existing street,
 * every point stands on land, and it clears every building by half a road and room for its
 * sidewalk. Where any check fails (other groupings) that stretch is left out.
 */
export const GRID_ID='grid';
/** Clearance from a stretch's centre line to any building: half the road and its sidewalk (STREET_CLEAR). */
export const GRID_CLEAR=ROAD_W/2+.18;
/** A stretch end this close to an existing street meets it. */
const MEET=.05;
/** The first and last bit of a stretch sits in the junction it joins, which the existing street already clears. */
const JUNCTION=ROAD_W+.1;

const near=(a:number,b:number,e=1e-6)=>Math.abs(a-b)<e;
function distToSeg(p:Pt,a:Pt,b:Pt){const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/l));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);}
const onStreet=(p:Pt,streets:Pt[][])=>streets.some(s=>s.slice(1).some((b,i)=>distToSeg(p,s[i],b)<MEET));
const onLand=(p:Pt,land:Rect[])=>land.some(r=>p[0]>=r.x-1e-6&&p[0]<=r.x+r.w+1e-6&&p[1]>=r.z-1e-6&&p[1]<=r.z+r.d+1e-6);

/** The first street met going south (+z) from p, as the z where it is met. */
function southTo(p:Pt,streets:Pt[][],skip:Pt[]):number|undefined{
 let best:number|undefined;
 for(const s of streets){if(s===skip)continue;for(let i=1;i<s.length;i++){
  const a=s[i-1],b=s[i];
  if(near(a[1],b[1])){const [x0,x1]=a[0]<b[0]?[a[0],b[0]]:[b[0],a[0]];if(p[0]>=x0-1e-6&&p[0]<=x1+1e-6&&a[1]>p[1]+1e-6&&(best===undefined||a[1]<best))best=a[1];}
 }}
 return best;
}

/** Is every point of the stretch on land, sampled finely? */
function allOnLand(road:Pt[],land:Rect[]){
 for(let i=1;i<road.length;i++){const a=road[i-1],b=road[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.05);
  for(let k=0;k<=n;k++)if(!onLand([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n],land))return false;}
 return true;
}

/** The stretch less a junction's length at each end, which the existing street already clears. */
function inner(road:Pt[]):Pt[]{
 const len=road.slice(1).reduce((n,b,i)=>n+Math.hypot(b[0]-road[i][0],b[1]-road[i][1]),0);
 if(len<=2*JUNCTION)return [];
 const at=(d:number):Pt=>{for(let i=1;i<road.length;i++){const a=road[i-1],b=road[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d<=l)return [a[0]+(b[0]-a[0])*d/l,a[1]+(b[1]-a[1])*d/l];d-=l;}return road[road.length-1];};
 const out:Pt[]=[at(JUNCTION)];let run=0;
 for(let i=1;i<road.length-1;i++){run+=Math.hypot(road[i][0]-road[i-1][0],road[i][1]-road[i-1][1]);if(run>JUNCTION&&run<len-JUNCTION)out.push(road[i]);}
 out.push(at(len-JUNCTION));
 return out;
}

export interface GridInput{links:DistrictConnection[];bridgeRoads:Pt[][];obstacles:Box[];land:Rect[];financialStreet?:Pt[]}

export function planGridAvenues({links,bridgeRoads,obstacles,land,financialStreet}:GridInput):DistrictConnection[]{
 const by=(id:string)=>links.find(l=>l.id===id)?.road;
 const ringSouth=by(`${RING_ROAD_ID}:south`),boulevard=by('marketplace-city-boulevard');
 // Only on a city whose ring road closes (the by-district layout).
 if(!ringSouth||!boulevard||!financialStreet?.length)return [];
 const streets=[...links.map(l=>l.road),...bridgeRoads].filter(s=>s.length>1);
 const pieces:{id:string;road:Pt[]}[]=[];

 // West avenue: the airport street's corner by Atlas Commons, south to the ring road.
 const skyline=by('skyline-airport');
 if(skyline){
  const corner=skyline.find((p,i)=>i>0&&i<skyline.length-1&&near(p[1],skyline[i-1][1])!==near(p[1],skyline[i+1][1]));
  const z=corner&&southTo(corner,streets,skyline);
  if(corner&&z!==undefined)pieces.push({id:`${GRID_ID}:west-avenue`,road:[corner,[corner[0],z]]});
 }

 // Middle avenue: the avenue down from the Financial District, on south from the cross street
 // it reaches through Commerce to the next cross street.
 const fin=by('financial-district');
 if(fin){
  const x=fin[0][0];
  const corners=bridgeRoads.flatMap(r=>r.filter((p,i)=>i>0&&i<r.length-1&&Math.abs(p[0]-x)<1&&near(p[0],r[i-1][0])&&near(p[1],r[i+1][1])));
  const start=corners.sort((a,b)=>b[1]-a[1])[0];
  const z=start&&southTo(start,streets,[]);
  if(start&&z!==undefined)pieces.push({id:`${GRID_ID}:middle-avenue`,road:[start,[start[0],z]]});
 }

 const valid=(road:Pt[])=>onStreet(road[0],streets)&&onStreet(road[road.length-1],streets)&&allOnLand(road,land)&&pathClear(inner(road),obstacles,GRID_CLEAR);
 const out=pieces.filter(p=>valid(p.road));

 // East avenue: the street out to the easternmost tower ends there; it runs on south along the
 // shore and turns west onto the Marketplace boulevard, as far south as it can go clear of
 // everything (the station stairs on the shore stop it short of the boulevard's corner).
 const ends=bridgeRoads.map(r=>r[0]).filter(p=>!streets.some(s=>s.slice(1).some((b,i)=>distToSeg(p,s[i],b)<1e-6&&!(near(s[0][0],p[0])&&near(s[0][1],p[1])))));
 const east=ends.sort((a,b)=>b[0]-a[0])[0];
 const eastX=Math.max(...boulevard.map(p=>p[0])),southZ=Math.max(...boulevard.map(p=>p[1]));
 if(east&&east[0]>eastX+1)for(let z=southZ;z>east[1]+2*JUNCTION;z-=.25){
  const road:Pt[]=[east,[east[0],z],[eastX,z]];
  if(valid(road)){out.push({id:`${GRID_ID}:east-avenue`,road});break;}
 }

 return out.map(p=>({...p,walk:[]}));
}
