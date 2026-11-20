import {describe,expect,it} from "vitest";
import {LIFT_CAR,LIFT_STOP,LOBBY_STOPS,POOL_STOPS,circaApartments,circaGrid,circaPath,clearLine,pathLength,podiumLift,snap,unitStops,type Stop} from "./circaNav";
import type {CircaLevel} from "./circaFloors";

const floors:[CircaLevel,Stop[]][]=[
  ["lobby",LOBBY_STOPS],["pool",POOL_STOPS],
  ["apartments",[...unitStops("01"),...unitStops("02"),...unitStops("03")]],
];

describe("Walking inside Circa",()=>{
  // Apartment floors use the tower's own lift; the podium floors have both towers' lifts.
  const lifts=(kind:CircaLevel)=>kind==="apartments"?[{stop:LIFT_STOP,car:LIFT_CAR}]:[podiumLift("west"),podiumLift("east")];
  it.each(floors)("puts every %s stop on open floor",(kind,stops)=>{
    const g=circaGrid(kind);
    for(const s of [...lifts(kind).flatMap(l=>[l.stop,l.car]),...stops])expect(snap(g,s.x,s.z,.25),`${kind} ${s.id} at ${s.x},${s.z}`).not.toBeNull();
  });

  it.each(floors)("reaches every %s stop from each lift, walking only on open floor",(kind,stops)=>{
    const g=circaGrid(kind);
    for(const {car} of lifts(kind))for(const s of stops){
      const there=circaPath(kind,car,s),back=circaPath(kind,s,car);
      expect(there,`${kind}: ${car.label} to ${s.id}`).not.toBeNull();expect(back,`${kind}: ${s.id} to ${car.label}`).not.toBeNull();
      for(let i=1;i<there!.length;i++)expect(clearLine(g,there![i-1],there![i])).toBe(true);
      // No teleporting through walls: a route is never much shorter than the straight line.
      expect(pathLength(there!)).toBeGreaterThanOrEqual(Math.hypot(s.x-car.x,s.z-car.z)-.6);
    }
  });

  it("covers every room of every apartment in both towers on Floors 3 to 6",()=>{
    const apts=circaApartments();
    expect(apts.map(a=>a.unit)).toEqual([3,4,5,6].flatMap(n=>[1,2,3,4,5,6].map(u=>`${n}0${u}`)));
    expect(apts.filter(a=>a.tower==="east").map(a=>a.layout).slice(0,3)).toEqual(["01","02","03"]);
    expect(unitStops("01").map(s=>s.id)).toEqual(["door","kitchen","dining","master","master-bath","living","bedroom","bath"]);
    for(const s of ["02","03"])expect(unitStops(s).map(s=>s.id)).toEqual(["door","kitchen","bath","bedroom","living","dining"]);
  });
});
