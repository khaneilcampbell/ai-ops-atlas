import {describe,expect,it} from "vitest";
import {CIRCA_CORRIDOR,CIRCA_UNITS_EAST,circaFacadeZ,circaFloorName,circaLevelKind,circaPickerName,circaUnits,interiorFloors} from "./circaFloors";
import {circaApartmentParts,circaPoolDeckParts,type Part,type Parts} from "./circaInteriorParts";
import {allFloorsPose} from "./interiorPose";

const APARTMENT_LEVELS=[2,3,4,5];
const opaque=(p:Parts):Part[]=>[...p.box,...p.round];
/** Footprint half extents, widened for rotated pieces. */
const half=(part:Part)=>{const r=part.r??0,c=Math.abs(Math.cos(r)),s=Math.abs(Math.sin(r));return [(part.s[0]*c+part.s[2]*s)/2,(part.s[0]*s+part.s[2]*c)/2];};

describe("Circa floors inside Enter building",()=>{
  it("has six floors: lobby, pool deck, then four apartment floors; other buildings keep theirs",()=>{
    expect(interiorFloors("skyline-business:Circa")).toBe(5);
    expect(interiorFloors("skyline-business:Atlas Hills")).toBe(1);
    expect(interiorFloors("skyline-business:Wells Fargo")).toBe(4);
    expect(interiorFloors("skyline-business:Experian")).toBe(4);
    expect(interiorFloors("skyline-residences")).toBe(4);
    expect([0,1,2,5].map(circaLevelKind)).toEqual(["lobby","pool","apartments","apartments"]);
    expect([0,1,2].map(circaPickerName)).toEqual(["Floor 1 · Lobby","Floor 2 · Pool","Floor 3"]);
    expect([0,1,2,5].map(circaFloorName)).toEqual(["Floor 1 · Lobby","Floor 2 · Pool deck","Floor 3 · Residences","Floor 6 · Residences"]);
  });

  it("puts one 2 bed and two 1 bed apartments on every apartment floor, none on the lobby or pool deck",()=>{
    expect(circaUnits(0)).toEqual([]);expect(circaUnits(1)).toEqual([]);
    const ids=new Set<string>();
    for(const level of APARTMENT_LEVELS){
      const units=circaUnits(level);
      expect(units.map(u=>u.beds).sort()).toEqual([1,1,2]);
      for(const u of units){
        ids.add(u.id);expect(u.id.startsWith(String(level+1))).toBe(true);
        expect(u.x0).toBeGreaterThanOrEqual(-8);expect(u.x1).toBeLessThanOrEqual(CIRCA_UNITS_EAST);
        expect(u.z0).toBeGreaterThanOrEqual(-6);expect(u.z1).toBeLessThanOrEqual(6);
        // Units stay off the corridor and short of the lift landing at x ≈ 7.2.
        expect(u.z1<=CIRCA_CORRIDOR.z0||u.z0>=CIRCA_CORRIDOR.z1).toBe(true);
        expect(u.x1).toBeLessThan(7.2);
        expect(u.door[0]).toBeGreaterThan(u.x0);expect(u.door[1]).toBeLessThan(u.x1);expect(u.door[1]-u.door[0]).toBeGreaterThanOrEqual(.7);
        expect(u.label).not.toMatch(/\$|rent|available|sq/i);
      }
    }
    expect(ids.size).toBe(APARTMENT_LEVELS.length*3);
  });

  it("curves the 2 bed façade from z -4.8 at the ends to -6 in the middle",()=>{
    expect(circaFacadeZ(-8)).toBeCloseTo(-4.8);expect(circaFacadeZ(CIRCA_UNITS_EAST)).toBeCloseTo(-4.8);expect(circaFacadeZ(-.75)).toBeCloseTo(-6);
  });

  const floors:[string,Parts][]=[["pool deck",circaPoolDeckParts()],...APARTMENT_LEVELS.map(l=>[`floor ${l+1}`,circaApartmentParts(l)] as [string,Parts])];
  it.each(floors)("keeps the %s on the plate and the lift walk along z 0 clear",(_,parts)=>{
    for(const part of Object.values(parts).flat() as Part[]){
      const [hx,hz]=half(part);
      expect(part.p[0]-hx).toBeGreaterThan(-8.1);expect(part.p[0]+hx).toBeLessThan(8.1);
      expect(part.p[2]-hz).toBeGreaterThan(-6.1);expect(part.p[2]+hz).toBeLessThan(6.1);
    }
    // The lift visitor walks from x -4 to the lift along z 0; nothing taller than a floor finish may stand there.
    for(const part of opaque(parts)){
      const [hx,hz]=half(part),top=part.p[1]+part.s[1]/2;
      const inWalk=part.p[0]+hx>-4&&part.p[0]-hx<7.2&&Math.abs(part.p[2])-hz<.8;
      if(inWalk)expect(top).toBeLessThan(.06);
    }
  });

  it("keeps the 2 bed's furniture inside the curved glass",()=>{
    for(const level of APARTMENT_LEVELS)for(const part of opaque(circaApartmentParts(level)))
      if(part.p[2]<CIRCA_CORRIDOR.z0-.05&&part.p[0]<CIRCA_UNITS_EAST)expect(part.p[2]).toBeGreaterThanOrEqual(circaFacadeZ(part.p[0])-.06);
  });

  it("varies the sofas between floors without new geometry",()=>{
    const sofa=(l:number)=>circaApartmentParts(l).box.filter(p=>Math.abs(p.p[2]-5.45)<.01&&p.s[0]===2.1).map(p=>p.c)[0];
    expect(new Set(APARTMENT_LEVELS.map(sofa)).size).toBeGreaterThan(1);
    expect(circaApartmentParts(2).box.length).toBe(circaApartmentParts(3).box.length);
  });

  it("frames the taller Circa stack and leaves every other building's camera unchanged",()=>{
    expect(allFloorsPose(4)).toEqual({position:[24,17,30],target:8});
    expect(allFloorsPose(1)).toEqual({position:[24,17,30],target:8});
    expect(allFloorsPose(5).target).toBe(10);
  });
});
