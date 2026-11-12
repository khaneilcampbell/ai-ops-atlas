import {expect,it} from "vitest";
import {catalog} from "./index";
import {buildCatalog} from "./parse";
import {projectOfficeAgents,workplaceAgent} from "./workplaces";
import {WORKSPACE} from "../modules/workspace";

// Agents that operate a landmark building (workspace.yaml `agents`) are placed there, not at headquarters.
const operators=()=>catalog.agents.filter(a=>WORKSPACE.landmarks.some(l=>l.agents?.includes(a.id)));

it("moves the Model Lab agents to Atlas HQ when Skyline is removed, keeping repo ownership",()=>{
  for(const id of ["atlas-system-improvements","atlas-ui-improvement-designer"]){
    const agent=catalog.agents.find(a=>a.id===id)!;
    expect(agent.workplace).toBeUndefined();
    expect(agent.repository).toBe("khaneilcampbell/ai-ops-atlas");
    expect(projectOfficeAgents(catalog.agents,"ai-ops-atlas")).toContain(agent);
  }
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

it("keeps the UI designer manual-only",()=>{
 const agent=catalog.agents.find(a=>a.id==="atlas-ui-improvement-designer")!;
 expect(agent.trigger).toBe("Explicit maintainer request only; no schedule");
 expect(agent.observe).toBeUndefined();
});

it("assigns the manual production team only to Atlas Floor 3 and rejects invalid floors",()=>{
 const team=catalog.agents.filter(a=>a.officeFloor===3);
 expect(team.map(a=>a.id).sort()).toEqual(["atlas-performance-reviewer","atlas-production-coordinator","atlas-reliability-reviewer"]);
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
