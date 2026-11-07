import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {loopPoint,loopState,stationPoint,stationBoardingPath,LOOP_STATIONS,PERIMETER_RAIL} from './perimeterRailPlan';
import {planLoopPassengers,loopPassengerAt} from './loopPassengers';
import {pathClear} from './roads';
import {airportPoint,AIRPORT_LAYOUT,airportFootprint} from './airport';
import {financialDimensions} from './financialArchitecture';
import {cityEnvelope} from './citySpacing';

describe('perimeter passenger railway',()=>{
 for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`has one closed track and five accessible stops: ${grouping}`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),p=s.communityRail!.loop!,e=cityEnvelope(s.land)!;
  expect(p).toBeDefined();expect(s.freight!.highway).toEqual([]);expect(s.freight!.access).toEqual([]);
  expect(p.route[0]).toEqual(p.route[p.route.length-1]);expect(p.length).toBeGreaterThan(4*e.w);
  expect(new Set(p.stops.map(s=>s.id))).toEqual(new Set(LOOP_STATIONS.map(s=>s.id)));
  expect(p.stops[0].name).toBe('Financial District Station');expect(p.stops.every((s,i)=>i===0||s.distance>p.stops[i-1].distance)).toBe(true);
  const edges=p.route.slice(1).map((b,i)=>[p.route[i].join(','),b.join(',')].sort().join('|'));expect(new Set(edges).size).toBe(edges.length);
  const boxes=[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
  boxes.push(...s.financial!.buildings.map(b=>({x:s.financial!.x+b.x,z:s.financial!.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d})));
  expect(pathClear(p.route,boxes,1)).toBe(true);
  const airport=s.airport!,runway=airportPoint(airport,AIRPORT_LAYOUT.runwayX,AIRPORT_LAYOUT.runwayZ),parcel=airportFootprint(airport);
  expect(pathClear(p.route,[{x:runway[0],z:runway[1],w:AIRPORT_LAYOUT.runwayWidth,d:AIRPORT_LAYOUT.runwayLength}],2)).toBe(true);
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
  expect(people).toHaveLength(10);let previous=loopPoint(p,loopState(0,p).distance);
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
