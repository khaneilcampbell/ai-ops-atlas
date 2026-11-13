import { describe, expect, it } from "vitest";
import {AIRPORT_LAYOUT as AL2,AIRPORT_REMOTE_STANDS,AIRPORT_SERVICE_DOOR,AIRPORT_SERVICE_GATE,airportPoint} from './airport';
import {AIRPORT_BUILDINGS} from './airportBuildings';
import {buildScene} from './scene';
import {layoutMap} from '../mapLayout';
import {catalog} from '../../catalog';
import {distanceToRoad} from './highway';
import {AIRPORT_END_TAXIWAYS,AIRPORT_LANDING_RUNWAY as LR,AIRPORT_LANDING_SOUTH_PAD,AIRPORT_THRESHOLDS} from './airport';
import { planAirport,airportFootprint,pathCrossesRect } from "./airport";
it("reserves space beyond every existing land parcel with a connected paved approach",()=>{
 const land=[{x:0,z:0,w:5,d:8},{x:8,z:3,w:6,d:8}];
 const paving=[{x:12,z:5,w:1,d:.6,y:.6,h:.03}];
 const a=planAirport(land,paving)!;
 expect(a.x).toBeGreaterThan(14);
 expect(a.accessX).toBeLessThan(13);
 expect(a.accessZ).toBe(5.3);
 expect(a.accessZ).toBeGreaterThan(a.z);
 expect(a.accessZ).toBeLessThan(airportFootprint(a).z+airportFootprint(a).d);
});
it("does not invent a disconnected airport for an empty city",()=>{
 expect(planAirport([],[])).toBeUndefined();
 expect(planAirport([{x:0,z:0,w:3,d:3}],[])).toBeUndefined();
});

it("places planned logistics west of the open lot, its road meeting the lot's west side",()=>{
 const land=[{x:0,z:0,w:10,d:10}];
 const a=planAirport(land,[{x:1,z:3,w:4,d:.4,y:.6,h:.03}],land[0])!;
 expect(a.west).toBe(true);
 expect(airportFootprint(a).x+airportFootprint(a).w).toBeLessThan(0);
 expect(a.accessX).toBe(.5);
 expect(a.accessZ).toBe(6.5);
});
it("rolls along the runway before climbing and pauses between departures",async()=>{
 const {departurePose}=await import('./airport');
 const start=departurePose(0),roll=departurePose(8),air=departurePose(18);
 expect(roll.z).toBeLessThan(start.z);
 expect(roll.y).toBe(start.y);
 expect(air.y).toBeGreaterThan(roll.y);
 expect(air.z).toBeLessThan(roll.z);
 expect(departurePose(175).visible).toBe(false);
 expect(departurePose(180)).toEqual(start);
 expect(departurePose(18,false)).toEqual(start);
});

it("circles the city twice with continuous positions and respects reduced motion",async()=>{
 const {departurePose}=await import('./airport');
 for(const t of [18,30,40,90,150,160]){const a=departurePose(t-.001),b=departurePose(t);expect(Math.hypot(a.x-b.x,a.z-b.z,a.y-b.y)).toBeLessThan(.05);}
 expect(departurePose(60).visible).toBe(true);
 expect(departurePose(120).x).toBeCloseTo(departurePose(60).x);
 expect(departurePose(120).z).toBeCloseTo(departurePose(60).z);
 expect(departurePose(60).y).toBe(14);
 expect(departurePose(120,false)).toEqual(departurePose(0));
});

it("keeps gate aircraft, waiting jets, and cargo clear of the runway",async()=>{
 const {AIRPORT_LAYOUT:l}=await import('./airport');
 expect(l.runwayX-l.runwayWidth/2).toBeGreaterThan(11.5+1.35);
 expect(l.gateX+1.35).toBeLessThan(11.5-1.35);
 for(let i=1;i<l.gateZ.length;i++)expect(l.gateZ[i]-l.gateZ[i-1]).toBeGreaterThan(2.8);
 expect(l.cargoZ).toBeGreaterThan(l.gateZ[l.gateZ.length-1]+1.4+1);
 expect(l.departureZ+1.4).toBeLessThan(l.runwayZ+l.runwayLength/2);
});

it("joins every gate to the concourse and aircraft door at a usable floor height",async()=>{
 const {boardingBridge,AIRPORT_LAYOUT:l,AIRCRAFT_LAYOUT:p,BOARDING_LAYOUT:b}=await import('./airport');
 for(const gate of l.gateZ){const bridge=boardingBridge(gate);expect(bridge.x-bridge.w/2).toBeCloseTo(b.fromX);expect(bridge.x+bridge.w/2).toBeCloseTo(l.gateX+p.doorX);expect(bridge.z).toBe(gate+p.doorZ);}
 expect(b.floor+.03).toBeCloseTo(.06+p.doorY);
 expect(b.ceiling-b.floor).toBeGreaterThan(.26);
});

