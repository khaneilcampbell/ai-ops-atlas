import {describe,expect,it} from 'vitest';
import {AIRCRAFT_LAYOUT,AIRPORT_LAYOUT,AIRPORT_REMOTE_STANDS} from './airport';
import {CREW_KEEP_OUT,SERVED_GATES,crewAt,crewLimit,crewPeriod,outsideKeepOut,planAirportCrew,planCrewTrains,trainAt,trainDistance} from './airportCrew';
import {FLIGHT_SCHEDULE,fleetPose} from './flightSchedule';

const crew=planAirportCrew(),trains=planCrewTrains();
/** Every crew member and every tug or cart, sampled across ten minutes of airport clock. */
function everyone(step=.5,until=600){
 const out:{id:string;t:number;x:number;z:number}[]=[];
 for(let t=0;t<until;t+=step){
  for(const c of crew){const p=crewAt(c,t);if(p.visible)out.push({id:c.id,t,x:p.x,z:p.z});}
  for(const tr of trains)trainAt(tr,t).forEach((p,k)=>out.push({id:`${tr.id}:${k}`,t,x:p.x,z:p.z}));
 }
 return out;
}

describe('airport ground crew',()=>{
 it('plans a crew for both served gates, a marshaller and the cargo shed',()=>{
  for(const role of ['fueler','loader','pushback','wingwalker','walker','marshaller','cargo'])expect(crew.some(c=>c.role===role)).toBe(true);
  expect(crew.filter(c=>c.role==='fueler')).toHaveLength(SERVED_GATES.length);
  expect(new Set(crew.map(c=>c.id)).size).toBe(crew.length);
  expect(trains).toHaveLength(SERVED_GATES.length+1);
 });

 it('never steps onto the runway, the taxiway or the takeoff queue',()=>{
  const runwayEdge=AIRPORT_LAYOUT.runwayX-AIRPORT_LAYOUT.runwayWidth/2;
  for(const p of everyone()){
   expect(outsideKeepOut(p.x),`${p.id} at ${p.t}s`).toBe(true);
   expect(p.x).toBeLessThan(runwayEdge-2);
  }
 });

 it('keeps clear of every aircraft taxiing, queueing or taking off',()=>{
  const people=everyone(1,FLIGHT_SCHEDULE.cycle*2);
  for(let t=0;t<FLIGHT_SCHEDULE.cycle*2;t+=1)for(let slot=0;slot<FLIGHT_SCHEDULE.count;slot++){
   const plane=fleetPose(t,slot);
   if(!plane.visible||plane.y>1.5)continue;
   for(const p of people.filter(q=>q.t===t)){
    const clear=Math.hypot(p.x-plane.x,p.z-plane.z);
    expect(clear,`${p.id} vs slot ${slot} at ${t}s`).toBeGreaterThan(AIRCRAFT_LAYOUT.halfSpan+.2);
   }
  }
 });

 it('keeps the keep-out line outside a queued jet\'s wing tip',()=>{
  expect(CREW_KEEP_OUT.x).toBeLessThan(AIRPORT_LAYOUT.taxiX-AIRCRAFT_LAYOUT.halfSpan);
 });

 it('stays out of the remote stands and the other gates\' aircraft',()=>{
  const parked=[...AIRPORT_REMOTE_STANDS];
  for(const p of everyone(1,300))for(const s of parked)expect(Math.hypot(p.x-s.x,p.z-s.z)).toBeGreaterThan(AIRCRAFT_LAYOUT.halfLength);
 });

 it('walkers go out and come back, hiding only inside the terminal',()=>{
  const walker=crew.find(c=>c.role==='walker')!,period=crewPeriod(walker);
  const hidden=crewAt(walker,-walker.offset+.1);
  expect(hidden.visible).toBe(false);
  const there=crewAt(walker,-walker.offset+period/2);
  expect(there.visible).toBe(true);
  expect(crewAt(walker,1.23).x).toBeCloseTo(crewAt(walker,1.23+period).x,6);
 });

 it('baggage trains park at the hold for the dwell, then drive on',()=>{
  const t=trains[0],arrive=(t.stopAt/t.pace)-t.offset;
  expect(trainDistance(t,arrive+1)).toBeCloseTo(t.stopAt,6);
  expect(trainDistance(t,arrive+t.dwell-1)).toBeCloseTo(t.stopAt,6);
  expect(trainDistance(t,arrive+t.dwell+2)).toBeGreaterThan(t.stopAt);
  const parked=trainAt(t,arrive+2)[0];
  expect(Math.abs(parked.x-(AIRPORT_LAYOUT.gateX+.85))).toBeLessThan(.05);
 });

 it('draws fewer extra crew as quality drops and halves them on Battery saver',()=>{
  const n=crew.length;
  expect(crewLimit(n,{qualityLevel:0,saver:false})).toBe(n);
  expect(crewLimit(n,{qualityLevel:3,saver:false})).toBeLessThan(crewLimit(n,{qualityLevel:1,saver:false}));
  expect(crewLimit(n,{qualityLevel:0,saver:true})).toBe(7+Math.round((n-7)/2));
  expect(crewLimit(n,{qualityLevel:3,saver:true})).toBeGreaterThanOrEqual(7);
 });
});

describe('airport ground crew and the terminal',()=>{
 it('only appear or vanish at a door in the pier face, inside the pier\'s length',async()=>{
  const {TERMINAL_PIER}=await import('./airportTerminal');
  for(const c of crew.filter(m=>m.role==='walker')){
   const door=c.path[0];
   expect(door[0]).toBeCloseTo(TERMINAL_PIER.x+TERMINAL_PIER.width/2,6);
   const end=(TERMINAL_PIER.width+.4)/2;
   expect(door[1]).toBeGreaterThan(TERMINAL_PIER.from+end);
   expect(door[1]).toBeLessThan(TERMINAL_PIER.to-end);
  }
 });
 it('walk and drive outside the pier and its jet-bridge rotundas',async()=>{
  const {TERMINAL_PIER}=await import('./airportTerminal');
  const face=TERMINAL_PIER.x+TERMINAL_PIER.width/2;
  for(const p of everyone(1,300)){
   const besidePier=p.z>=TERMINAL_PIER.from-.6&&p.z<=TERMINAL_PIER.to+.6;
   if(besidePier)expect(p.x,`${p.id} at ${p.t}s`).toBeGreaterThanOrEqual(face-1e-6);
   for(const gz of AIRPORT_LAYOUT.gateZ){
    const off=Math.hypot(p.x-(face+.1),p.z-(gz+AIRCRAFT_LAYOUT.doorZ));
    expect(off,`${p.id} at ${p.t}s by the gate ${gz} rotunda`).toBeGreaterThan(.18);
   }
  }
 });
});
