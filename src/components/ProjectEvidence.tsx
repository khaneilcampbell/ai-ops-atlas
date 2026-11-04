import type { Project } from "../catalog/types";
import { useAtlas } from "../state";
import { observedRun, repoData } from "../lib/derive";
import { projectEvidence } from "../lib/projectEvidence";
import { ExternalLink } from "./bits";

export function ProjectEvidence({project}:{project:Project}) {
  const {catalog,repos,select} = useAtlas();
  const evidence = projectEvidence(project,catalog,repos);
  const agents = catalog.agents.filter(a=>a.projectId===project.id);
  return <section aria-label="Project intelligence">
    <div className="section-title">Project intelligence</div>
    <p className="small muted">Declared {project.status} comes from the catalog. Repository checks, deployment evidence, and agent activity are separate.</p>
    {evidence.map(item=><details key={item.name} open={evidence.length===1}>
      <summary>{item.name} · {item.stale ? "Saved / stale" : item.snapshot ? "Evidence loaded" : "Not verified"}</summary>
      <p className="small">{item.attention}</p>
      <p className="small muted">Source: GitHub · Last successful snapshot: {item.snapshot?.fetchedAt ?? "None"} · Workflow check: {item.snapshot?.runsCheckedAt ?? "Not recorded"}</p>
      {item.failed.map(run=><p key={run.url}><ExternalLink href={run.url}>{run.name} · {run.conclusion} · {run.createdAt}</ExternalLink></p>)}
      {item.snapshot?.commits.slice(0,2).map(commit=><p className="small" key={commit.sha}><ExternalLink href={commit.url}>{commit.message.split("\n")[0]}</ExternalLink> · {commit.date}</p>)}
      <ExternalLink href={`https://github.com/${item.name}#readme`}>Documentation on GitHub</ExternalLink>
    </details>)}
    <details><summary>Assigned workers and evidence ({agents.length})</summary>{agents.map(agent=>{
      const run=observedRun(agent,repoData(repos[agent.repository]));
      return <p className="small" key={agent.id}><button className="text-btn" onClick={()=>select({kind:"agent",id:agent.id})}>{agent.name}</button> · {run ? `${run.conclusion ?? run.status} · ${run.createdAt} · GitHub Actions` : "No GitHub execution in the saved sample; inspect Output for other sources"}</p>;
    })}</details>
    <p className="small muted">Traffic, revenue, costs, and deployment health are not verified by CI. Inspect existing website dashboards or connected source reports for these metrics. Architecture decisions are available only where documented in the linked resources.</p>
  </section>;
}
