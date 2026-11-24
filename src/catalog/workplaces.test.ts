import {expect,it} from "vitest";
import {catalog} from "./index";
import {buildCatalog} from "./parse";
import {officeAutomations,officeDeskAgents,projectOfficeAgents,workplaceAgent} from "./workplaces";
import {isAiAgent} from "./roles";
import {WORKSPACE} from "../modules/workspace";

// Agents that operate a landmark building (workspace.yaml `agents`) are placed there, not at headquarters.
const operators=()=>catalog.agents.filter(a=>WORKSPACE.landmarks.some(l=>l.agents?.includes(a.id)));

it("seats every agent exactly somewhere, and keeps the five agents deleted on 2026-11-14 gone",()=>{
  for(const id of ["atlas-system-improvements","atlas-ui-improvement-designer","atlas-reliability-reviewer","atlas-performance-reviewer","atlas-github-steward"])
    expect(catalog.agents.find(a=>a.id===id)).toBeUndefined();
  const placed=[...catalog.projects.flatMap(p=>projectOfficeAgents(catalog.agents,p.id)),...catalog.agents.filter(a=>a.workplace),...operators()];
  expect(placed.map(a=>a.id).sort()).toEqual(catalog.agents.map(a=>a.id).sort());
});

const manifest=(workplace:string)=>`schema: atlas/v2\nproject: {id: demo, name: Demo, summary: s, status: idle, repository: me/demo}\nagents:\n  - {id: first, name: First, purpose: p, framework: f, status: idle, workplace: ${workplace}}\n`;
it("rejects unsupported rooms, floor mismatches, and double-booked workplaces",()=>{
  expect(buildCatalog({"a.yaml":manifest('{building: Atlas Marketplace, floor: 2, room: "101"}')}).issues[0].message).toContain("match");
  expect(buildCatalog({"a.yaml":manifest('{building: Atlas Marketplace, floor: 5, room: "501"}')}).issues.length).toBeGreaterThan(0);
  expect(buildCatalog({"a.yaml":manifest('{building: Model Lab, floor: 4, room: "401"}')}).issues.length).toBeGreaterThan(0);
  const valid=manifest('{building: Atlas Marketplace, floor: 1, room: "108"}');
  expect(buildCatalog({"a.yaml":valid}).issues).toEqual([]);
  const duplicate=valid+'  - {id: second, name: Second, purpose: p, framework: f, status: idle, workplace: {building: Atlas Marketplace, floor: 1, room: "108"}}\n';
  expect(buildCatalog({"a.yaml":duplicate}).issues[0].message).toContain("more than one worker");
});

it("assigns the Production Coordinator only to Atlas Floor 3 and rejects invalid floors",()=>{
 const team=catalog.agents.filter(a=>a.officeFloor===3);
 expect(team.map(a=>a.id).sort()).toEqual(["atlas-production-coordinator"]);
 expect(team.every(a=>a.projectId==="ai-ops-atlas"&&!a.workplace&&a.status==="idle")).toBe(true);
 expect(team.find(a=>a.id==="atlas-production-coordinator")?.observe?.githubWorkflow).toBe("benjaire-production.yml");
 for(const floor of [0,5,2.5,'"2"']) {
  const yaml=manifest('{building: Model Lab, floor: 4, room: "401"}').replace('workplace: {building: Model Lab, floor: 4, room: "401"}',`office_floor: ${floor}`);
  expect(buildCatalog({"a.yaml":yaml}).issues.length).toBeGreaterThan(0);
 }
});

it('assigns Marketplace workers once, preserving their Commerce ownership and runtime',async()=>{
 const {MARKETPLACE_WORKSPACES,marketplaceAssignedAgent}=await import('../views/office/marketplaceWorkspaces');
 for(const w of MARKETPLACE_WORKSPACES){
  if(catalog.agents.find(x=>x.id===w.agentId)?.status==='retired'){expect(marketplaceAssignedAgent(w.unitId,catalog.agents)).toBeUndefined();continue;}
  const a=marketplaceAssignedAgent(w.unitId,catalog.agents)!;
  expect(a.id).toBe(w.agentId);expect(a.projectId).toBe('commerce-pipeline');
  expect(a.repository).toBe('khaneilcampbell/multi-agent-commerce-pipeline');
  expect(a.workplace?.floor).toBe(1);expect(a.workplace?.building).toBe('Atlas Marketplace');
  expect(projectOfficeAgents(catalog.agents,a.projectId).some(x=>x.id===a.id)).toBe(false);
 }
 const placements=[...catalog.projects.flatMap(p=>projectOfficeAgents(catalog.agents,p.id)),...catalog.agents.filter(a=>a.workplace),...operators()];
 expect(new Set(placements.map(a=>a.id)).size).toBe(catalog.agents.length);
 expect(placements).toHaveLength(catalog.agents.length);
});
it('validates Marketplace rooms without allowing unsupported suites elsewhere',()=>{
 expect(buildCatalog({'a.yaml':manifest('{building: Atlas Marketplace, floor: 1, room: "108"}')}).issues).toEqual([]);
 for(const w of ['{building: Atlas Marketplace, floor: 2, room: "208"}','{building: Model Lab, floor: 1, room: "108"}'])expect(buildCatalog({'a.yaml':manifest(w)}).issues.length).toBeGreaterThan(0);
});

