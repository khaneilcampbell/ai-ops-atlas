import { useEffect, useState } from 'react';
import { loadRunOutputs, outputRun, type RunOutputs } from '../github/runOutputs';
import { formatDate, relative } from '../lib/time';
import { ExternalLink } from './bits';
import { RepositoryNotice } from './RepositoryNotice';

/** Mounted only by the Output tab. Generated file contents stay on GitHub. */
export function WorkflowOutput({repo, runs, documentation=false}:{repo:string;runs:{at:string;label:string;url?:string;offMainline?:boolean}[];documentation?:boolean}) {
  const available = runs.flatMap(r => {const id=outputRun(repo,r.url);return id ? [{...r,id}] : [];}).slice(0,10);
  const defaultRun=available.find(r=>!r.offMainline) ?? available[0];
  const [picked,setPicked]=useState(defaultRun?.id ?? 0);
  const run=available.find(r=>r.id===picked) ?? defaultRun;
  const id=run?.id;
  const [state,setState]=useState<{key:string;data?:RunOutputs;error?:string;loading:boolean}>({key:'',loading:false});
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!id)return;
    let active=true;
    const key=`${repo}/${id}`;
    setState(previous=>({key,data:previous.key===key?previous.data:undefined,loading:true}));
    void loadRunOutputs(repo,id,revision>0).then(data=>{if(active)setState({key,data,loading:false});},error=>{if(active)setState(previous=>({...previous,key,error:error instanceof Error?error.message:'Output could not be loaded.',loading:false}));});
    return()=>{active=false;};
  },[repo,id,revision]);
  const current=state.key===`${repo}/${id}`?state:undefined;
  const data=current?.data;
  if(!run)return <p className="small">No recorded GitHub workflow is connected. Local and external agents must publish a report before Atlas can show generated files.</p>;
  return <section aria-label="Workflow output" aria-busy={!!current?.loading} style={{overflowWrap:"anywhere"}}>
    <div className="section-title">Generated files & job results</div>
    <label className="field small" style={{display:"block",height:"auto",margin:"8px 0",padding:"8px 10px"}}>Workflow run<select aria-label="Output workflow run" style={{display:"block",width:"100%",maxWidth:"100%",height:"auto",marginTop:6,fontSize:16}} value={run.id} onChange={e=>{setPicked(Number(e.target.value));setRevision(0);}}>{available.map(r=><option key={`${r.id}:${r.at}`} value={r.id}>{formatDate(r.at)} · {r.label}</option>)}</select></label>
    <button className="text-btn" disabled={current?.loading} onClick={()=>setRevision(n=>n+1)}>Refresh output</button>
    <p className="muted small">Read-only metadata, loaded when you open Output. No workflow or model is started. Files open on GitHub and may require sign-in.</p>
    {current?.loading&&<p role="status">Loading workflow output…</p>}
    {current?.error&&<p role="alert" className="notice">{current.error}</p>}
    {data&&<>
      <p className="muted small">Retrieved {formatDate(data.checkedAt)} ({relative(data.checkedAt)}). Refreshes reuse recent results to save requests.</p>
      {data.errors.map(error=><div role="alert" key={error}><RepositoryNotice message={error} actions={false}/></div>)}
      <h3 className="small">Generated files</h3>
      {data.artifacts.length>0?<ul className="timeline">{data.artifacts.map(a=><li key={a.id}><strong className="small">{a.name}</strong><div className="muted small">{a.bytes===null?'Size unavailable':`${(a.bytes/1024).toFixed(1)} KB`} · {a.expired===null?'Availability not reported':a.expired?'Expired':a.expiresAt?`Available until ${formatDate(a.expiresAt)}`:'Available'}</div>{a.expired===false&&<ExternalLink href={a.url}>Open generated files →</ExternalLink>}</li>)}</ul>:!data.errors.some(e=>e.startsWith('Files:'))&&<p className="small">This run has no uploaded files. A successful check does not necessarily produce a downloadable file.{documentation?' This documentation workflow uploads DOCX only for a manual run with “documents” enabled. Atlas does not start that run.':''}</p>}
      {data.artifactsTotal>data.artifacts.length&&<p className="muted small">Showing {data.artifacts.length} of {data.artifactsTotal} files; open the source run for the full list.</p>}
      <h3 className="small">Job results</h3>
      {data.jobs.map(j=><details key={j.id} style={{marginBottom:12}}><summary className="small">{j.name} · {j.conclusion??j.status}</summary><ol className="small">{j.steps.map((s,i)=><li key={i}>{s.name} · {s.conclusion??s.status}</li>)}</ol>{j.stepsTotal>j.steps.length&&<p className="muted small">Showing {j.steps.length} of {j.stepsTotal} steps; open the job for the full result.</p>}<ExternalLink href={j.url}>Open job logs →</ExternalLink></details>)}
      {!data.jobs.length&&!data.errors.some(e=>e.startsWith('Job results:'))&&<p className="small">No job results are published for this run yet.</p>}
      {data.jobsTotal>data.jobs.length&&<p className="muted small">Showing {data.jobs.length} of {data.jobsTotal} jobs.</p>}
    </>}
    <ExternalLink href={`https://github.com/${repo}/actions/runs/${run.id}`}>Open source run →</ExternalLink>
  </section>;
}
