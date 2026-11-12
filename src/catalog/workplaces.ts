import type {Agent} from "./types";

/** Buildings an agent can be assigned a room in. The Skyline buildings left with the district (2026-11-08). */
export const WORKPLACE_BUILDINGS=["Atlas Marketplace","Benjaire Marketing Agency"] as const;
/**
 * Benjaire Marketing Agency rooms that can hold a worker: the upper-floor room ids of AGENCY_ROOMS
 * in views/office/agencyInteriorPlan.ts (level = floor). Kept as a plain list so the catalog does not
 * import view code; a test checks the two stay in step.
 */
export const AGENCY_WORKPLACE_ROOMS=["1-content","1-social","1-strategy","1-review","1-gallery","2-archive","2-insights","2-exhibition","2-workshop","3-hall","3-foyer","3-green"] as const;
export function projectOfficeAgents(agents:Agent[],projectId:string){
  return agents.filter(a=>a.projectId===projectId&&!a.workplace);
}
/** The current agent seated in a room. A retired agent no longer runs anywhere, so its room reads vacant. */
export function workplaceAgent(agents:Agent[],building:string,floor:number,room:string){
  return agents.find(a=>a.status!=="retired"&&a.workplace?.building===building&&a.workplace.floor===floor&&a.workplace.room===room);
}

/** Marketplace has eight first-floor production units, the Agency uses its named rooms; other suites retain the established grid. */
export function validWorkplaceRoom(building:string,floor:number,room:string){
 if(!(Number.isInteger(floor)&&floor>=1&&floor<=4&&Number(room[0])===floor))return false;
 if(building==='Benjaire Marketing Agency')return (AGENCY_WORKPLACE_ROOMS as readonly string[]).includes(room);
 return building==='Atlas Marketplace'?floor===1&&/^10[1-8]$/.test(room):/^[1-4]0[1-4]$/.test(room);
}
