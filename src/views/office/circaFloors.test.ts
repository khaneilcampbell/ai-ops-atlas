import {describe,expect,it} from "vitest";
import {CIRCA_CORRIDOR,CIRCA_PLATE,CIRCA_UNITS_EAST,circaEdgeZ,circaPlateReach,circaFloorName,circaLevelKind,circaPickerName,circaUnits,interiorFloors} from "./circaFloors";
import {circaApartmentParts,circaPoolDeckParts,type Part,type Parts} from "./circaInteriorParts";
import {allFloorsPose} from "./interiorPose";
import {ATLAS_LIFT,CIRCA_LIFT} from "./circulation";
import {cityDrop,INTERIOR_SLAB} from "./interiorGround";
import {TERRACE_H} from "../map3d/scene";

const APARTMENT_LEVELS=[2,3,4,5];
const opaque=(p:Parts):Part[]=>[...p.box,...p.round];
/** The four footprint corners of a piece, turned by r about y like three.js does. */
const corners=(part:Part)=>{const r=part.r??0,c=Math.cos(r),s=Math.sin(r),hx=part.s[0]/2,hz=part.s[2]/2;
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>[part.p[0]+a*hx*c+b*hz*s,part.p[2]-a*hx*s+b*hz*c] as [number,number]);};
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
        expect(u.x0).toBeGreaterThanOrEqual(CIRCA_PLATE.cx-CIRCA_PLATE.rx);expect(u.x1).toBeLessThanOrEqual(CIRCA_UNITS_EAST);
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

  it("makes the apartment plate an oval that holds the whole lift shaft at its east tip",()=>{
    expect(circaEdgeZ(CIRCA_PLATE.cx)).toBeCloseTo(CIRCA_PLATE.rz);expect(circaEdgeZ(CIRCA_PLATE.cx-CIRCA_PLATE.rx)).toBeCloseTo(0);
    // West tip on the podium edge; the shaft (platform x 7.15..9.85, z ±1.25) sits inside the glass.
    expect(CIRCA_PLATE.cx-CIRCA_PLATE.rx).toBeCloseTo(-8);
    for(const [x,z] of [[7.15,1.25],[9.85,1.25],[9.85,-1.25],[7.15,-1.25]])expect(circaPlateReach(x,z)).toBeLessThan(1);
  });

  const floors:[string,Parts][]=[["pool deck",circaPoolDeckParts()],...APARTMENT_LEVELS.map(l=>[`floor ${l+1}`,circaApartmentParts(l)] as [string,Parts])];
  it("keeps the pool deck on the rectangular podium plate",()=>{
    for(const part of Object.values(circaPoolDeckParts()).flat() as Part[]){
      const [hx,hz]=half(part);
      expect(part.p[0]-hx).toBeGreaterThan(-8.1);expect(part.p[0]+hx).toBeLessThan(8.1);
      expect(part.p[2]-hz).toBeGreaterThan(-6.1);expect(part.p[2]+hz).toBeLessThan(6.1);
    }
  });
  it.each(floors)("keeps the lift walk along z 0 clear on the %s",(_,parts)=>{
    // The lift visitor walks from x -4 to the lift along z 0; nothing taller than a floor finish may stand there.
    for(const part of opaque(parts)){
      const [hx,hz]=half(part),top=part.p[1]+part.s[1]/2;
      const inWalk=part.p[0]+hx>-4&&part.p[0]-hx<7.2&&Math.abs(part.p[2])-hz<.8;
      if(inWalk)expect(top).toBeLessThan(.06);
    }
  });

  it("keeps every piece of every apartment floor inside the oval glass",()=>{
    for(const level of APARTMENT_LEVELS){
      const parts=circaApartmentParts(level),all=Object.values(parts).flat() as Part[];
      for(const part of all){
        // The slab and floor discs are the ellipse itself; the glass ring sits on its line; everything else stays inside.
        if(part.s[0]>=CIRCA_PLATE.rx*2-.2)continue;
        const onRing=circaPlateReach(part.p[0],part.p[2])>.95;
        for(const [x,z] of corners(part))expect(circaPlateReach(x,z)).toBeLessThan(onRing?1.04:.995);
      }
      // Glass all the way round: full height on the far arc, a low rail on the near arc.
      expect(parts.glass.length).toBe(48);
      expect(parts.glass.filter(g=>g.p[2]<0).every(g=>g.s[1]>2.9)).toBe(true);
      expect(parts.glass.filter(g=>g.p[2]>0).every(g=>g.s[1]<1)).toBe(true);
    }
  });

  it("stands the tower's oval columns on the pool deck without blocking furniture or the lift walk",()=>{
    const deck=circaPoolDeckParts(),columns=deck.round.filter(p=>p.s[1]>3.5);
    expect(columns.length).toBeGreaterThan(2);
    for(const c of columns){expect(circaPlateReach(c.p[0],c.p[2])).toBeCloseTo(1,5);expect(Math.abs(c.p[2])).toBeGreaterThan(1.2);}
  });

  it("varies the sofas between floors without new geometry",()=>{
    const sofa=(l:number)=>circaApartmentParts(l).box.filter(p=>Math.abs(p.p[2]-5.15)<.01&&p.s[0]===2.1).map(p=>p.c)[0];
    expect(new Set(APARTMENT_LEVELS.map(sofa)).size).toBeGreaterThan(1);
    expect(circaApartmentParts(2).box.length).toBe(circaApartmentParts(3).box.length);
  });

  it("frames the taller Circa stack and leaves every other building's camera unchanged",()=>{
    expect(allFloorsPose(4)).toEqual({position:[24,17,30],target:8});
    expect(allFloorsPose(1)).toEqual({position:[24,17,30],target:8});
    expect(allFloorsPose(5).target).toBe(10);
  });

  it("sets the city round the lobby so Circa's lot meets the lobby slab, and leaves other buildings' drop alone",()=>{
    // The map's raised terrace top (TERRACE_H) lands exactly at the bottom of the 0.3 slab for Circa.
    expect(TERRACE_H*4-cityDrop(4,0,true)).toBeCloseTo(-INTERIOR_SLAB);
    expect(cityDrop(4)).toBeCloseTo(TERRACE_H*4+.35);
    expect(cityDrop(4,8,true)-cityDrop(4,0,true)).toBeCloseTo(8);
  });

  it("gives Circa a black, walnut, stone and bronze lift and keeps the shared Atlas lift colours",()=>{
    expect(ATLAS_LIFT).toEqual({platform:"#d4c7aa",back:"#294c3e",sides:"#d4cbb8",header:"#b69b60",doors:"#7f9289",button:"#c5a35c",carFloor:"#bba36f",carBack:"#4f6b5d"});
    expect(CIRCA_LIFT).toMatchObject({header:"#1b1b1d",sides:"#5b3a26",platform:"#9a9893",doors:"#8a6a45",button:"#8a6a45"});
    expect(CIRCA_LIFT.indicator).toBeTruthy();
  });
});