it("leaves rooms of retired agents vacant",()=>{
 const retired=catalog.agents.filter(a=>a.status==="retired"&&a.workplace);
 expect(retired.length).toBeGreaterThan(0);
 for(const a of retired)expect(workplaceAgent(catalog.agents,a.workplace!.building,a.workplace!.floor,a.workplace!.room)).toBeUndefined();
});

it("leaves Marketplace Unit 101 empty now the Skyline Inquiry Assistant is removed",()=>{
 expect(workplaceAgent(catalog.agents,"Atlas Marketplace",1,"101")).toBeUndefined();
 expect(projectOfficeAgents(catalog.agents,"skyline")).toEqual([]);
});

it("seats Benjaire Product Lab in Marketing Agency rooms that exist in the interior plan",async()=>{
 const {AGENCY_ROOMS}=await import("../views/office/agencyInteriorPlan");
 const {AGENCY_WORKPLACE_ROOMS}=await import("./workplaces");
 expect([...AGENCY_WORKPLACE_ROOMS].sort()).toEqual(AGENCY_ROOMS.filter(r=>r.level>=1).map(r=>r.id).sort());
 const seats:Record<string,string>={"1-strategy":"benjaire-product-lab","2-insights":"benjaire-product-lab-research","2-archive":"benjaire-product-lab-competitors","1-social":"benjaire-product-lab-customers","2-workshop":"benjaire-product-lab-scoring","1-review":"benjaire-product-lab-brief"};
 for(const [room,id] of Object.entries(seats)){
  const a=workplaceAgent(catalog.agents,"Benjaire Marketing Agency",Number(room[0]),room)!;
  expect(a.id).toBe(id);expect(a.repository).toBe("khaneilcampbell/benjaire.com");
  expect(projectOfficeAgents(catalog.agents,a.projectId)).not.toContain(a);
 }
 expect(buildCatalog({"a.yaml":manifest('{building: Benjaire Marketing Agency, floor: 1, room: "1-strategy"}')}).issues).toEqual([]);
 for(const w of ['{building: Benjaire Marketing Agency, floor: 1, room: "101"}','{building: Benjaire Marketing Agency, floor: 2, room: "1-strategy"}','{building: Benjaire Marketing Agency, floor: 1, room: "1-lobby"}','{building: Model Lab, floor: 1, room: "1-strategy"}'])
  expect(buildCatalog({"a.yaml":manifest(w)}).issues.length).toBeGreaterThan(0);
});

it("offers Creative Campus desk rooms that exist in the interior plan, with nobody seated yet",async()=>{
 const {CAMPUS_DESK_ROOMS}=await import("../views/office/campusInteriorPlan");
 const {CAMPUS_WORKPLACE_ROOMS}=await import("./workplaces");
 expect([...CAMPUS_WORKPLACE_ROOMS].sort()).toEqual(CAMPUS_DESK_ROOMS.map(r=>r.id).sort());
 // Khaneil chose empty desks for now (2026-11-24).
 expect(catalog.agents.filter(a=>a.workplace?.building==="Atlas Creative Campus")).toEqual([]);
 expect(buildCatalog({"a.yaml":manifest('{building: Atlas Creative Campus, floor: 1, room: "1-west1"}')}).issues).toEqual([]);
 for(const w of ['{building: Atlas Creative Campus, floor: 1, room: "1-west2"}','{building: Atlas Creative Campus, floor: 2, room: "1-west1"}','{building: Atlas Creative Campus, floor: 1, room: "101"}'])
  expect(buildCatalog({"a.yaml":manifest(w)}).issues.length).toBeGreaterThan(0);
});

it("gives desks to AI agents only; automations are counted but never take an agent's desk",()=>{
  const hq=catalog.projects.find(p=>p.id==="ai-ops-atlas")!;
  const desks=officeDeskAgents(catalog.agents,hq.id);
  const autos=officeAutomations(catalog.agents,hq.id);
  expect(desks.length).toBeGreaterThan(0);
  expect(autos.length).toBeGreaterThan(0);
  expect(desks.every(a=>isAiAgent(a))).toBe(true);
  expect(autos.some(a=>isAiAgent(a))).toBe(false);
  for(const p of catalog.projects)expect(officeDeskAgents(catalog.agents,p.id).filter(a=>!isAiAgent(a))).toEqual([]);
});
