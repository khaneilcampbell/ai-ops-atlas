import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {AIRCRAFT_LAYOUT,AIRPORT_LAYOUT,AIRPORT_PARKED_STANDS,BOARDING_LAYOUT,boardingBridge} from './airport';
import {crewAt,planAirportCrew,planCrewTrains,trainAt} from './airportCrew';
import {FLIGHT_SCHEDULE,fleetPose,SHARED_SLOT} from './flightSchedule';
import {GOLD_JET_BOX,GOLD_JET_EXTENT,goldJetBounds,goldJetMapPose,GOLD_JET_GATE,GOLD_JET_HALF_SPAN,GOLD_JET_OFFICE_ID,GOLD_JET_PASSENGERS,GOLD_JET_PIVOT,GOLD_JET_SCALE,GOLD_JET_SLOT,GOLD_JET_SLOT_OK,goldJetBridgeWalk,goldJetRoute,goldJetState,goldJetWalkers} from './goldJetPlan';
import {JET_CABIN,JET_ROOMS,JET_SEATS,cabinHalfWidth,fitRoute,seatedPassengers} from '../office/goldJetInteriorPlan';

const cycle=FLIGHT_SCHEDULE.cycle;
const states=(step=.25)=>Array.from({length:Math.ceil(cycle/step)},(_,i)=>({t:i*step,s:goldJetState(i*step)}));

