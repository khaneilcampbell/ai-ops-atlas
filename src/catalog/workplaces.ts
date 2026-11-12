import type {Agent} from "./types";
import {WORKSPACE} from "../modules/workspace";

/** Buildings an agent can be assigned a room in. The Skyline buildings left with the district (2026-11-08). */
export const WORKPLACE_BUILDINGS=["Atlas Marketplace","Benjaire Marketing Agency"] as const;
/**
 * Benjaire Marketing Agency rooms that can hold a worker: the upper-floor room ids of AGENCY_ROOMS
 * in views/office/agencyInteriorPlan.ts (level = floor). Kept as a plain list so the catalog does not
 * import view code; a test checks the two stay in step.
 */
export const AGENCY_WORKPLACE_ROOMS=["1-content","1-social","1-strategy","1-review","1-gallery","2-archive","2-insights","2-exhibition","2-workshop","3-hall","3-foyer","3-green"] as const;
/** Agents that operate a landmark building (workspace.yaml `agents`) work there, so they get no headquarters desk. */
const LANDMARK_AGENTS=new Set(WORKSPACE.landmarks.flatMap(l=>l.agents??[]));
export function projectOfficeAgents(agents:Agent[],projectId:string){
  return agents.filter(a=>a.projectId===projectId&&!a.workplace&&!LANDMARK_AGENTS.has(a.id));
}
export function workplaceAgent(agents:Agent[],building:string,floor:number,room:string){
  return agents.find(a=>a.workplace?.building===building&&a.workplace.floor===floor&&a.workplace.room===room);
}

/** Marketplace has eight first-floor production units, the Agency uses its named rooms; other suites retain the established grid. */
export function validWorkplaceRoom(building:string,floor:number,room:string){
 if(!(Number.isInteger(floor)&&floor>=1&&floor<=4&&Number(room[0])===floor))return false;
 if(building==='Benjaire Marketing Agency')return (AGENCY_WORKPLACE_ROOMS as readonly string[]).includes(room);
 return building==='Atlas Marketplace'?floor===1&&/^10[1-8]$/.test(room):/^[1-4]0[1-4]$/.test(room);
}
