import type {Agent} from "./types";

export const WORKPLACE_BUILDINGS=["OpenAI","Anthropic","Wells Fargo","Starbucks","Smashburger","Chipotle","Zara","Canva","Stripe"] as const;
export function projectOfficeAgents(agents:Agent[],projectId:string){
  return agents.filter(a=>a.projectId===projectId&&!a.workplace);
}
export function workplaceAgent(agents:Agent[],building:string,floor:number,room:string){
  return agents.find(a=>a.workplace?.building===building&&a.workplace.floor===floor&&a.workplace.room===room);
}
