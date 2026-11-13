import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {loopPoint,loopState,stationPoint,stationBoardingPath,LOOP_STATIONS,PERIMETER_RAIL} from './perimeterRailPlan';
import {planLoopPassengers,loopPassengerAt} from './loopPassengers';
import {pathClear} from './roads';
import {airportPoint,AIRPORT_LAYOUT,AIRPORT_LANDING_RUNWAY,airportFootprint} from './airport';
import {financialDimensions} from './financialArchitecture';
import {cityEnvelope} from './citySpacing';

describe('perimeter passenger railway',()=>{
 for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`has one closed track and four accessible stops: ${grouping}`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),p=s.communityRail!.loop!,e=cityEnvelope(s.land)!;
  expect(p).toBeDefined();expect(s.freight).toBeUndefined();
  expect(p.route[0]).toEqual(p.route[p.route.length-1]);expect(p.length).toBeGreaterThan(2*(e.w+e.d)-8*PERIMETER_RAIL.radius);
  expect(new Set(p.stops.map(s=>s.id))).toEqual(new Set(LOOP_STATIONS.map(s=>s.id)));
  expect(p.stops[0].name).toBe('Financial District Station');expect(p.stops.every((s,i)=>i===0||s.distance>p.stops[i-1].distance)).toBe(true);
  const edges=p.route.slice(1).map((b,i)=>[p.route[i].join(','),b.join(',')].sort().join('|'));expect(new Set(edges).size).toBe(edges.length);
  const boxes=[...s.towers,...s.kiosks].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
  boxes.push(...s.financial!.buildings.map(b=>({x:s.financial!.x+b.x,z:s.financial!.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d})));
  expect(pathClear(p.route,boxes,1)).toBe(true);
  // On the land, hugging the shore (Khaneil, 2026-11-13): the deck's outer edge stays on land and the track never strays inland.
  const half=PERIMETER_RAIL.deckWidth/2,onLand=(x:number,z:number)=>s.land.some(r=>x>=r.x-1e-6&&x<=r.x+r.w+1e-6&&z>=r.z-1e-6&&z<=r.z+r.d+1e-6);
  for(let d=0;d<p.length;d+=.5){const q=loopPoint(p,d),nx=Math.cos(q.yaw),nz=-Math.sin(q.yaw);
   const offshore=Math.min(q.x-e.x,e.x+e.w-q.x,q.z-e.z,e.z+e.d-q.z)<0;
   if(grouping==='district')expect(offshore,`offshore at ${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBe(false);
   // Straight shore sections (corners joining an offshore side swing out to the viaduct).
   if(Math.abs(Math.min(q.x-e.x,e.x+e.w-q.x,q.z-e.z,e.z+e.d-q.z)+PERIMETER_RAIL.margin)<1e-3)for(const k of [-half,0,half])expect(onLand(q.x+nx*k,q.z+nz*k),`deck off land at ${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBe(true);
   expect(Math.min(q.x-e.x,e.x+e.w-q.x,q.z-e.z,e.z+e.d-q.z)).toBeLessThan(PERIMETER_RAIL.radius+.01);}
  const lots=[{x:s.mall!.cx,z:s.mall!.cz,w:s.mall!.w,d:s.mall!.d},{x:s.stadium!.x+s.stadium!.w/2,z:s.stadium!.z+s.stadium!.d/2,w:s.stadium!.w,d:s.stadium!.d},...(s.dealership?[{x:s.dealership.lot.x+s.dealership.lot.w/2,z:s.dealership.lot.z+s.dealership.lot.d/2,w:s.dealership.lot.w,d:s.dealership.lot.d}]:[])];
  const gapTo=(b:{x:number;z:number;w:number;d:number},x:number,z:number)=>Math.hypot(Math.max(0,Math.abs(x-b.x)-b.w/2),Math.max(0,Math.abs(z-b.z)-b.d/2));
  for(let d=0;d<p.length;d+=.25){const q=loopPoint(p,d);for(const b of lots)expect(gapTo(b,q.x,q.z)-half,`deck near lot ${JSON.stringify(b)} at ${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBeGreaterThan(PERIMETER_RAIL.clearance-1e-6);}
  const airport=s.airport!,runway=airportPoint(airport,AIRPORT_LAYOUT.runwayX,AIRPORT_LAYOUT.runwayZ),parcel=airportFootprint(airport);
  const landing=airportPoint(airport,AIRPORT_LANDING_RUNWAY.x,AIRPORT_LANDING_RUNWAY.z);
  expect(pathClear(p.route,[{x:runway[0],z:runway[1],w:AIRPORT_LAYOUT.runwayWidth,d:AIRPORT_LAYOUT.runwayLength},{x:landing[0],z:landing[1],w:AIRPORT_LANDING_RUNWAY.width,d:AIRPORT_LANDING_RUNWAY.length}],2)).toBe(true);
  const runwayBoxes=[{x:runway[0],z:runway[1],w:AIRPORT_LAYOUT.runwayWidth,d:AIRPORT_LAYOUT.runwayLength},{x:landing[0],z:landing[1],w:AIRPORT_LANDING_RUNWAY.width,d:AIRPORT_LANDING_RUNWAY.length}];
  for(let d=0;d<p.length;d+=.25){const q=loopPoint(p,d);for(const b of runwayBoxes)expect(gapTo(b,q.x,q.z)-half,`deck near runway at ${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBeGreaterThan(PERIMETER_RAIL.clearance);}
  for(const stop of p.stops){
   const pose=loopPoint(p,stop.distance);expect(pose.x).toBeCloseTo(stop.point[0]);expect(pose.z).toBeCloseTo(stop.point[1]);
   expect(loopState(stop.arrival+3,p)).toMatchObject({distance:stop.distance,station:p.stops.indexOf(stop),doors:1,moving:false});
   const boarding=stationBoardingPath(stop);expect(stop.walk.slice(-4)).toEqual(boarding.slice(1));
   expect(pathClear(stop.walk.filter(p=>p[1]===0).map(p=>[p[0],p[2]]),boxes,.1)).toBe(true);
   const landing=stationPoint(stop,1,5.9);expect(landing[0]).toBeGreaterThan(e.x);expect(landing[0]).toBeLessThan(e.x+e.w);expect(landing[1]).toBeGreaterThan(e.z);expect(landing[1]).toBeLessThan(e.z+e.d);
   expect(pathClear(stop.walk.filter(p=>p[1]===0).map(p=>[p[0],p[2]]),[{x:runway[0],z:runway[1],w:AIRPORT_LAYOUT.runwayWidth,d:AIRPORT_LAYOUT.runwayLength}],1)).toBe(true);
  }
  expect(parcel.z).toBeGreaterThan(s.financial!.z+s.financial!.d);
 });
 it('completes a smooth loop and boards only during fully open station dwell',()=>{
  const s=buildScene(layoutMap(catalog,[],'district')),p=s.communityRail!.loop!,people=planLoopPassengers(p),visited=new Set<number>();
  expect(people).toHaveLength(8);let previous=loopPoint(p,loopState(0,p).distance);
  for(let t=.05;t<=p.period+.1;t+=.05){const state=loopState(t,p),at=loopPoint(p,state.distance);expect(Math.hypot(at.x-previous.x,at.z-previous.z)).toBeLessThan(PERIMETER_RAIL.speed*.051);previous=at;if(state.moving)expect(state.doors).toBe(0);else visited.add(state.station);}
  expect(visited.size).toBe(p.stops.length);
  for(const person of people){
   for(const [time,station]of [[person.board,person.origin],[person.alight,person.destination],[person.returnBoard,person.destination],[person.homeAlight,person.origin]])expect(loopState(time,p)).toMatchObject({station,doors:1,moving:false});
   expect(person.leaveDestination-person.atDestination).toBeGreaterThan(0);expect(person.period+person.leave-person.atHome).toBeGreaterThanOrEqual(10);
   let last:{x:number;z:number}|undefined;
   for(let t=person.leave;t<person.atHome;t+=.1){const at=loopPassengerAt(person,t);if(at.visible){if(last)expect(Math.hypot(at.x-last.x,at.z-last.z)).toBeLessThan(person.pace*.101+.01);last=at;}else last=undefined;}
  }
 });
});