it('reserves enlarged land for remote aircraft and landside parking without runway conflicts',async()=>{
 const {AIRPORT_LAYOUT:l,AIRPORT_REMOTE_STANDS:stands,AIRCRAFT_LAYOUT:p,airportParkingBays, AIRPORT_TERMINAL:t}=await import('./airport');
 for(const s of stands){
  expect(s.x-p.halfSpan).toBeGreaterThan(l.landX);expect(s.x+p.halfSpan).toBeLessThan(l.taxiX-p.halfSpan);
  expect(s.z-p.halfLength).toBeGreaterThan(l.landZ);expect(s.z+p.halfLength).toBeLessThan(l.landZ+l.landDepth);
  expect(Math.abs(s.z-l.cargoZ)).toBeGreaterThan(p.halfLength+1);
 }
 const {vehicleBounds}=await import('./vehicleModels');
 for(const bay of airportParkingBays()){
  const b=vehicleBounds('gwagon');expect(bay.x-b.halfWidth).toBeGreaterThan(t.arrivalsX+.32);
  expect(bay.z+b.front).toBeLessThan(-3-.65);expect(bay.z-b.front).toBeGreaterThan(l.landZ);
 }
});

describe('airport forecourt', () => {
  it('joins the terminal entrance to the district terrace across from it in the district layout', async () => {
    const {catalog} = await import('../../catalog');
    const {layoutMap} = await import('../mapLayout');
    const {buildScene} = await import('./scene');
    const s = buildScene(layoutMap(catalog, [], 'district'));
    const a=s.airport!,land=airportFootprint(a),f=s.financial!;
    expect(land.z).toBeGreaterThan(f.z+f.d);expect(land.z-f.z-f.d).toBeLessThan(1);
    const link=s.transportConnections.find(c=>c.id==='skyline-airport')!;
    expect(link.road.length).toBeGreaterThan(1);expect(link.walk.length).toBeGreaterThan(1);
    expect(s.communityRail?.airportLeg).toBeDefined();

  });
  it('detects a path over a rectangle', () => {
    expect(pathCrossesRect([[0, 0], [4, 0]], {x: 1, z: -1, w: 1, d: 2})).toBe(true);
    expect(pathCrossesRect([[0, 3], [4, 3]], {x: 1, z: -1, w: 1, d: 2})).toBe(false);
  });
});

// Runway ends are joined like a real airfield's (Khaneil, 2026-11-13): a taxiway meets every runway end, past its
// threshold bars, and every end taxiway runs from the parallel taxiway (x 11.5, z -7.8 to 23) to paved runway.
describe('runway-end taxiways',()=>{
 const runways=[{x:15,w:2.2,z0:-3,z1:18,bars:AIRPORT_THRESHOLDS.runway1},{x:LR.x,w:LR.width,z0:LR.z-LR.length/2,z1:AIRPORT_LANDING_SOUTH_PAD.z1,bars:AIRPORT_THRESHOLDS.landing}];
 const touches=(t:{x:number;z:number;w:number;d:number},r:{x0:number;x1:number;z0:number;z1:number})=>t.x-t.w/2<=r.x1+1e-6&&t.x+t.w/2>=r.x0-1e-6&&t.z-t.d/2<=r.z1+1e-6&&t.z+t.d/2>=r.z0-1e-6;
 const paved=[{x0:11.075,x1:11.925,z0:-7.8,z1:23},...runways.map(r=>({x0:r.x-r.w/2,x1:r.x+r.w/2,z0:r.z0,z1:r.z1}))];
 it('joins both ends of every runway to a taxiway',()=>{
  for(const r of runways)for(const end of [r.z0,r.z1])expect(AIRPORT_END_TAXIWAYS.some(t=>Math.abs(t.x-r.x)<=r.w/2+t.w/2+1e-6&&Math.abs(t.z-end)<=t.d/2+1e-6+(t.w>t.d?1.2:0)),`${r.x} @ ${end}`).toBe(true);
 });
 it('never paves a taxiway over a runway',()=>{
  for(const r of runways)expect(AIRPORT_END_TAXIWAYS.filter(t=>Math.min(t.x+t.w/2,r.x+r.w/2)-Math.max(t.x-t.w/2,r.x-r.w/2)>1e-6&&Math.min(t.z+t.d/2,r.z1)-Math.max(t.z-t.d/2,r.z0)>1e-6)).toEqual([]);
 });
 it('keeps every threshold bar off the taxiways',()=>{
  for(const r of runways)for(const bar of r.bars)expect(AIRPORT_END_TAXIWAYS.filter(t=>Math.abs(t.x-r.x)<r.w/2+t.w/2&&Math.abs(t.z-bar)<t.d/2+.33)).toEqual([]);
 });
 it('ends no taxiway on the grass: both ends of each one are paved',()=>{
  for(const t of AIRPORT_END_TAXIWAYS){
   const ends=t.w>t.d?[{...t,x:t.x-t.w/2,w:0},{...t,x:t.x+t.w/2,w:0}]:[{...t,z:t.z-t.d/2,d:0},{...t,z:t.z+t.d/2,d:0}];
   for(const e of ends)expect(paved.some(p=>touches(e,p))||AIRPORT_END_TAXIWAYS.some(o=>o!==t&&touches(e,{x0:o.x-o.w/2,x1:o.x+o.w/2,z0:o.z-o.d/2,z1:o.z+o.d/2})),JSON.stringify(e)).toBe(true);
  }
 });
});

