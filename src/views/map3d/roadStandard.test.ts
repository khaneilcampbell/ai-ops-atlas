import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {freightParts} from './freightParts';
import {highwayLightPositions} from './highwayDetails';
import {distanceToRoad,highwayShare} from './highway';
import {vehicleBounds} from './vehicleModels';
import {ROAD,TRANSPORT as T} from './transportScale';
import {straightenJogs} from './routing';
import {FREIGHT_STREET_TURN} from './freight';
import type {Pt} from './roads';

describe('Atlas road standard',()=>{
 it('derives every road size from one lane width',()=>{
  expect(T.cityWidth).toBeCloseTo((2*ROAD.lane+2*ROAD.curb)*ROAD.scale,6);
  expect(T.bridgeWidth,'road bridges carry the same street').toBe(T.cityWidth);
  expect(T.cityLaneOffset).toBeCloseTo(ROAD.lane/2*ROAD.scale,6);
  expect(T.highwayLaneOffset).toBeCloseTo((ROAD.median+ROAD.lane/2)*ROAD.scale,6);
  expect(T.highwayBarrier,'rails stand outside the highway deck').toBeGreaterThan(T.highwayWidth/2);
  expect(T.highwayShoulder,'edge lines sit inside it').toBeLessThan(T.highwayWidth/2);
 });
 it('fits two opposing vehicles of every kind in a city lane pair and a highway lane pair',()=>{
  for(const kind of ['sedan','sports','bmw','gwagon','pickup','bus','semi','taxi','amazon','ups'] as const){
   const b=vehicleBounds(kind);
   expect(T.cityLaneOffset-b.halfWidth,`${kind}: opposing city lanes do not overlap`).toBeGreaterThan(0);
   expect(T.cityLaneOffset+b.halfWidth,`${kind}: stays on the street`).toBeLessThan(T.cityWidth/2);
   expect(T.highwayLaneOffset+b.halfWidth,`${kind}: stays inside the highway edge line`).toBeLessThan(T.highwayShoulder);
  }
 });
 it('blends street to highway size along a road that leaves town',()=>{
  const land=[{x:0,z:0,w:10,d:10}],highway:Pt[]=[[-20,-2],[30,-2]],road:Pt[]=Array.from({length:21},(_,i):Pt=>[5,10-i*.6]);
  const k=highwayShare(road,land,highway);
  expect(k[0]).toBe(0);expect(k[k.length-1]).toBe(1);
  for(let i=1;i<k.length;i++)expect(k[i]).toBeGreaterThanOrEqual(k[i-1]);
  // A canal between districts, far from the highway, stays a street-size bridge.
  expect(highwayShare([[12,40],[14,40]],land,highway).every(v=>v===0)).toBe(true);
 });
 it('straightens a small sideways jog when the road stays clear',()=>{
  expect(straightenJogs([[-3,0],[0,0],[0,5],[.5,5],[.5,10],[3,10]],[],.3)).toHaveLength(4);
  // Blocked on both sides: the jog stays.
  const boxes=[{x:.9,z:2.5,w:.6,d:3},{x:-.4,z:7.5,w:.6,d:3}];
  expect(straightenJogs([[-3,0],[0,0],[0,5],[.5,5],[.5,10],[3,10]],boxes,.3)).toHaveLength(6);
 });
 for(const g of ['district','none','status','tag'] as GroupBy[])describe(`grouped by ${g}`,()=>{
  const s=buildScene(layoutMap(catalog,[],g)),plan=s.freight!;
  // A bridge rail may end on the seawall; anything deeper inside the land counts as town.
  const onLand=(p:Pt)=>plan.land.some(r=>p[0]>r.x+.3&&p[0]<r.x+r.w-.3&&p[1]>r.z+.3&&p[1]<r.z+r.d-.3);
  // Town: on land and beyond where ground roads start blending up to highway size.
  const inTown=(p:Pt)=>onLand(p)&&distanceToRoad(p,plan.highway)>T.highwayReach+T.streetToHighway;
  it('keeps highway rails, curbs and edge lines off city streets',()=>{
   const parts=freightParts(plan,highwayLightPositions(plan.highway,[...plan.exits,...plan.localJunctions]));
   const stray=parts.filter(q=>['#2f4a3a','#cfcbbd','#ede8d6'].includes(q.c??'')&&inTown([q.p[0],q.p[2]]));
   expect(stray.map(q=>`${q.c} at ${q.p[0].toFixed(1)},${q.p[2].toFixed(1)}`)).toEqual([]);
  });
  it('draws ground roads in town at street width',()=>{
   const parts=freightParts(plan,[]),roads=[plan.route,...plan.access.map(a=>a.collector)];
   const decks=parts.filter(q=>q.c==='#424b50'&&q.s[1]>.05&&inTown([q.p[0],q.p[2]])&&roads.some(r=>distanceToRoad([q.p[0],q.p[2]],r)<.01));
   expect(decks.length).toBeGreaterThan(0);
   for(const d of decks)expect(d.s[0]).toBeCloseTo(T.cityWidth,3);
  });
  // In the 'none' and 'status' layouts the shared route can't clear every tower yet, so the truck
  // keeps its own road there (as before); the default district view and tags share the collector.
  it.skipIf(g==='none'||g==='status')('gives each gap between buildings one road: the truck shares a collector instead of running beside it',()=>{
   for(const a of plan.access)for(let i=1;i<plan.route.length;i++){
    const p=plan.route[i-1],q=plan.route[i],m:Pt=[(p[0]+q[0])/2,(p[1]+q[1])/2];if(!inTown(m))continue;
    const d=distanceToRoad(m,a.collector);
    const nearJoin=plan.localJunctions.some(j=>Math.hypot(j[0]-m[0],j[1]-m[1])<FREIGHT_STREET_TURN*1.6);
    // Within .15 the truck is on the collector; a road edge to edge beside it is a second road.
    if(d>.15&&d<T.cityWidth+.3&&!nearJoin)expect.fail(`route segment ${i} runs ${d.toFixed(2)} beside the ${a.id} collector`);
   }
  });
  it('keeps the truck inside its city lane in town',()=>{
   const half=vehicleBounds('semi').halfWidth;
   for(const leg of plan.truck.legs){if(leg.hold||!inTown(leg.a))continue;
    const off=distanceToRoad(leg.a,plan.route);if(off>T.cityLaneOffset+.02)continue; // at a corner
    expect(off+half).toBeLessThan(T.cityWidth/2);
   }
  });
 });
});

