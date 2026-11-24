import {describe,expect,it} from "vitest";
import {catalog} from "../../catalog/index";
import {agentJobs} from "../../catalog/agentJobs";
import {cityFigureFor} from "../../registry/cityFigures";
import type {Routine,Segment} from "../../routine/routine";
import {identityFor} from "../../registry/identity";
import {circaApartments} from "./circaNav";
import {bedroomOf,circaHome,circaResidents,homeStateAt,livingOf} from "./circaHomes";
import {residentsHomeOn,residentsOn,type CircaResidentNow} from "./CircaWalkers";

const jobs=agentJobs(catalog);
const residents=circaResidents(jobs,id=>!!cityFigureFor(id));
const shown:CircaResidentNow[]=residents.map(r=>({...r,figure:cityFigureFor(r.id),identity:identityFor(r.id,catalog.agents,r.name),state:{home:true,night:false,note:"At home"}}));
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
    // A paused named agent holds no apartment (apartments() in agentJobs.ts), so only working ones live here.
    const named=jobs.filter(j=>cityFigureFor(j.agentId)&&!j.offDuty);
    expect(residents.map(r=>r.id)).toEqual(named.map(j=>j.agentId));
    for(const r of residents)expect(r.home.unit).toBe(jobs.find(j=>j.agentId===r.id)!.home.unit);
    // An agent whose saved home is another building doesn't live here.
    const away=circaResidents(jobs.map((j,i)=>i?j:{...j,home:{building:"residence",unit:"",label:"Elsewhere"}}),id=>!!cityFigureFor(id));
    expect(away.some(r=>r.id===jobs[0].agentId)).toBe(false);
  });
});

describe("Shown in their own apartments while home, no loop",()=>{
  it("puts every resident on its own floor and tower, in its own living room, one per apartment",()=>{
    expect(residents.length).toBeGreaterThan(0);
    const levels=new Set(circaApartments().map(a=>a.level));
    for(const r of residents){
      expect(levels.has(r.home.level)).toBe(true);
      expect(residentsOn(shown,r.home.level,r.home.tower).map(x=>x.id)).toContain(r.id);
      expect(livingOf(r.home)).toMatchObject({id:"living"});
    }
    expect(new Set(residents.map(r=>r.home.unit)).size).toBe(residents.length);
  });
  it("shows nobody on the podium: the lobby and pool deck have no stand-in people",()=>{
    expect(residentsOn(shown,0)).toEqual([]);
    expect(residentsOn(shown,1)).toEqual([]);
  });
  it("shows each resident with its persona name and portrait, like the Agents tab",()=>{
    for(const r of shown){expect(r.identity.kind).toBe("own");expect(r.identity.portrait).toBeTruthy();}
  });
});

describe("One place at a time: home inside, out on the city map",()=>{
  const id=residents[0].id;
  const day=(segs:Partial<Segment>[]):Routine=>({personaId:id,segments:segs as Segment[],validUntil:0,episodes:[],held:false});
  const t0=at("2026-11-19T14:00:00Z"),t1=at("2026-11-19T16:00:00Z");
  const desk={kind:"inside",t0:t1,t1:t1+3600_000,at:`office:${id}`,activity:"at_desk",phase:"working",note:"x",work:{label:"x",runs:[],scheduledAt:null,alreadyStarted:false,outcome:null}} as Segment;
  it("is home exactly while its day stays at its own home (when the map hides it), out otherwise",()=>{
    const r=day([{kind:"stay",t0,t1,at:`home:${id}`,activity:"at_home",phase:null,note:"At home"},desk]);
    expect(homeStateAt(id,r,t0+60_000,NY)).toEqual({home:true,night:false,note:"At home"});
    expect(homeStateAt(id,r,t1+60_000,NY)).toMatchObject({home:false,note:"At desk"});
  });
  it("is out while walking home: the map draws it on the street until it arrives",()=>{
    const r=day([{kind:"walk",t0,t1,from:`office:${id}`,to:`home:${id}`,activity:"commuting",phase:null,note:"Heading home"} as unknown as Segment]);
    expect(homeStateAt(id,r,t0+60_000,NY).home).toBe(false);
  });
  it("sleeps in its bedroom on a night at home",()=>{
    const n0=at("2026-11-19T04:00:00Z"),r=day([{kind:"stay",t0:n0,t1:n0+3600_000,at:`home:${id}`,activity:"at_home",phase:null,note:"At home for the night"}]);
    expect(homeStateAt(id,r,n0+60_000,NY)).toMatchObject({home:true,night:true});
    for(const x of residents)expect(["bedroom","master"]).toContain(bedroomOf(x.home).id);
  });
  it("with no day worked out yet, is home at night and out by day",()=>{
    expect(homeStateAt(id,undefined,at("2026-11-19T05:00:00Z"),NY)).toMatchObject({home:true,night:true});
    expect(homeStateAt(id,undefined,at("2026-11-19T17:00:00Z"),NY)).toMatchObject({home:false});
  });
  it("draws only residents who are home; those out are left to the city map",()=>{
    const r=residents[0],mixed=shown.map(x=>x.id===r.id?{...x,state:{home:false as const,note:"At desk"}}:x);
    expect(residentsHomeOn(mixed,r.home.level,r.home.tower).map(x=>x.id)).not.toContain(r.id);
    expect(residentsOn(mixed,r.home.level,r.home.tower).map(x=>x.id)).toContain(r.id);
  });
});
