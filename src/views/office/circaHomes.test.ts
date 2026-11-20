import {describe,expect,it} from "vitest";
import {catalog} from "../../catalog/index";
import {agentJobs} from "../../catalog/agentJobs";
import {cityFigureFor} from "../../registry/cityFigures";
import {identityFor} from "../../registry/identity";
import {circaApartments} from "./circaNav";
import {circaHome,circaResidents,livingOf} from "./circaHomes";
import {residentsOn,type CircaResidentNow} from "./CircaWalkers";

const jobs=agentJobs(catalog);
const residents=circaResidents(jobs,id=>!!cityFigureFor(id));
const shown:CircaResidentNow[]=residents.map(r=>({...r,figure:cityFigureFor(r.id),identity:identityFor(r.id,catalog.agents,r.name)}));

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

describe("Shown in their own apartments, no loop",()=>{
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
