import type {DistrictConnection} from './connections';
import {routeAround} from './routing';
import {pathClear,ROAD_W,type Box,type Pt} from './roads';

/**
 * The city ring road (KC, 2026-11-08): one closed loop of streets around the whole city, so traffic
 * can always drive on round instead of turning back. Most of it already exists: the west road past
 * Atlas Stadium, the Financial District street along the north, BMW's short spur, and the Marketplace
 * boulevard down the east side. This adds the two missing pieces that close the loop: north-east from
 * BMW's spur down to the boulevard, and along the south past the Marketplace back to the west road.
 * Each piece is added only where it clears every building by a street's width plus its sidewalks.
 */
export const RING_ROAD_ID='ring-road';
/** Clearance from a piece's centre line to any building: half the road, a sidewalk and a little air. */
const RING_CLEAR=ROAD_W/2+.18+.06;

export function planRingRoad(links:DistrictConnection[],financialStreet:Pt[]|undefined,obstacles:Box[]):DistrictConnection[]{
 const by=(id:string)=>links.find(l=>l.id===id)?.road;
 const west=by('financial-stadium-local'),bmw=by('bmw-dealership'),east=by('marketplace-city-boulevard');
 if(!west||!bmw||!east||!financialStreet?.length)return [];
 const northZ=financialStreet[0][1];
 const westEnd:Pt=west[west.length-1];
 const westX=westEnd[0];
 // The west road runs south from the Financial District street, then turns west to the stadium:
 // the ring's south side meets the far end of that north-south stretch.

 const bmwX=Math.max(...bmw.map(p=>p[0]));
 // The boulevard: its north arm along z, the east side along x, and its south arm.
 const eastX=Math.max(...east.map(p=>p[0]));
 const eastNorthZ=Math.min(...east.filter(p=>Math.abs(p[0]-eastX)<1e-6).map(p=>p[1]));
 const southZ=Math.max(...east.map(p=>p[1]));
 const southStart=east.filter(p=>Math.abs(p[1]-southZ)<1e-6).sort((a,b)=>a[0]-b[0])[0];
 if(!southStart||bmw.every(p=>Math.abs(p[1]-northZ)>1e-6))return [];
 // Only where the west road reaches down close to the boulevard's south arm (the by-district city).
 const southOk=westEnd[1]>northZ&&westX<eastX;
 const pieces:{id:string;road:Pt[]}[]=[
  // North-east: from the end of BMW's spur down to the boulevard's north arm.
  {id:`${RING_ROAD_ID}:north-east`,road:[[bmwX,northZ],[bmwX,eastNorthZ]]},
  // South: from the boulevard's south-west end west to the west road, joining it end to end.
  ...(southOk?[{id:`${RING_ROAD_ID}:south`,road:[southStart,[westX,southZ],...(Math.abs(westEnd[1]-southZ)>1e-6?[westEnd]:[])] as Pt[]}]:[]),
 ];
 // Repacking can lengthen the south link or put a parcel on its direct path.
 for(const p of pieces)if(!pathClear(p.road,obstacles,RING_CLEAR)){
  p.road=routeAround(p.road[0],p.road[p.road.length-1],obstacles,RING_CLEAR)??[];
 }
 // All or nothing: a ring that cannot close adds no stubs.
 const ok=southOk&&eastNorthZ>northZ&&pieces.every(p=>p.road.length>1&&p.road.every(q=>Number.isFinite(q[0])&&Number.isFinite(q[1]))&&pathClear(p.road,obstacles,RING_CLEAR));
 return ok?pieces.map(p=>({...p,walk:[]})):[];
}
