import { expect, it } from "vitest";
import { planAirport,airportFootprint } from "./airport";
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

it("places planned logistics west of Skyline with a local access point",()=>{
 const land=[{x:0,z:0,w:10,d:10}];
 const a=planAirport(land,[{x:1,z:3,w:4,d:.4,y:.6,h:.03}],land[0])!;
 expect(a.west).toBe(true);
 expect(airportFootprint(a).x+airportFootprint(a).w).toBeLessThan(0);
 expect(a.accessX).toBe(1.1);
});
it("rolls along the runway before climbing and pauses between departures",async()=>{
 const {departurePose}=await import('./airport');
 const start=departurePose(0),roll=departurePose(8),air=departurePose(18);
 expect(roll.z).toBeLessThan(start.z);
 expect(roll.y).toBe(start.y);
 expect(air.y).toBeGreaterThan(roll.y);
 expect(air.z).toBeLessThan(roll.z);
 expect(departurePose(170).visible).toBe(false);
 expect(departurePose(180)).toEqual(start);
 expect(departurePose(18,false)).toEqual(start);
});

it("circles the city twice with continuous positions and respects reduced motion",async()=>{
 const {departurePose}=await import('./airport');
 for(const t of [18,30,90,150]){const a=departurePose(t-.001),b=departurePose(t);expect(Math.hypot(a.x-b.x,a.z-b.z,a.y-b.y)).toBeLessThan(.05);}
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
