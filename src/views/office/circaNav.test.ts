import {describe,expect,it} from "vitest";
import {circaLevelKind} from "./circaFloors";
import {LIFT_CAR,LIFT_STOP,LOBBY_STOPS,POOL_STOPS,WALK,circaApartments,circaGrid,circaItinerary,circaPath,clearLine,pathLength,podiumLift,snap,unitStops,walkerAt,type Stop} from "./circaNav";
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

  it("loops each agent through its apartment, the lobby and the pool deck by its tower's lift",()=>{
    const it0=circaItinerary(0),levels=new Set(it0.legs.map(l=>l.level));
    // Tower-local legs on the home floor carry the tower; podium legs don't.
    for(const l of it0.legs)expect(l.tower).toBe(l.level===it0.home.level?it0.home.tower:undefined);
    expect(circaItinerary(3).home.tower).toBe("east");
    expect(levels).toEqual(new Set([it0.home.level,0,1]));
    expect(it0.legs.filter(l=>l.ride).length).toBe(3);
    // Legs are back to back and every stop of the home unit, lobby and pool is visited.
    it0.legs.forEach((l,i)=>{expect(l.t1).toBeGreaterThan(l.t0);if(i)expect(l.t0).toBeCloseTo(it0.legs[i-1].t1);});
    const visited=new Set(it0.legs.filter(l=>l.at).map(l=>`${circaLevelKind(l.level)}:${l.at!.id}`));
    for(const s of unitStops("01"))expect(visited.has(`apartments:${s.id}`)).toBe(true);
    for(const s of LOBBY_STOPS)expect(visited.has(`lobby:${s.id}`)).toBe(true);
    for(const s of POOL_STOPS)expect(visited.has(`pool:${s.id}`)).toBe(true);
    // Twenty-four homes, one per apartment, wrapping for more agents.
    expect(new Set(Array.from({length:24},(_,i)=>circaItinerary(i).home.unit)).size).toBe(24);
    expect(circaItinerary(24).home).toEqual(circaItinerary(0).home);
  });

  it("moves at walking pace and hides the walker while it rides the lift",()=>{
    const it0=circaItinerary(3);
    const walk=it0.legs.find(l=>l.path&&l.t1-l.t0>2)!,a=walkerAt(it0,walk.t0+.5),b=walkerAt(it0,walk.t0+1.5);
    expect(Math.hypot(b.x-a.x,b.z-a.z)).toBeLessThanOrEqual(WALK.speed+1e-6);
    const ride=it0.legs.find(l=>l.ride)!;expect(walkerAt(it0,(ride.t0+ride.t1)/2).riding).toBe(true);
    expect(walkerAt(it0,it0.period+1)).toEqual(walkerAt(it0,1));
  });
});
