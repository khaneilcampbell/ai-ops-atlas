import {useRef,useState} from "react";
import {briefingGenerator,type Briefing} from "../briefing/model";
import {projectRepositories} from "../catalog/projects";
import {workspaceEvents,type AtlasEvent} from "../lib/activity";
import {useAtlas} from "../state";
import {useIntel} from "../intel/state";
import {useActions} from "../actions/state";
import {ExternalLink} from "./bits";
function Evidence({event}:{event:AtlasEvent}) {
 return <span style={{overflowWrap:"anywhere"}}>{event.url?<ExternalLink href={event.url}>{event.title}</ExternalLink>:event.title} · {event.result??event.kind} · {event.at} · Source: {event.kind==="manifest"?"Catalog":event.kind==="intel"?"Saved intelligence":event.kind==="action"?"Desktop audit":"GitHub"}{!event.url&&" (no external evidence link recorded)"}</span>;
}
export function OperationsBriefing(){
 const {catalog,repos,uncataloged}=useAtlas(),intel=useIntel(),actions=useActions();
 const generate=useRef(briefingGenerator()),[hours,setHours]=useState(24),[report,setReport]=useState<Briefing|null>(null);
 return <section className="card" aria-label="Operations Briefing" style={{marginBottom:20,padding:20}}>
  <h2>Operations Briefing</h2><p className="small muted">Manual, model-free summary of saved evidence. Generating makes no network requests and activates no schedule.</p>
  <div className="filters"><label className="field">Period<select aria-label="Briefing period" value={hours} onChange={e=>{setHours(Number(e.target.value));setReport(null);}}><option value={24}>24 hours</option><option value={168}>7 days</option></select></label>
   <button className="btn" onClick={()=>{
    const names=[...new Set([...Object.keys(repos),...catalog.projects.flatMap(p=>projectRepositories(p,catalog.agents))])];
    const sources=Object.fromEntries(names.map(name=>[name,repos[name]??{kind:"loading" as const}]));
    setReport(generate.current(workspaceEvents(catalog,repos,uncataloged,intel.telemetry?.runs??[],actions.audit),sources,hours,Object.fromEntries(catalog.agents.map(a=>[a.id,a.name]))));
   }}>Generate briefing</button></div>
  {report && <>
   <p className="small">As of {report.at} · Since {report.since}. Unchanged evidence reuses the report within one minute.</p>
   <p className="notice">Coverage gaps: {report.coverage.filter(s=>s.unavailable).length} unavailable sources; {report.coverage.filter(s=>s.stale).length} stale or unchecked sources. Product checkpoints, external approval decisions, live business metrics and billing costs are not included. Missing data is unknown.</p>
   <h3>Next actions · maximum three</h3>
   {report.actions.length?<ul>{report.actions.map(({event,owner})=><li key={event.id} className="small"><b>Inspect failure · {owner}</b><br/><Evidence event={event}/></li>)}</ul>:<p className="small">No failure-derived next action in this sample. This does not verify production health.</p>}
   <details><summary>What changed ({report.changes.length} recent records shown)</summary><ul>{report.changes.map(e=><li className="small" key={e.id}><Evidence event={e}/></li>)}</ul>{!report.changes.length&&<p>No saved event in this period.</p>}</details>
   <details><summary>Source coverage and last checks</summary><ul>{report.coverage.map(source=><li className="small" key={source.repository}><ExternalLink href={`https://github.com/${source.repository}`}>{source.repository}</ExternalLink> · {source.unavailable?"Unavailable":source.stale?"Saved / stale":"Saved evidence"} · Checked {source.checked??"never"}</li>)}</ul></details>
   <p className="small muted">Workflow success does not prove deployment or product publication. Estimates, manual finance entries, and provider invoices are not combined into a spending total.</p>
  </>}
 </section>;
}