describe('gold private jet',()=>{
 it('takes one dedicated loop slot and parks at a jet bridge gate',()=>{
  expect(GOLD_JET_SLOT_OK).toBe(true);
  expect(GOLD_JET_SLOT).not.toBe(SHARED_SLOT);
  // It stands at its gate at some point in every loop, nose-in under the jet bridge.
  expect(Array.from({length:cycle*4},(_,i)=>fleetPose(i/4,GOLD_JET_SLOT)).some(p=>p.y===0&&p.x===GOLD_JET_GATE.x&&p.z===GOLD_JET_GATE.z)).toBe(true);
 });

 it('is bigger than the airliners and scaled about the forward door, so the jet bridge still meets it',()=>{
  expect(GOLD_JET_SCALE).toBeGreaterThan(1);
  const door=[AIRCRAFT_LAYOUT.doorX,0,AIRCRAFT_LAYOUT.doorZ],scaled=door.map((v,i)=>GOLD_JET_PIVOT[i]+(v-GOLD_JET_PIVOT[i])*GOLD_JET_SCALE);
  expect(scaled).toEqual(door);
  expect(GOLD_JET_EXTENT.right-GOLD_JET_EXTENT.left).toBeGreaterThan(2*AIRCRAFT_LAYOUT.halfSpan);
 });

 it('keeps its wing tips clear of the jets at the neighbouring gates',()=>{
  const neighbours=AIRPORT_LAYOUT.gateZ.filter(z=>z!==GOLD_JET_GATE.z).map(z=>Math.abs(z-GOLD_JET_GATE.z));
  for(const d of neighbours)expect(d).toBeGreaterThan(GOLD_JET_HALF_SPAN+AIRCRAFT_LAYOUT.halfSpan+.5);
  expect(AIRPORT_PARKED_STANDS.every(s=>(s.z as number)!==GOLD_JET_GATE.z)).toBe(true);
 });

 it('keeps clear of the ground crew and their baggage trains',()=>{
  const crew=planAirportCrew(),trains=planCrewTrains();
  for(let t=0;t<cycle*2;t+=1){
   const plane=fleetPose(t,GOLD_JET_SLOT);if(plane.y>1.5)continue;
   const people=[...crew.map(c=>crewAt(c,t)).filter(p=>p.visible),...trains.flatMap(tr=>trainAt(tr,t))];
   // In the jet's own frame (nose -z, left wing -x): outside its scaled span and length, with a margin.
   const c=Math.cos(plane.yaw),s=Math.sin(plane.yaw),E=GOLD_JET_EXTENT,m=.2;
   for(const p of people){
    const dx=p.x-plane.x,dz=p.z-plane.z,lx=dx*c-dz*s,lz=dx*s+dz*c;
    expect(lx<E.left-m||lx>E.right+m||lz<E.nose-m||lz>E.tail+m,`${lx.toFixed(2)},${lz.toFixed(2)} at ${t}s`).toBe(true);
   }
  }
 });

 it('lets the passengers off, boards the next group and flies with all of them on board',()=>{
  const all=states();
  const at=(stage:string)=>all.filter(x=>x.s.stage===stage);
  for(const stage of ['taxi','takeoff','flight','approach','landing','taxi-in','deplaning','boarding','pushback'])expect(at(stage).length,stage).toBeGreaterThan(0);
  for(const x of [...at('takeoff'),...at('flight'),...at('approach'),...at('landing'),...at('pushback')])expect(x.s.aboard).toBe(GOLD_JET_PASSENGERS);
  expect(Math.min(...at('deplaning').map(x=>x.s.aboard))).toBe(0);
  expect(Math.max(...at('boarding').map(x=>x.s.aboard))).toBe(GOLD_JET_PASSENGERS);
  // Boarding only ever adds people; and the jet only flies while someone is on board.
  const boarding=at('boarding').sort((a,b)=>a.s.standU-b.s.standU).map(x=>x.s.aboard);for(let i=1;i<boarding.length;i++)expect(boarding[i]).toBeGreaterThanOrEqual(boarding[i-1]);
  for(const x of all)if(fleetPose(x.t,GOLD_JET_SLOT).y>0)expect(x.s.aboard).toBe(GOLD_JET_PASSENGERS);
 });

 it('walks passengers along the jet bridge between the pier and the door, never more than fly',()=>{
  const walk=goldJetBridgeWalk(),bridge=boardingBridge(GOLD_JET_GATE.z);
  expect(walk[0][0]).toBeCloseTo(BOARDING_LAYOUT.fromX+.05);
  expect(Math.hypot(walk[walk.length-1][0]-bridge.door.x,walk[walk.length-1][1]-bridge.door.z)).toBeLessThan(.1);
  let seen=0;
  for(const {s} of states(.1)){
   const w=goldJetWalkers(s);seen=Math.max(seen,w.length);expect(w.length).toBeLessThanOrEqual(GOLD_JET_PASSENGERS);
   if(s.stage!=='boarding'&&s.stage!=='deplaning')expect(w).toHaveLength(0);
   // Everyone walking plus everyone seated is never more than the group.
   if(s.stage==='boarding')expect(w.length+s.aboard).toBeLessThanOrEqual(GOLD_JET_PASSENGERS);
   for(const p of w){expect(p.x).toBeGreaterThanOrEqual(BOARDING_LAYOUT.fromX);expect(p.x).toBeLessThanOrEqual(bridge.endX+.05);}
  }
  expect(seen).toBeGreaterThan(1);
 });

 it('samples a closed route with ground and airborne legs for the in-flight map',()=>{
  const route=goldJetRoute();
  expect(route.some(p=>p.y>1)).toBe(true);expect(route.some(p=>p.y===0)).toBe(true);
  const fit=fitRoute(route,280,190);
  for(const p of route){const [x,y]=fit(p.x,p.z);expect(x).toBeGreaterThanOrEqual(-1e-6);expect(x).toBeLessThanOrEqual(280+1e-6);expect(y).toBeGreaterThanOrEqual(-1e-6);expect(y).toBeLessThanOrEqual(190+1e-6);}
 });
});

