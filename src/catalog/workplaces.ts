import type {Agent} from "./types";

export const WORKPLACE_BUILDINGS=["Skyline","Atlas Marketplace","OpenAI","Anthropic","Wells Fargo","Starbucks","Smashburger","Chipotle","Zara"] as const;
export function projectOfficeAgents(agents:Agent[],projectId:string){
  return agents.filter(a=>a.projectId===projectId&&!a.workplace);
}
export function workplaceAgent(agents:Agent[],building:string,floor:number,room:string){
  return agents.find(a=>a.workplace?.building===building&&a.workplace.floor===floor&&a.workplace.room===room);
}

/** Marketplace has eight first-floor production units; other suites retain the established grid. */
export function validWorkplaceRoom(building:string,floor:number,room:string){
 return Number.isInteger(floor)&&floor>=1&&floor<=4&&Number(room[0])===floor&&(building==='Atlas Marketplace'?floor===1&&/^10[1-8]$/.test(room):/^[1-4]0[1-4]$/.test(room));
}
