import {it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {airportPoint} from './airport';
import {AIRPORT_BUILDINGS} from './airportBuildings';
import {COMMUNITY_BUILDINGS} from './hillsCommunityPlan';
import {HILLS} from './hillsPlan';
import {headquartersEnvelope} from './financialPlan';
import {financialDimensions} from './financialArchitecture';
import {fleetPose,FLIGHT_SCHEDULE} from './flightSchedule';
import {flightClearance,airportFlightCircuit,privateJetPose,FLIGHT_CLEARANCE as C} from './flightClearance';

for(const group of ['none','district','status','tag'] as GroupBy[])it(`clears every building after takeoff in ${group} grouping`,()=>{
 const s=buildScene(layoutMap(catalog,[],group)),a=s.airport!,safe=flightClearance(s),circuit=airportFlightCircuit(a,s.bounds,safe.altitude);
 const buildings=[
  ...s.towers.map(t=>({id:t.key,x:t.x,z:t.z,w:t.size+.7,d:t.size+.7,h:headquartersEnvelope([t])})),
  ...s.financial!.buildings.map(b=>({id:b.id,x:s.financial!.x+b.x,z:s.financial!.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d,h:b.height+financialDimensions(b.id).top})),
  ...[...s.kiosks,...s.retail].map(b=>({id:b.key,x:b.x,z:b.z,w:b.size,d:b.size,h:8})),
  ...AIRPORT_BUILDINGS.map(b=>{const [x,z]=airportPoint(a,b.x,b.z);return {id:b.id,x,z,w:b.w,d:b.d,h:b.h+1};}),
  ...COMMUNITY_BUILDINGS.map(b=>({id:b.id,x:s.community!.x+b.x,z:s.community!.z+b.z,w:b.w,d:b.d,h:b.h+1})),
  {id:'mansion',x:s.hills!.x+HILLS.mansion.x,z:s.hills!.z+HILLS.mansion.z,w:HILLS.mansion.w,d:HILLS.mansion.d,h:HILLS.mansion.h+1},
  {id:'bmw',x:s.dealership!.x+5,z:s.dealership!.z+2.1,w:7.6,d:3.2,h:7},
  ...s.parks.map(p=>({id:p.id,x:p.x+p.w/2,z:p.z+p.d/2,w:4.5,d:1.2,h:5.1})),
 ];
 expect(safe.altitude).toBeGreaterThan(Math.max(...buildings.map(b=>b.h))+2);
 for(let t=0;t<75;t+=.1){const p=privateJetPose(s.bounds,safe.altitude,t);expect(p.y-.2).toBeGreaterThan(Math.max(...buildings.map(b=>b.h))+2);}
 for(let t=0;t<FLIGHT_SCHEDULE.cycle;t+=.05){
  const p=fleetPose(t,0,circuit);if(!p.visible||p.y<=.05)continue;
  const [x,z]=airportPoint(a,p.x,p.z);
  const hit=buildings.find(b=>Math.abs(x-b.x)<b.w/2+C.aircraftRadius&&Math.abs(z-b.z)<b.d/2+C.aircraftRadius&&p.y-.2<b.h);
  expect(hit?.id,`collision at t=${t.toFixed(2)} (${x},${p.y},${z})`).toBeUndefined();
  const next=fleetPose(t+.01,0,circuit);if(next.visible)expect(Math.hypot(p.x-next.x,p.y-next.y,p.z-next.z)).toBeLessThan(.3);
 }
});
it('raises the corridor when future towers grow, with no fixed Financial District altitude',()=>{
 const s=buildScene(layoutMap(catalog,[],'none')),before=flightClearance(s);s.financial!.buildings[0].height=40;expect(flightClearance(s).altitude).toBeGreaterThan(44);expect(flightClearance(s).altitude).toBeGreaterThan(before.altitude);
});

it('also respects tall repositories not yet in the catalog',()=>{const s=buildScene(layoutMap(catalog,[],'none'));s.strays.push({key:'new-tower',name:'Future tower',x:0,z:0,size:3,height:50});expect(flightClearance(s).altitude).toBeGreaterThan(54);});