describe('selecting the moving gold jet',()=>{
 const airports=[{x:40,z:-12},{x:40,z:-12,west:true}];
 it('follows the jet round the loop instead of staying at its gate',()=>{
  for(const a of airports){
   const spots=new Set<string>();
   for(let t=0;t<cycle;t+=2){
    const p=fleetPose(t,GOLD_JET_SLOT),m=goldJetMapPose(a,t);
    // Same place the airport draws it: the airport's corner plus the pose, mirrored on a west airport.
    expect(m.x).toBeCloseTo(a.west?a.x+AIRPORT_LAYOUT.mirrorWidth-p.x:a.x+p.x);
    expect(m.z).toBeCloseTo(a.z+p.z);expect(m.y).toBe(p.y);
    spots.add(`${Math.round(m.x)},${Math.round(m.z)}`);
   }
   expect(spots.size).toBeGreaterThan(10);
  }
 });
 it('frames the whole jet, wing tips and nose to tail, at any heading',()=>{
  for(const a of airports)for(let t=0;t<cycle;t+=3){
   const p=goldJetMapPose(a,t),b=goldJetBounds(p,a.west),c=Math.cos(p.yaw),s=Math.sin(p.yaw),E=GOLD_JET_EXTENT;
   for(const [lx0,lz] of [[E.left,0],[E.right,0],[0,E.nose],[0,E.tail]]){
    const lx=a.west?-lx0:lx0,x=p.x+lx*c+lz*s,z=p.z-lx*s+lz*c;
    expect(Math.abs(x-b.x)).toBeLessThanOrEqual(b.w/2+1e-6);expect(Math.abs(z-b.z)).toBeLessThanOrEqual(b.d/2+1e-6);
   }
   expect(b.y1-b.y0).toBeCloseTo(GOLD_JET_BOX.h);
  }
 });
 it('draws the selection outline and frames the camera on the live jet',()=>{
  const map=readFileSync(join(__dirname,'Map3D.tsx'),'utf8');
  expect(map).toContain('if (key === GOLD_JET_KEY && scene.airport) return goldJetOutline(scene.airport);');
  expect(map).toContain('if (a?.track && groupRef.current) a.track(groupRef.current);');
  expect(map).toContain('goldJetBounds(live, scene.airport?.west)');
 });
});

describe('gold jet interior',()=>{
 it('seats exactly the passengers on board, in real rooms inside the cabin',()=>{
  expect(seatedPassengers(GOLD_JET_PASSENGERS)).toHaveLength(GOLD_JET_PASSENGERS);
  expect(seatedPassengers(0)).toHaveLength(0);
  expect(JET_SEATS.length).toBeGreaterThanOrEqual(GOLD_JET_PASSENGERS);
  for(const s of JET_SEATS){
   const room=JET_ROOMS.find(r=>r.id===s.room)!;
   expect(s.x).toBeGreaterThanOrEqual(room.x0);expect(s.x).toBeLessThanOrEqual(room.x1);
   expect(Math.abs(s.z)).toBeLessThan(cabinHalfWidth()-.5);
  }
 });
 it('lays the rooms nose to tail without gaps or overlaps',()=>{
  const sorted=[...JET_ROOMS].sort((a,b)=>b.x1-a.x1);
  expect(sorted[0].x1).toBe(JET_CABIN.noseX);expect(sorted[sorted.length-1].x0).toBe(JET_CABIN.tailX);
  for(let i=1;i<sorted.length;i++)expect(sorted[i].x1).toBe(sorted[i-1].x0);
 });
 it('is reached by "Enter aircraft" and routed before the generic interiors',()=>{
  const panel=readFileSync(join(__dirname,'../../components/DetailPanel.tsx'),'utf8');
  expect(panel).toContain('<EnterBuildingButton id={GOLD_JET_OFFICE_ID} label="Enter aircraft"/>');
  const map=readFileSync(join(__dirname,'../Map.tsx'),'utf8');
  expect(map).toContain('lazy(() => import("./office/GoldJetInterior"))');
  expect(map.indexOf('GOLD_JET_OFFICE_ID ?')).toBeLessThan(map.indexOf('startsWith("skyline-business:") ?'));
  expect(GOLD_JET_OFFICE_ID.startsWith('skyline-business:')).toBe(true);
 });
});
