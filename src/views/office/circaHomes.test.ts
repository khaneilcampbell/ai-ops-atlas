import {describe,expect,it} from "vitest";
import {catalog} from "../../catalog/index";
import {agentJobs} from "../../catalog/agentJobs";
import {cityFigureFor} from "../../registry/cityFigures";
import type {Routine,Segment} from "../../routine/routine";
import {circaLevelKind} from "./circaFloors";
import {CIRCA_LIFT_OFFSET,CIRCA_LIFT_TOP,LOBBY_STOPS,POOL_STOPS,WALK,circaApartments,pathLength,unitStops,walkerAt} from "./circaNav";
import {LIFT_STOP_SECONDS,elevatorAt} from "./circulation";
import {bedroomOf,circaHome,circaResidents,homeLoop,homeStateAt,nightLoop,type CircaResident} from "./circaHomes";

const jobs=agentJobs(catalog);
const residents=circaResidents(jobs,id=>!!cityFigureFor(id));
const NY="America/New_York";
const at=(iso:string)=>Date.parse(iso);

describe("Agents at home in Ellipse Residences",()=>{
  it("houses every agent in an apartment that really exists inside the building, one each",()=>{
    const drawn=new Set(circaApartments().map(a=>a.unit));
    const working=jobs.filter(j=>!j.offDuty);
    for(const j of working){expect(drawn.has(j.home.unit),`${j.agentId} ${j.home.unit}`).toBe(true);expect(j.home.label).toContain(`apartment ${j.home.unit}`);}
    expect(new Set(working.map(j=>j.home.unit)).size).toBe(Math.min(working.length,24));
  });

  it("reads tower, floor and layout from the unit number",()=>{
    expect(circaHome("301")).toEqual({level:2,tower:"west",unit:"301",layout:"01"});
    expect(circaHome("605")).toEqual({level:5,tower:"east",unit:"605",layout:"02"});
    expect(circaHome("12A")).toBeNull();expect(circaHome("701")).toBeNull();
    // The label says which tower, and the building draws the unit in that tower.
    for(const j of jobs.filter(j=>!j.offDuty))expect(j.home.label).toContain(circaHome(j.home.unit)!.tower==="west"?"West":"East");
  });

  it("makes every named agent a resident in its own apartment, and nobody else",()=>{
    const named=jobs.filter(j=>cityFigureFor(j.agentId));
    expect(residents.map(r=>r.id)).toEqual(named.map(j=>j.agentId));
    for(const r of residents)expect(r.home.unit).toBe(jobs.find(j=>j.agentId===r.id)!.home.unit);
    // An agent whose saved home is another building doesn't live here.
    const away=circaResidents(jobs.map((j,i)=>i?j:{...j,home:{building:"residence",unit:"",label:"Elsewhere"}}),id=>!!cityFigureFor(id));
    expect(away.some(r=>r.id===jobs[0].agentId)).toBe(false);
  });
});

describe("Home or out, by the agent's own day",()=>{
  const id=residents[0].id;
  const day=(segs:Partial<Segment>[]):Routine=>({personaId:id,segments:segs as Segment[],validUntil:0,episodes:[],held:false});
  const t0=at("2026-11-19T14:00:00Z"),t1=at("2026-11-19T16:00:00Z");
  it("is home while its day stays at its own home, out otherwise",()=>{
    const r=day([{kind:"stay",t0,t1,at:`home:${id}`,activity:"at_home",phase:null,note:"At home"},{kind:"inside",t0:t1,t1:t1+3600_000,at:`office:${id}`,activity:"at_desk",phase:"working",note:"x",work:{label:"x",runs:[],scheduledAt:null,alreadyStarted:false,outcome:null}} as Segment]);
    expect(homeStateAt(id,r,t0+60_000,NY)).toEqual({home:true,night:false,note:"At home"});
    expect(homeStateAt(id,r,t1+60_000,NY)).toMatchObject({home:false,note:"At desk"});
  });
  it("sleeps in its bedroom on a night at home",()=>{
    const n0=at("2026-11-19T04:00:00Z"),r=day([{kind:"stay",t0:n0,t1:n0+3600_000,at:`home:${id}`,activity:"at_home",phase:null,note:"At home for the night"}]);
    expect(homeStateAt(id,r,n0+60_000,NY)).toMatchObject({home:true,night:true});
  });
  it("with no day worked out yet, is home at night and out by day",()=>{
    expect(homeStateAt(id,undefined,at("2026-11-19T05:00:00Z"),NY)).toMatchObject({home:true,night:true});
    expect(homeStateAt(id,undefined,at("2026-11-19T17:00:00Z"),NY)).toMatchObject({home:false});
  });
});

