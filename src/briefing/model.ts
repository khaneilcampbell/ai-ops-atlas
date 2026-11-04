import type {AtlasEvent} from "../lib/activity";
import type {RepoState} from "../github/types";
import {repoData} from "../lib/derive";
export interface Briefing {
 at:string; since:string; changes:AtlasEvent[]; actions:{event:AtlasEvent;owner:string}[];
 coverage:{repository:string;checked:string|null;unavailable:boolean;stale:boolean}[];
}
/** One in-memory cached report per caller; no additional reads or model work. */
export function briefingGenerator() {
 let previous:{key:string;report:Briefing}|undefined;
 return (events:AtlasEvent[],repos:Record<string,RepoState>,hours:number,owners:Record<string,string>,now=Date.now()):Briefing=>{
  const coverage=Object.entries(repos).sort(([a],[b])=>a.localeCompare(b)).map(([repository,state])=>{
   const data=repoData(state),checked=data?.runsCheckedAt??data?.fetchedAt??null;
   return {repository,checked,unavailable:state.kind!=="ok",stale:!checked || !Number.isFinite(Date.parse(checked)) || now-Date.parse(checked)>86400000 || state.kind==="error" || (state.kind==="ok"&&state.stale)};
  });
  const key=JSON.stringify([events,coverage,hours,owners,Math.floor(now/60000)]);
  if(previous?.key===key)return previous.report;
  const seen=new Map<string,AtlasEvent>();
  for(const event of events){
   const at=Date.parse(event.at);if(!Number.isFinite(at)||at>now||at<now-hours*3600000)continue;
   const old=seen.get(event.id);
   if(!old || (old.result==="running"&&event.result!=="running") || event.at>old.at)seen.set(event.id,event);
  }
  const ordered=[...seen.values()].sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id));
  const latest=new Map<string,AtlasEvent>();
  for(const event of ordered){const identity=`${event.agentId??event.repo??"workspace"}:${event.kind}:${event.title}`;if(!latest.has(identity))latest.set(identity,event);}
  const report={at:new Date(now).toISOString(),since:new Date(now-hours*3600000).toISOString(),changes:ordered.slice(0,6),actions:[...latest.values()].filter(e=>e.result==="failure").slice(0,3).map(event=>({event,owner:event.agentId?owners[event.agentId]??"Agent owner (unassigned)":"Repository maintainer"})),coverage};
  previous={key,report};return report;
 };
}
