import {describe,expect,it} from "vitest";
import {circaLevelKind} from "./circaFloors";
import {CIRCA_LIFT_OFFSET,CIRCA_LIFT_TOP,LIFT_CAR,LIFT_STOP,LOBBY_STOPS,POOL_STOPS,WALK,circaApartments,circaGrid,circaItinerary,circaPath,clearLine,pathLength,podiumLift,snap,unitStops,walkerAt,type Itinerary,type Stop} from "./circaNav";
import {LIFT_STOP_SECONDS,elevatorAt} from "./circulation";
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

  const cycle=CIRCA_LIFT_TOP*2*LIFT_STOP_SECONDS;
  const landing=(it:Itinerary,t:number)=>elevatorAt(t,CIRCA_LIFT_TOP,CIRCA_LIFT_OFFSET[it.home.tower]).landing;

  it("starts at the front door, rides home, makes two outings and leaves, looping on whole lift cycles",()=>{
    const it0=circaItinerary(0,0);
    expect(new Set(it0.legs.map(l=>l.level))).toEqual(new Set([it0.home.level,0,1]));
    // Tower-local legs on apartment floors carry the tower; podium legs don't.
    for(const l of it0.legs)expect(l.tower).toBe(circaLevelKind(l.level)==="apartments"?it0.home.tower:undefined);
    expect(circaItinerary(3).home.tower).toBe("east");
    expect(it0.legs.filter(l=>l.hidden==="ride").length).toBe(6);
    expect(it0.legs[0].at?.id).toBe("entrance");expect(it0.legs[it0.legs.length-1].hidden).toBe("away");
    it0.legs.forEach((l,i)=>{expect(l.t1).toBeGreaterThan(l.t0);if(i)expect(l.t0).toBeCloseTo(it0.legs[i-1].t1);});
    expect(it0.period%cycle).toBe(0);expect(it0.legs[it0.legs.length-1].t1).toBeCloseTo(it0.start+it0.period);
  });

  it("visits every room of each home, and across the residents every lobby and pool stop",()=>{
    const all=Array.from({length:24},(_,i)=>circaItinerary(i,i*11.3));
    const seen=new Set(all.flatMap(it=>it.legs.filter(l=>l.at).map(l=>`${circaLevelKind(l.level)}:${l.at!.id}`)));
    for(const it of all){
      const mine=new Set(it.legs.filter(l=>l.at&&l.level===it.home.level).map(l=>l.at!.id));
      for(const s of unitStops(it.home.layout))expect(mine.has(s.id),`${it.home.unit} ${s.id}`).toBe(true);
    }
    for(const s of [...LOBBY_STOPS])expect(seen.has(`lobby:${s.id}`),s.id).toBe(true);
    for(const s of POOL_STOPS)expect(seen.has(`pool:${s.id}`),s.id).toBe(true);
    // Twenty-four homes, one per apartment, wrapping for more agents.
    expect(new Set(all.map(it=>it.home.unit)).size).toBe(24);
    expect(circaItinerary(24).home).toEqual(circaItinerary(0).home);
  });

  it("boards and leaves the lift only while its doors are open on that floor",()=>{
    for(const i of [0,3,7,13,22]){
      const it=circaItinerary(i,i*11.3);
      it.legs.forEach((l,k)=>{
        if(l.hidden!=="ride")return;
        const stepIn=it.legs[k-1],stepOut=it.legs[k+1];
        expect(stepIn.path).toBeDefined();
        expect(landing(it,stepIn.t0+.01)).toBe(stepIn.level);expect(landing(it,stepIn.t1-.01)).toBe(stepIn.level);
        expect(landing(it,l.t1)).toBe(l.level);expect(landing(it,stepOut.t1-.01)).toBe(l.level);
      });
    }
  });

  it("walks at walking pace everywhere, waits at the lift, and repeats each loop exactly",()=>{
    const it0=circaItinerary(5,40);
    for(const l of it0.legs.filter(l=>l.path))expect(pathLength(l.path!)/(l.t1-l.t0)).toBeCloseTo(WALK.speed,5);
    expect(it0.legs.some(l=>l.at?.label==="Waiting for the lift")).toBe(true);
    const ride=it0.legs.find(l=>l.hidden==="ride")!;expect(walkerAt(it0,(ride.t0+ride.t1)/2).hidden).toBe(true);
    expect(walkerAt(it0,it0.start+it0.period+3)).toEqual(walkerAt(it0,it0.start+3));
  });
});