describe("Loops built from each agent's own apartment",()=>{
  const cycle=CIRCA_LIFT_TOP*2*LIFT_STOP_SECONDS;
  const landing=(r:CircaResident,t:number)=>elevatorAt(t,CIRCA_LIFT_TOP,CIRCA_LIFT_OFFSET[r.home.tower]).landing;
  it("starts and ends in its living room, visits every room of its own apartment and nobody else's",()=>{
    for(const r of residents){
      const d=homeLoop(r,3);
      const mine=d.legs.filter(l=>l.at&&l.level===r.home.level);
      for(const s of unitStops(r.home.layout))expect(mine.some(l=>l.at!.id===s.id),`${r.home.unit} ${s.id}`).toBe(true);
      // Every apartment-floor leg is on its own floor, in its own tower.
      for(const l of d.legs.filter(l=>circaLevelKind(l.level)==="apartments")){expect(l.level).toBe(r.home.level);expect(l.frame).toBe(r.home.tower);}
      expect(d.legs[0].at?.id).toBe("living");expect(d.legs[d.legs.length-1].at?.id).toBe("living");
      expect(d.period%cycle).toBe(0);
      d.legs.forEach((l,i)=>{expect(l.t1).toBeGreaterThanOrEqual(l.t0);if(i)expect(l.t0).toBeCloseTo(d.legs[i-1].t1);});
      expect(d.legs[d.legs.length-1].t1).toBeCloseTo(d.start+d.period);
      expect(walkerAt(d,d.start+d.period+5)).toEqual(walkerAt(d,d.start+5));
    }
  });
  it("goes once by its own tower's lift to the pool deck or the lobby, riding only while the doors are open",()=>{
    const amenities=new Set([...LOBBY_STOPS,...POOL_STOPS].map(s=>s.id));
    for(const r of residents){
      const d=homeLoop(r);
      expect(d.legs.filter(l=>l.hidden==="ride").length).toBe(2);
      expect(d.legs.some(l=>l.at&&circaLevelKind(l.level)!=="apartments"&&amenities.has(l.at.id))).toBe(true);
      d.legs.forEach((l,k)=>{
        if(l.hidden!=="ride")return;
        const stepIn=d.legs[k-1];
        expect(landing(r,stepIn.t0+.01)).toBe(stepIn.level);expect(landing(r,l.t1)).toBe(l.level);
      });
      for(const l of d.legs.filter(l=>l.path))expect(pathLength(l.path!)/(l.t1-l.t0)).toBeCloseTo(WALK.speed,5);
    }
  });
  it("spends the night mostly in its own bedroom, never leaving its apartment",()=>{
    for(const r of residents){
      const d=nightLoop(r),bed=bedroomOf(r.home);
      expect(walkerAt(d,5)).toMatchObject({level:r.home.level,frame:r.home.tower,hidden:false,x:bed.x,z:bed.z});
      for(const l of d.legs){expect(l.level).toBe(r.home.level);expect(l.frame).toBe(r.home.tower);expect(l.hidden).toBeUndefined();}
      const inBed=d.legs.filter(l=>l.at?.id===bed.id).reduce((n,l)=>n+l.t1-l.t0,0);
      expect(inBed/d.period).toBeGreaterThan(.6);
      expect(walkerAt(d,d.period+3)).toEqual(walkerAt(d,3));
    }
  });
});