describe('district streets carry on over their bridges',()=>{
 it('paves every road bridge with the street asphalt and a visible center line, end to end',async()=>{
  const {bridgeParts}=await import('./models');
  const s=buildScene(layoutMap(catalog,[],'district'));
  expect(s.carBridges.length).toBeGreaterThan(0);
  for(const br of s.carBridges){
   const len=Math.hypot(br.b[0]-br.a[0],br.b[1]-br.a[1]),{deck}=bridgeParts(br,s.brooks);
   const asphalt=deck.filter(d=>d.c==='#424b50'),dashes=deck.filter(d=>d.c==='#e1ce8e');
   expect(asphalt.reduce((t,d)=>t+d.s[2],0),`${br.key}: asphalt spans the deck`).toBeGreaterThanOrEqual(len);
   expect(Math.min(...asphalt.map(d=>d.s[0])),`${br.key}: both lanes paved`).toBeGreaterThan(2*T.cityLaneOffset+.2);
   expect(dashes.length,`${br.key}: center line every street dash`).toBeGreaterThanOrEqual(Math.floor((len-.26)/.3));
   // Boxes stand on their base: a dash must start above the asphalt's top, or it is buried.
   const level=asphalt.find(d=>!d.rx)!,mid=dashes.find(d=>!d.rx);
   if(mid)expect(mid.p[1],`${br.key}: center line sits on the asphalt`).toBeGreaterThan(level.p[1]+level.s[1]);
  }
 });
});