describe('Cargo (Model Intelligence Lab) lot and the service gate',()=>{
 const scene=buildScene(layoutMap(catalog,[],'district'));const a=scene.airport!;
 const streets=scene.transportConnections.flatMap(l=>[l.road,...(l.frontage?[l.frontage]:[])]);
 const world=(x:number,z:number)=>airportPoint(a,x,z);
 const corners=(x:number,z:number,w:number,d:number)=>[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2],[x,z]] as [number,number][];
 const clearOf=(pts:[number,number][],m:number)=>pts.every(([x,z])=>streets.every(r=>distanceToRoad(world(x,z),r)>m));
 it('stands on airport land, clear of streets and their sidewalks, stands, taxiway and runways',()=>{
  const c=AIRPORT_BUILDINGS.find(b=>b.id==='cargo')!;
  expect(c.x-c.w/2>=AL2.landX&&c.z-c.d/2>=AL2.landZ).toBe(true);
  expect(clearOf(corners(c.x,c.z,c.w,c.d),.36+.18)).toBe(true);
  const overlap=(r:{x:number;z:number;w:number;d:number})=>Math.abs(c.x-r.x)<(c.w+r.w)/2&&Math.abs(c.z-r.z)<(c.d+r.d)/2;
  expect([...AIRPORT_REMOTE_STANDS.map(s=>({...s,w:3.7,d:3.6})),{x:11.5,z:-3.9,w:.85,d:7.8},{x:15,z:7.5,w:2.2,d:21},{x:LR.x,z:7.25,w:2.2,d:25.5},{x:10.4,z:-14.5,w:24.4,d:.64}].filter(overlap)).toEqual([]);
 });
 it('opens both ends of the service building on the gated street, which runs through the passage',()=>{
  const P=AIRPORT_SERVICE_DOOR.passage,G=AIRPORT_SERVICE_GATE;
  expect(P.x1).toBe(G.building.x1);expect(P.x0).toBeLessThan(P.x1);
  // Both openings span the street's two lanes, and the street's centre line runs the passage end to end.
  expect(P.z0<=G.drive.z0&&P.z1>=G.drive.z1).toBe(true);
  for(const px of [P.x0-.1,(P.x0+P.x1)/2,P.x1+.1])expect(streets.some(r=>distanceToRoad(world(px,(G.drive.z0+G.drive.z1)/2),r)<.05)).toBe(true);
 });
 it('puts the gate across the street where it reaches the service building',()=>{
  const G=AIRPORT_SERVICE_GATE;
  // Across the street's last stretch, between the building's east face and the corner where the street turns.
  expect(G.x>G.building.x1+.3&&G.x<G.drive.x1-.5).toBe(true);
  // The street there: its centre line runs mid-gate, across both barrier lanes.
  expect(streets.some(r=>distanceToRoad(world(G.x,(G.drive.z0+G.drive.z1)/2),r)<.05)).toBe(true);
  // Booth and fence ends stand off every carriageway.
  expect(clearOf([[G.x+.1,G.drive.z0-.42],[G.x,G.drive.z1+1.2],[G.x,G.drive.z0-1.6]],.36)).toBe(true);
 });
});

describe('landing runway position (Khaneil, 2026-11-13)',()=>{
 it('sits on the grass between runway 1 and the service road, with clear room either side',()=>{
  const r1East=AL2.runwayX+AL2.runwayWidth/2,serviceRoadWest=22.3-.32;
  expect(LR.x-LR.width/2-r1East).toBeGreaterThan(1.8);
  expect(serviceRoadWest-(LR.x+LR.width/2)).toBeGreaterThan(1.2);
 });
 it('keeps every runway-end taxiway flush with the moved runway edge',()=>{
  for(const t of AIRPORT_END_TAXIWAYS.slice(0,2))expect(t.x+t.w/2).toBeCloseTo(LR.x-LR.width/2,6);
 });
});
