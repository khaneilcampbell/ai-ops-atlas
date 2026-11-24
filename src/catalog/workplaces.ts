import type {Agent} from "./types";
import {WORKSPACE} from "../modules/workspace";
import {isAiAgent} from "./roles";

/** Buildings an agent can be assigned a room in. The Skyline buildings left with the district (2026-11-08). */
export const WORKPLACE_BUILDINGS=["Atlas Marketplace","Benjaire Marketing Agency","Atlas Creative Campus"] as const;
/**
 * Benjaire Marketing Agency rooms that can hold a worker: the upper-floor room ids of AGENCY_ROOMS
 * in views/office/agencyInteriorPlan.ts (level = floor). Kept as a plain list so the catalog does not
 * import view code; a test checks the two stay in step.
 */
export const AGENCY_WORKPLACE_ROOMS=["1-content","1-social","1-strategy","1-review","1-gallery","2-archive","2-insights","2-exhibition","2-workshop","3-hall","3-foyer","3-green"] as const;
/**
 * Atlas Creative Campus rooms with desks: CAMPUS_DESK_ROOMS in views/office/campusInteriorPlan.ts
 * (level = floor). No agent is seated yet (Khaneil chose empty desks, 2026-11-24); a test keeps the lists in step.
 */
export const CAMPUS_WORKPLACE_ROOMS=["1-west1","1-west3","1-west4","1-east1","1-east3","1-east4","1-south1","1-south4","2-west2","2-west3","2-west4","2-east2","2-east3","2-east4","2-south2","2-south3","2-south4","3-west1","3-west2","3-west4","3-east1","3-east2","3-east4","3-south1","3-south2","3-south3","3-south4","4-west3","4-west4","4-east3","4-east4","4-south4"] as const;
/** Agents that operate a landmark building (workspace.yaml `agents`) work there, so they get no headquarters desk. */
const LANDMARK_AGENTS=new Set(WORKSPACE.landmarks.flatMap(l=>l.agents??[]));
export function projectOfficeAgents(agents:Agent[],projectId:string){
  return agents.filter(a=>a.projectId===projectId&&!a.workplace&&!LANDMARK_AGENTS.has(a.id));
}
/**
 * The workers who get a desk in a headquarters office: AI agents only. An automation is a workflow,
 * not a member of staff, so it never takes an agent's desk (Khaneil, 2026-11-18); the office sign
 * still counts it.
 */
export function officeDeskAgents(agents:Agent[],projectId:string){
  return projectOfficeAgents(agents,projectId).filter(a=>isAiAgent(a));
}
/** The automations a headquarters runs: counted on its sign, never seated at a desk. */
export function officeAutomations(agents:Agent[],projectId:string){
  return projectOfficeAgents(agents,projectId).filter(a=>a.status!=="retired"&&!isAiAgent(a));
}
/** The current agent seated in a room. A retired agent no longer runs anywhere, so its room reads vacant. */
export function workplaceAgent(agents:Agent[],building:string,floor:number,room:string){
  return agents.find(a=>a.status!=="retired"&&a.workplace?.building===building&&a.workplace.floor===floor&&a.workplace.room===room);
}

/** Marketplace has eight first-floor production units, the Agency uses its named rooms; other suites retain the established grid. */
export function validWorkplaceRoom(building:string,floor:number,room:string){
 if(!(Number.isInteger(floor)&&floor>=1&&floor<=4&&Number(room[0])===floor))return false;
 if(building==='Benjaire Marketing Agency')return (AGENCY_WORKPLACE_ROOMS as readonly string[]).includes(room);
 if(building==='Atlas Creative Campus')return (CAMPUS_WORKPLACE_ROOMS as readonly string[]).includes(room);
 return building==='Atlas Marketplace'?floor===1&&/^10[1-8]$/.test(room):/^[1-4]0[1-4]$/.test(room);
}
