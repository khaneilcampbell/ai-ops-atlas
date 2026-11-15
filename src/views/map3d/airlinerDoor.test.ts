import {describe,expect,it} from "vitest";
import {airlinerDoor,clearOfDoor,DOOR,doorCorners,doorFrame} from "./airlinerDoor";

describe("airliner passenger door",()=>{
  const radius=.194,y0=.36,z=-.8,parts=airlinerDoor({radius,y0,z,skin:"#f6f2e7",glass:"#2a2620"});
  it("sits flush on the curved skin, not standing off it or sunk into it",()=>{
    for(const p of parts){
      // Measured from the skin's tangent plane at the door: a flat door touches the tube along its middle.
      const f=doorFrame(radius,y0),out=-p.p[0]*Math.cos(f.phi)+(p.p[1]-y0)*Math.sin(f.phi)-radius;
      expect(out).toBeGreaterThan(0);
      expect(out).toBeLessThan(.008);
      expect(p.p[0]).toBeLessThan(0);
      expect(Math.abs(p.p[2]-z)).toBeLessThanOrEqual(DOOR.width/2+DOOR.seam);
    }
  });
  it("is a cabin-height door, not a slab down to the belly",()=>{
    const [seam,panel]=parts;
    expect(panel.s[1]).toBe(DOOR.height);
    expect(seam.s[1]).toBeGreaterThan(panel.s[1]);
    // Boxes stand up from their base point.
    const bottom=panel.p[1],top=panel.p[1]+DOOR.height*Math.cos(doorFrame(radius,y0).phi);
    expect(bottom).toBeGreaterThan(y0-radius*.75);
    expect(top).toBeLessThan(y0+radius*.6);
  });
  it("lies on the skin's tangent, edges close to the curve, porthole near the cabin window line",()=>{
    const f=doorFrame(radius,y0);
    for(const p of parts)expect(p.rz).toBeCloseTo(-f.phi);
    // Corner standoff of a flat door on the round tube stays small.
    expect(Math.hypot(radius,DOOR.height/2+DOOR.seam)-radius).toBeLessThan(.02);
    // Cabin windows stand .036 tall from y0 + .04.
    expect(Math.abs(parts[2].p[1]+parts[2].s[1]/2-(y0+.058))).toBeLessThan(.01);
  });
  it("leaves a gap in the cabin windows",()=>{
    // The real window stations: -0.9 + i * 0.085.
    const covered=Array.from({length:22},(_,i)=>-.9+i*.085).filter(w=>!clearOfDoor(w,z));
    expect(covered.map(w=>+w.toFixed(3))).toEqual([-.815,-.73]);
  });
  it("has rounded corners: a disc in each corner of the seam and the panel, flush and inside the outline",()=>{
    const corners=doorCorners({radius,y0,z,skin:"#f6f2e7"}),f=doorFrame(radius,y0);
    expect(corners).toHaveLength(8);
    for(const c of corners){
      const out=-c.p[0]*Math.cos(f.phi)+(c.p[1]-y0)*Math.sin(f.phi)-radius;
      expect(out).toBeGreaterThan(0);
      expect(out).toBeLessThan(.008);
      expect(Math.abs(c.p[2]-z)+c.s[2]).toBeLessThanOrEqual(DOOR.width/2+DOOR.seam+1e-9);
    }
  });
  it("is tall and narrow like a cabin door",()=>{
    expect(DOOR.height/DOOR.width).toBeGreaterThan(1.8);
  });
});
