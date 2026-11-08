import {describe,expect,it} from "vitest";
import {AIRCRAFT_LIGHTS,NAV_GREEN,NAV_RED,blinkState,lightPhase} from "./aircraftLights";

describe("aircraft night lights",()=>{
  it("puts red on the left wingtip and green on the right, as on a real airliner (nose to -z)",()=>{
    const red=AIRCRAFT_LIGHTS.nav.find(l=>l.c===NAV_RED)!,green=AIRCRAFT_LIGHTS.nav.find(l=>l.c===NAV_GREEN)!;
    expect(red.p[0]).toBeLessThan(0);
    expect(green.p[0]).toBeGreaterThan(0);
  });
  it("has red beacons on the fuselage top, belly and tail fin",()=>{
    expect(AIRCRAFT_LIGHTS.beacon).toHaveLength(3);
    expect(AIRCRAFT_LIGHTS.beacon.every(l=>l.c===NAV_RED)).toBe(true);
    expect(Math.max(...AIRCRAFT_LIGHTS.beacon.map(l=>l.p[1]))).toBeGreaterThan(.9);
  });
  it("keeps landing lights ahead of the wings",()=>{
    expect(AIRCRAFT_LIGHTS.landing.every(l=>l.p[2]<0)).toBe(true);
  });
  it("blinks: beacons and strobes are dark most of the time but flash every period",()=>{
    let beacon=0,strobe=0;const n=2600;
    for(let i=0;i<n;i++){const s=blinkState(i*.005,0);if(s.beacon)beacon++;if(s.strobe)strobe++;}
    expect(beacon/n).toBeGreaterThan(.05);expect(beacon/n).toBeLessThan(.25);
    expect(strobe/n).toBeGreaterThan(.03);expect(strobe/n).toBeLessThan(.2);
  });
  it("gives each jet a different phase so they don't flash together",()=>{
    const phases=new Set([0,1,2,3,4].map(s=>lightPhase(s).toFixed(3)));
    expect(phases.size).toBe(5);
    expect(blinkState(-3.2,lightPhase(2))).toHaveProperty("beacon");
  });
});
