import {describe,expect,it} from "vitest";
import {FINANCIAL_BUILDINGS} from "../map3d/financialPlan";
import {financialInteriorKey} from "../map3d/financialBrands";
import {elevatorAt} from "./circulation";
import {LIFT_CAR,clearLine,pathLength,walkerAt,WALK,LIFT_WALLS} from "./walkNav";
import {TOWER_FLOORS,TOWER_W,roomKind,towerRooms,towerSpec,lobbyStops,roomStops,type TowerSpec} from "./towerPlan";
import {floorStops,towerDay,towerGrid,towerLift,towerPath} from "./towerNav";
import {towerFloorParts,towerLobbyParts} from "./towerParts";
import type {Part} from "./circaInteriorParts";

const specs=FINANCIAL_BUILDINGS.filter(b=>b.id!=="circa").map(b=>towerSpec(financialInteriorKey(b.id))!);
const levels=Array.from({length:TOWER_FLOORS+1},(_,i)=>i);

describe("Financial District interiors",()=>{
  it("covers the nine buildings other than Circa, in their exterior's proportions",()=>{
    expect(specs.map(s=>s.name).sort()).toEqual(["American Express","Benjaire Finance","Chase","Navy Federal Credit Union","Robinhood","The Ritz-Carlton","Vanguard","Wells Fargo","Experian"].sort());
    expect(towerSpec("Circa")).toBeUndefined();expect(towerSpec("BMW")).toBeUndefined();
    for(const s of specs){expect(s.w).toBe(TOWER_W);expect(s.d).toBeGreaterThanOrEqual(16);expect(s.d).toBeLessThan(s.w);}
    expect(specs.find(s=>s.name==="The Ritz-Carlton")!.program).toBe("hotel");
  });

  it("dresses each building in its brand colours",()=>{
    const theme=(name:string)=>specs.find(s=>s.name===name)!.theme.primary;
    expect(theme("American Express")).toBe("#006fcf");expect(theme("Experian")).toBe("#6d2077");expect(theme("Robinhood")).toBe("#7fae1f");
    expect(theme("Wells Fargo")).toBe("#b51c32");expect(theme("Chase")).toBe("#126bc4");
    // Every building has its own theme, and its lobby back wall and room walls use it.
    expect(new Set(specs.map(s=>s.theme.primary)).size).toBe(specs.length);
    for(const s of specs){
      expect(towerLobbyParts(s).box.some(p=>p.c===s.theme.primary&&p.s[1]>3)).toBe(true);
      expect(towerFloorParts(s,1).box.some(p=>p.c===s.theme.deep)).toBe(true);
    }
  });

  it("names rooms after the brand and furnishes them by what they're for",()=>{
    expect(["Grand reception","Private advisory","Planning lounge","Records review"].map(roomKind)).toEqual(["reception","private","meeting","workspace"]);
    const chase=specs.find(s=>s.name==="Chase")!;
    expect(towerRooms(chase,1).map(r=>r.name)).toEqual(chase.rooms);
    expect(towerRooms(chase,2)[0].name).toBe(chase.rooms[1]);
    expect(towerRooms(chase,0)).toEqual([]);
    expect(new Set(towerRooms(specs.find(s=>s.program==="hotel")!,3).map(r=>r.kind))).toEqual(new Set(["suite"]));
  });

  const all:[string,TowerSpec,number][]=specs.flatMap(s=>levels.map(l=>[`${s.name} level ${l}`,s,l] as [string,TowerSpec,number]));
  it.each(all)("%s: every stop is reachable from the lift on open floor",(_,spec,level)=>{
    const g=towerGrid(spec,level);
    for(const s of floorStops(spec,level)){
      const p=towerPath(spec,level,LIFT_CAR,s);
      expect(p,`${s.label} at ${s.x},${s.z}`).not.toBeNull();
      for(let i=1;i<p!.length;i++)expect(clearLine(g,p![i-1],p![i])).toBe(true);
      expect(towerPath(spec,level,s,LIFT_CAR)).not.toBeNull();
    }
  });

  it.each(specs.map(s=>[s.name,s] as [string,TowerSpec]))("%s: keeps every piece on the plate and clear of the lift",(_,spec)=>{
    for(let level=0;level<=TOWER_FLOORS;level++){
      const parts=level?towerFloorParts(spec,level):towerLobbyParts(spec);
      for(const p of Object.values(parts).flat() as Part[]){
        expect(Math.abs(p.p[0])-p.s[0]/2,`${p.c} at ${p.p}`).toBeLessThanOrEqual(spec.w/2+.05);
        expect(Math.abs(p.p[2])-(p.r?p.s[0]:p.s[2])/2,`${p.c} at ${p.p}`).toBeLessThanOrEqual(spec.d/2+.05);
        // Nothing taller than a floor finish inside the lift landing (x 7.2..9.8, |z| < 1.2).
        const top=p.p[1]+p.s[1]/2;if(Math.abs(p.p[2])<1.2&&p.p[0]>7.2&&p.p[0]<9.8&&!p.r)expect(top).toBeLessThan(.06);
      }
    }
    expect(LIFT_WALLS.length).toBe(3);
  });

  it("gives each person a day timed to the lift: boards and leaves only while the doors are open",()=>{
    for(const spec of [specs[0],specs.find(s=>s.program==="hotel")!])for(const i of [0,5,10,15]){
      const day=towerDay(spec,i,i*9.7),lift=towerLift(spec),landing=(t:number)=>elevatorAt(t,lift.top,lift.offset).landing;
      expect(day.legs.filter(l=>l.hidden==="ride").length).toBe(6);
      day.legs.forEach((l,k)=>{
        if(l.path)expect(pathLength(l.path)/(l.t1-l.t0)).toBeCloseTo(WALK.speed,5);
        if(l.hidden!=="ride")return;
        const stepIn=day.legs[k-1],stepOut=day.legs[k+1];
        expect(landing(stepIn.t0+.01)).toBe(stepIn.level);expect(landing(stepIn.t1-.01)).toBe(stepIn.level);
        expect(landing(l.t1)).toBe(l.level);expect(landing(stepOut.t1-.01)).toBe(l.level);
      });
      expect(walkerAt(day,day.start+day.period+2)).toEqual(walkerAt(day,day.start+2));
      // Their own room is visited.
      expect(day.legs.some(l=>l.level===day.floor&&l.at&&roomStops(towerRooms(spec,day.floor).find(r=>r.id===day.room)!).some(s=>s.id===l.at!.id&&s.x===l.at!.x))).toBe(true);
    }
    expect(lobbyStops(specs[0]).map(s=>s.id)).toContain("entrance");
  });
});
