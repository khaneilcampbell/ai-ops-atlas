import {expect,it} from "vitest";
import {catalog} from "./index";
import {buildCatalog} from "./parse";
import {projectOfficeAgents,workplaceAgent} from "./workplaces";

it("places the Atlas improvement role only in OpenAI Suite 401 without changing repo ownership",()=>{
  const agent=workplaceAgent(catalog.agents,"OpenAI",4,"401")!;
  expect(agent.id).toBe("atlas-system-improvements");
  expect(agent.repository).toBe("khaneilcampbell/ai-ops-atlas");
  expect(agent.projectId).toBe("ai-ops-atlas");
  expect(projectOfficeAgents(catalog.agents,"ai-ops-atlas").some(a=>a.id===agent.id)).toBe(false);
  const placed=[...catalog.projects.flatMap(p=>projectOfficeAgents(catalog.agents,p.id)),...catalog.agents.filter(a=>a.workplace)];
  expect(placed.map(a=>a.id).sort()).toEqual(catalog.agents.map(a=>a.id).sort());
});

const manifest=(workplace:string)=>`schema: atlas/v2\nproject: {id: demo, name: Demo, summary: s, status: idle, repository: me/demo}\nagents:\n  - {id: first, name: First, purpose: p, framework: f, status: idle, workplace: ${workplace}}\n`;
it("rejects unsupported rooms, floor mismatches, and double-booked workplaces",()=>{
  expect(buildCatalog({"a.yaml":manifest('{building: OpenAI, floor: 2, room: "401"}')}).issues[0].message).toContain("match");
  expect(buildCatalog({"a.yaml":manifest('{building: OpenAI, floor: 5, room: "501"}')}).issues.length).toBeGreaterThan(0);
  const valid=manifest('{building: OpenAI, floor: 4, room: "401"}');
  expect(buildCatalog({"a.yaml":valid}).issues).toEqual([]);
  const duplicate=valid+'  - {id: second, name: Second, purpose: p, framework: f, status: idle, workplace: {building: OpenAI, floor: 4, room: "401"}}\n';
  expect(buildCatalog({"a.yaml":duplicate}).issues[0].message).toContain("more than one worker");
});

it("keeps the UI designer manual-only in its own OpenAI suite",()=>{
 const agent=workplaceAgent(catalog.agents,"OpenAI",4,"402")!;
 expect(agent.id).toBe("atlas-ui-improvement-designer");
 expect(agent.repository).toBe("khaneilcampbell/ai-ops-atlas");
 expect(agent.trigger).toBe("Explicit maintainer request only; no schedule");
 expect(agent.observe).toBeUndefined();
 expect(projectOfficeAgents(catalog.agents,"ai-ops-atlas").some(a=>a.id===agent.id)).toBe(false);
});

it("assigns the manual production team only to Atlas Floor 3 and rejects invalid floors",()=>{
 const team=catalog.agents.filter(a=>a.officeFloor===3);
 expect(team.map(a=>a.id).sort()).toEqual(["atlas-performance-reviewer","atlas-production-coordinator","atlas-reliability-reviewer"]);
 expect(team.every(a=>a.projectId==="ai-ops-atlas"&&!a.workplace&&!a.observe&&a.status==="idle")).toBe(true);
 for(const floor of [0,5,2.5,'"2"']) {
  const yaml=manifest('{building: OpenAI, floor: 4, room: "401"}').replace('workplace: {building: OpenAI, floor: 4, room: "401"}',`office_floor: ${floor}`);
  expect(buildCatalog({"a.yaml":yaml}).issues.length).toBeGreaterThan(0);
 }
});
