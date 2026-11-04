import {useRef,useState} from "react";
import {MAX_CHECKPOINT_BYTES,parseCheckpoint,type TaskCheckpoint as Checkpoint} from "../tasks/checkpoint";
import {ExternalLink} from "./bits";

export function TaskCheckpoint() {
 const [report,setReport]=useState<Checkpoint|null>(null),[error,setError]=useState("");
 const version=useRef(0);
 return <section aria-label="Benjaire task checkpoint">
  <div className="section-title">Benjaire task checkpoint</div>
  <p className="small">Product brief → supplied draft → quality review → exact-version approval → release preparation. Owner: Commerce Pipeline; coordinator: Atlas Production Coordinator. Paid creation and publishing stay disabled.</p>
  <label className="field" style={{display:"block"}}>Import local job report<input type="file" accept=".json,application/json" onChange={async event=>{
   const current=++version.current,file=event.target.files?.[0];setReport(null);setError("");
   if(!file)return;
   try{if(file.size>MAX_CHECKPOINT_BYTES)throw new Error();const parsed=parseCheckpoint(await file.text());if(current===version.current)setReport(parsed);}
   catch{if(current===version.current)setError("Unsupported or oversized checkpoint. Choose the runner's job.json (maximum 64 KB). No report contents were saved.");}
  }}/></label>
  {error && <p role="alert">{error}</p>}
  {report ? <>
   <p><b>{report.status}</b> · {report.stage} · {report.fixture ? "Synthetic fixture" : "Supplied draft"}</p>
   <p className="small" style={{overflowWrap:"anywhere"}}>Job: {report.job}<br/>Input version: {report.input ?? "Not recorded"}<br/>Review version: {report.review ?? "Not ready"}</p>
   <p className="small">Source: imported local runner report, not live telemetry. Last observed: {report.at}. {report.status==="running" ? "Running is a historical report; current execution is unverified." : "The current runner and artifacts have not been reverified by this import."}</p>
   <p className="small">Quality findings: {report.qualityFailures ?? "Not recorded"}. Artifact references: {report.artifacts.join(", ") || "None recorded"}. Open the local job directory to inspect the actual brief, draft and findings.</p>
   <p className="small">Approval: {report.approved ? "Report names this review version; verify the recorded actor and artifacts locally." : "No matching approval recorded."} Preparation approval never authorizes publication.</p>
  </> : <p className="small">No local checkpoint imported. Create or resume a task with the existing manual runner; inspect its saved job.json here. Import stays in memory and is cleared when this panel closes.</p>}
  <p className="small">Start, resume, stop and approval need the local runner; this platform has no task-execution bridge. Importing a checkpoint does not change agent status or authorize an action.</p>
  <div className="chips">{["Start","Resume","Stop","Approve"].map(action=><button className="btn" key={action} disabled title="Use the existing local runner; no execution bridge is connected">{action}</button>)}</div>
  <ExternalLink href="https://github.com/khaneilcampbell/ai-ops-atlas/tree/main/ops/benjaire-production">Manual start, stop, resume and approval instructions</ExternalLink>
 </section>;
}
