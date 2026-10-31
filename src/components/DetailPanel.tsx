import {COMMUNITY_BUILDINGS} from '../views/map3d/hillsCommunityPlan';
import {financialBrand,financialInteriorKey} from "../views/map3d/financialBrands";
import {FINANCIAL_BUILDINGS} from "../views/map3d/financialPlan";
import {AIRPORT_BUILDINGS,airportBuilding} from "../views/map3d/airportBuildings";
import { AgentOutput } from "./AgentOutput";
import { RepositoryNotice } from "./RepositoryNotice";
import {CodexReviewHandoff} from "./CodexReviewHandoff";
import {BUILDING_INTERIORS,skylineBuildingName} from "../catalog/buildings";
import { orderToolsForWorkflow } from "../views/toolWorkflowLayout";
import { ToolWorkflow } from "./ToolWorkflow";
import { servicesOf, SERVICE_PURPOSE } from "../catalog/roles";
import { projectRepositories } from "../catalog/projects";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { CopyValue, ExternalLink, HealthBadge, Indicator, LANG_COLORS, StatusPill } from "./bits";
import { activityFeed, attentionItems, effectiveLastRun, latestPerWorkflow, observedRun, overallHealth, repoData, repoHealth, type Health } from "../lib/derive";
import { frameworkColor } from "../views/mapLayout";
import { formatDate, relative } from "../lib/time";
import { useAtlas } from "../state";
import type { Agent, Project } from "../catalog/types";
import { IntelPanel } from "./IntelPanel";
import { RerunButton } from "./RerunButton";
import { PullRequests } from "./PullRequests";
import { useReducedMotion } from "../lib/motion";
import { webglAvailable } from "../views/map3d/webgl";
import { enterBuilding } from "../views/office/store";
import { AgentOrganizationRows, GroupedAgents, ProjectOrganization } from "./Organization";

/** Details for the current selection: an overlay on list views, or docked beside the map. */
export function DetailPanel({ docked = false }: { docked?: boolean }) {
  const { selection, select } = useAtlas();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  if (!selection) return null;
  const body = selection.kind === "agent" ? <AgentDetail key={selection.id} id={selection.id} /> : selection.kind === "service" ? <ServiceDetail key={selection.id} id={selection.id} /> : selection.kind === "project" ? <ProjectDetail key={selection.id} id={selection.id} /> : <RepoDetail key={selection.id} name={selection.id} />;
  if (docked)
    return (
      <aside className="panel docked" aria-label="Inspector">
        {body}
      </aside>
    );
  return (
    <>
      <div className="scrim" onClick={() => select(null)} />
      <aside className="panel" role="dialog" aria-label="Details">
        {body}
      </aside>
    </>
  );
}

function Head({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  const { select } = useAtlas();
  return (
    <div className="panel-head">
      <div className="grow">
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {children}
      </div>
      <button className="icon-btn" onClick={() => select(null)} aria-label="Close details" style={{ color: "var(--ink-2)" }}>
        <Icon name="close" />
      </button>
    </div>
  );
}

function EnterBuildingButton({id}:{id:string}) {
  const {view}=useAtlas();
  const reduced=useReducedMotion();
  return view==="map"&&webglAvailable()?<button className="ghost-btn enter-building" onClick={()=>enterBuilding(id,reduced||id.startsWith("skyline-business:"))}><Icon name="agents" size={15}/> Enter building</button>:null;
}

function LinkedRepositories({project}:{project:Project}) {
  const {catalog,repos,select}=useAtlas();
  return <section aria-label="Linked repositories">
    <div className="section-title">Linked repositories</div>
    <ul className="runs">{projectRepositories(project,catalog.agents).map(name=>{
      const snapshot=repoData(repos[name]);
      return <li key={name} style={{flexWrap:"wrap",gap:8}}>
        <span className="grow" style={{minWidth:0,overflowWrap:"anywhere"}}><ExternalLink href={`https://github.com/${name}`}><Icon name="repos" size={14}/> {name}</ExternalLink><span className="muted small" style={{display:"block"}}>{name===project.repository?"Default repository":"Linked resource"}</span></span>
        <HealthBadge health={snapshot?overallHealth(repoHealth(snapshot,catalog.agents.filter(a=>a.projectId===project.id&&a.repository===name).length)):"unknown"}/>
        <button className="text-btn" aria-label={`Inspect repository ${name}`} onClick={()=>select({kind:"repo",id:name})}>Inspect →</button>
      </li>;
    })}</ul>
  </section>;
}

function SkylineBusinessDetail({name}:{name:string}) {
  const {catalog,select}=useAtlas();
  const project=catalog.projects.find(p=>p.id==="skyline");
  const building=BUILDING_INTERIORS[name];
  const assigned=catalog.agents.filter(a=>a.workplace?.building===name);
  if(!project||!building)return <Head eyebrow="District building" title="Not found"/>;
  return <>
    <Head eyebrow="Skyline district · Business building" title={name}>
      <div className="chips" style={{marginTop:10}}><span className="chip">{building.subtitle}</span><span className="chip">Part of {project.name}</span></div>
      <EnterBuildingButton id={`skyline-business:${name}`}/>
    </Head>
    <div className="panel-body selectable">
      <p style={{margin:0,fontSize:14}}>A prepared {name} building in Skyline, with a lobby, hallways, elevators, and four floors for {building.subtitle.toLowerCase()}.</p>
      <LinkedRepositories project={project}/>
      <section><div className="section-title">Project</div><button className="text-btn" onClick={()=>select({kind:"project",id:project.id})}>{project.name} →</button><p className="muted small">This building shares Skyline’s project repository.</p></section>
      <section><div className="section-title">Prepared workspaces</div><ul>{building.rooms.map(room=><li key={room}>{room}</li>)}</ul></section>
      <section><div className="section-title">Agents & automations</div>{assigned.length?<ul className="link-list">{assigned.map(a=><li key={a.id}><button className="text-btn" onClick={()=>select({kind:"agent",id:a.id})}>{a.name} →</button><span className="muted small">Floor {a.workplace!.floor} · Suite {a.workplace!.room} · {catalog.projects.find(p=>p.id===a.projectId)?.name}</span></li>)}</ul>:<p className="muted">No workers assigned to this building yet.</p>}</section>
    </div>
  </>;
}

function AirportBuildingDetail({id}:{id:string}) {
 const b=airportBuilding(id);
 if(!b)return <Head eyebrow="Airport building" title="Not found"/>;
 return <><Head eyebrow="Atlas Airport · Prepared workspace" title={b.name}><span className="chip">Planned · No live operations</span><EnterBuildingButton id={`skyline-business:${b.name}`}/></Head><div className="panel-body selectable"><p>{b.rooms.join(" · ")}</p><dl className="kv"><dt>Owning agent role</dt><dd>{b.agent} · Prepared, not running</dd><dt>Model usage</dt><dd>None. No scheduled tasks or model calls.</dd><dt>Repository / workflow</dt><dd>Not connected</dd></dl><div className="section-title">Workspace</div><p>Enter the building to explore its lobby, floor navigation and furnished desks. People and furnishings are visualization only.</p></div></>;
}
function AirportCampusDirectory(){const {select}=useAtlas();return <section><div className="section-title">Airport buildings</div><ul className="link-list">{AIRPORT_BUILDINGS.map(b=><li key={b.id}><button className="text-btn" onClick={()=>select({kind:"service",id:`airport-building:${b.id}`})}>{b.name} →</button><span className="muted small">{b.agent} · Planned</span></li>)}</ul></section>}
function FinancialDirectory(){const {select}=useAtlas();return <section><div className="section-title">District buildings</div><ul className="link-list">{FINANCIAL_BUILDINGS.map(b=><li key={b.id}><button className="text-btn" onClick={()=>select({kind:"service",id:`financial:${b.id}`})}>{b.name} →</button><span className="muted small">Planned · {b.role}</span></li>)}</ul><button className="text-btn" onClick={()=>select({kind:"service",id:"financial-park"})}>Financial Park →</button><button className="text-btn" onClick={()=>select({kind:"service",id:"financial-station"})}>Financial District Station →</button></section>}
function ServiceDetail({id}:{id:string}) {
 const {select}=useAtlas();
 if(id==="financial-park")return <><Head eyebrow="Financial District · Public space" title="Financial Park"><span className="chip">Planned · Static public park</span></Head><div className="panel-body selectable"><p>A landscaped center between the original skyline and its airport-side expansion, with a lawn, connected paths, shade trees, seating and a protected reflecting pool.</p><dl className="kv"><dt>Access</dt><dd>Connected to the tower sidewalk, marked crossings and waterfront promenade</dd><dt>Activity</dt><dd>Visual public space · No agents or services activated</dd></dl></div></>;

 if(id==="financial-district"||id.startsWith("financial:")){
 const b=FINANCIAL_BUILDINGS.find(b=>b.id===id.slice(10));const brand=b&&financialBrand(b.id);
 return <><Head eyebrow="Financial District · Planned waterfront" title={b?.name??"Financial District"}><span className="chip">{brand&&!brand.ownedBrand?"Planned · Unofficial visual representation · Not connected":"Planned · Visual representation · Not connected"}</span>{b&&<EnterBuildingButton id={`skyline-business:${financialInteriorKey(b.id)}`}/>}</Head><div className="panel-body selectable"><p>{b?.purpose??"Nine waterfront high-rises for read-only financial organization and residences, arranged around Financial Park and connected by a local street and waterfront promenade."}</p><dl className="kv"><dt>Prepared role</dt><dd>{b?`${b.role} · Not active`:"No agents activated"}</dd><dt>Repositories / workflows</dt><dd>None linked</dd><dt>Financial data</dt><dd>No accounts connected or statements imported</dd><dt>Activity</dt><dd>Visual visitors · Not live agent activity · No model calls</dd></dl><section><div className="section-title">Privacy and scope</div><p>Planned local CSV or statement imports, or approved read-only aggregated data. No bank logins, card numbers or access tokens are stored. No trading, payments or messaging.</p></section>{brand?.website&&<section><div className="section-title">Brand references</div><ul className="link-list"><li><a href={brand.website} target="_blank" rel="noreferrer">Benjaire website ↗</a></li>{brand.designSource&&<li><a href={brand.designSource} target="_blank" rel="noreferrer">Website repository design source ↗</a></li>}</ul><p>Design references only. This planned workspace has no financial data connection.</p></section>}{!b&&<FinancialDirectory/>}{b&&<p>The furnished lobby and four-floor interior are schematic, not a floor-by-floor model of the high-rise.</p>}</div></>;
 }
 if(id.startsWith("hills:")||id==="financial-station"){
 const b=COMMUNITY_BUILDINGS.find(b=>b.id===id.slice(6)),station=id==="financial-station"||b?.kind==="station";
 return <><Head eyebrow={id==="financial-station"?"Financial District · Planned station":"Atlas Hills · Planned community"} title={id==="financial-station"?"Financial District Station":b?.name??"Atlas Hills"}><span className="chip">Planned · Visual simulation · Not connected</span></Head><div className="panel-body selectable"><p>{b?.purpose??"Planned Financial District passenger station with connected promenade access."}</p><button className="text-btn" onClick={()=>select({kind:"service",id:"atlas-hills"})}>Back to Atlas Hills</button>{station&&<><section><div className="section-title">Passenger connection</div><button className="text-btn" onClick={()=>select({kind:"service",id:id==="financial-station"?"hills:station":"financial-station"})}>{id==="financial-station"?"Atlas Hills Station":"Financial District Station"} →</button><p>Atlas Hills ⇄ Financial District. One elevated two-way train; six unnamed residents illustrate walking, boarding and onward travel. Figures do not represent live agent execution.</p><p>Use existing district sidewalks for onward travel. No additional rail stops or external transit services are connected.</p></section><section><div className="section-title">Simulation controls</div><p>Train and commuter movement follows Traffic, reduced motion and visibility settings. Battery saver keeps this service static. Platforms include stair and schematic lift access.</p></section></>}<dl className="kv"><dt>Assigned agents</dt><dd>None activated</dd><dt>Repositories / services</dt><dd>None connected</dd></dl><p>New amenities are exterior previews; their interiors are not yet implemented. The original mansion remains enterable.</p></div></>;
 }
 if(id==="atlas-hills")return <><Head eyebrow="Residential district · Planned community" title="Atlas Hills"><span className="chip">Planned · Visual district</span><EnterBuildingButton id="skyline-business:Atlas Hills"/></Head><div className="panel-body selectable"><p>A residential community around the preserved two-story mansion: gated homes, village shops and café, community and social clubs, fitness studio, wellness spa, a compact three-hole course and an elevated Financial District train connection.</p><dl className="kv"><dt>Prepared role</dt><dd>Estate Planning Coordinator · Not active</dd><dt>Repository / workflows</dt><dd>None linked</dd><dt>Agent activity</dt><dd>No running agents or model calls</dd></dl><section><div className="section-title">Inside the mansion</div><p>Explore the entrance lobby, living spaces and upstairs study with a furnished desk. Floor navigation and lighting follow the existing Atlas interior system.</p></section><section><div className="section-title">Grounds</div><ul><li>Three-car garage and separate driveway</li><li>Pool terrace, loungers and shaded seating</li><li>Tennis court and landscaped courtyard</li><li>Connected pedestrian entrance and city access</li></ul></section><section><div className="section-title">Community places</div><ul className="link-list">{COMMUNITY_BUILDINGS.map(b=><li key={b.id}><button className="text-btn" onClick={()=>select({kind:"service",id:`hills:${b.id}`})}>{b.name} →</button></li>)}</ul><p>Planned visual community. Commuters are unnamed simulated residents, not active agents. Rail pauses in Battery saver, with Traffic off, or for reduced motion.</p></section></div></>;

 if(id.startsWith("airport-building:"))return <AirportBuildingDetail id={id.slice(17)}/>;
  if(id === "bmw-dealership") return <>
    <Head eyebrow="Automotive district · Visual infrastructure" title="BMW"><span className="chip">Planned</span></Head>
    <div className="panel-body selectable"><p>A four-story BMW-inspired glass showroom with a ground-floor reception lounge, three upper display galleries, connected stair flights, front display bays, and separate customer and service access.</p><div className="section-title">Current scope</div><p>Visual visitors enter and leave the showroom through opening glass doors. This is not live agent or customer activity. A service car departs every 60 seconds and arrives every 90 seconds while traffic is enabled. Display vehicles are not live inventory. Sales, servicing, agents, and business integrations are not connected. The furnished showroom can be viewed through its windows; an interactive interior is not available in this first pass.</p><dl className="kv"><dt>Repositories</dt><dd>None linked</dd><dt>Assigned workers</dt><dd>None assigned</dd><dt>Workflows</dt><dd>Not connected</dd><dt>Access</dt><dd>Connected district street, raised sidewalk, and marked pedestrian crossing</dd></dl></div>
  </>;
  if(id === "skyline-stadium") return <>
    <Head eyebrow="Recreation district · Beside GitHub Profile" title="Stadium"><span className="chip">Planned</span></Head>
    <div className="panel-body selectable"><p>A MetLife-inspired sports and events venue with a tiered seating bowl, field, entrance concourse, and connected city access.</p><div className="section-title">Current scope</div><p>Visual infrastructure only. Events, ticketing, and venue operations are planned; this building does not indicate live business activity.</p><dl className="kv"><dt>Repositories</dt><dd>None linked</dd><dt>Assigned workers</dt><dd>None assigned</dd><dt>Workflows</dt><dd>Not connected</dd></dl></div>
  </>;
  if(id === "logistics-airport") return <>
    <Head eyebrow="Business logistics · Skyline district" title="Atlas Airport"><span className="chip">Planned</span></Head>
    <div className="panel-body selectable"><p>A JFK-inspired airport campus representing future business logistics, passenger connections, inbound supplies, and outbound fulfillment.</p><div className="section-title">Current scope</div><p>Visual infrastructure only. The terminal, tower, runway and decorative aircraft do not represent live flights, deliveries or agent execution. Three decorative aircraft wait on the taxiway, with departures spaced 15 simulation seconds apart. The shared flight simulation pauses in Battery saver, when traffic is off, or while the map is hidden. Other aircraft remain parked. Prepared owning-agent roles have no live workflows or model calls. A decorative freight truck travels between the Canva parking lot and airport, with loading pauses; no real products are shipped.</p><dl className="kv"><dt>Repositories</dt><dd>None linked</dd><dt>Assigned workers</dt><dd>None assigned</dd><dt>Workflows</dt><dd>Not connected</dd><dt>Next step</dt><dd>Assign a real logistics project and verified workflow before showing operational status.</dd></dl><AirportCampusDirectory/></div>
  </>;

  const building=skylineBuildingName(id);
  return building?<SkylineBusinessDetail name={building}/>:<ToolDetail id={id}/>;
}

function ToolDetail({ id }: { id: string }) {
  const { catalog, select } = useAtlas();
  const split = id.indexOf(":");
  const project = catalog.projects.find(p => p.id === id.slice(0, split));
  const service = project && servicesOf(catalog.agents.filter(a => a.projectId === project.id)).find(s => s.id === id.slice(split + 1));
  if (!project || !service) return <Head eyebrow="Infrastructure tool" title="Not found" />;
  const route = orderToolsForWorkflow(servicesOf(catalog.agents.filter(a => a.projectId === project.id)));
  return <>
    <Head eyebrow={`Infrastructure tool · ${project.name}`} title={service.name}>
      <div className="chips" style={{ marginTop: 10 }}><span className="chip">Supporting infrastructure</span><span className="chip">{service.users.length} linked {service.users.length === 1 ? "worker" : "workers"}</span></div>
      <EnterBuildingButton id={`skyline-business:${service.name}`}/>
    </Head>
    <div className="panel-body selectable">
      <section><div className="section-title">Purpose</div><p style={{ margin: 0, fontSize: 14 }}>{SERVICE_PURPOSE[service.id]}</p></section>
      <section><div className="section-title">Supports this project</div><button className="ghost-btn" onClick={() => select({ kind: "project", id: project.id })}><Icon name="map" size={15} />{project.name}</button></section>
      {route.length > 1 && <section><div className="section-title">Tool workflow · left to right around headquarters</div><div className="link-list">{route.map((tool, index) => <button key={tool.id} className="text-btn" aria-current={tool.id === service.id ? "step" : undefined} onClick={() => select({ kind: "service", id: `${project.id}:${tool.id}` })}>{index + 1}. {tool.name}{tool.id === service.id ? " · selected" : " →"}</button>)}</div><p className="muted small">Placement follows declared dependencies and documented workflow phases.</p></section>}
      <ToolWorkflow service={service} projectAgents={catalog.agents.filter(a => a.projectId === project.id)} />
      <LinkedRepositories project={project}/>
    </div>
  </>;
}

/** A project owns its building and agents; repositories are linked resources. */
function ProjectDetail({ id }: { id: string }) {
  const { catalog } = useAtlas();
  const project = catalog.projects.find(p => p.id === id);
  if (!project) return <Head eyebrow="Project" title="Not found" />;
  const repositories = projectRepositories(project, catalog.agents);
  return <>
    <Head eyebrow="Project building" title={project.name}>
      <div className="chips" style={{ marginTop: 10 }}><StatusPill status={project.status} /><span className="chip">{repositories.length} {repositories.length === 1 ? "repository" : "repositories"}</span></div>
      <EnterBuildingButton id={project.id}/>
    </Head>
    <div className="panel-body selectable">
      <p style={{ margin: 0, fontSize: 14 }}>{project.summary}</p>
      <LinkedRepositories project={project}/>
      <ProjectOrganization project={project} agents={catalog.agents.filter(a => a.projectId === project.id)} />
      {project.links.length > 0 && <section><div className="section-title">Project links</div><div className="link-list">{project.links.map(link => <ExternalLink key={link.url} href={link.url}><Icon name="external" size={14} /> {link.label}</ExternalLink>)}</div></section>}
    </div>
  </>;
}

function githubFileUrl(agent: Agent, branch = "HEAD") {
  return agent.source ? `https://github.com/${agent.repository}/blob/${branch}/${agent.source}` : undefined;
}

function AgentDetail({ id }: { id: string }) {
  const [tab, setTab] = useState<"overview" | "output">("overview");
  const { catalog, repos, select } = useAtlas();
  const agent = catalog.agents.find((a) => a.id === id);
  const history = useMemo(() => activityFeed(catalog, repos, { agent: id }), [catalog, repos, id]);
  if (!agent) return <Head eyebrow="Agent" title="Not found" />;
  const project = catalog.projects.find((p) => p.id === agent.projectId);
  const snap = repoData(repos[agent.repository]);
  const last = effectiveLastRun(agent, snap);
  const run = observedRun(agent, snap);
  const source = githubFileUrl(agent, snap?.defaultBranch);

  return (
    <>
      <Head eyebrow={`Agent · ${project?.name ?? agent.projectId}`} title={agent.name}>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatusPill status={agent.status} />
          <span className="chip">{agent.framework}</span>
        </div>
      </Head>
      <div className="panel-tabs" role="tablist" aria-label="Agent sections">
        {(["overview", "output"] as const).map((name) => <button key={name} id={`agent-${id}-${name}-tab`} role="tab" aria-selected={tab === name} aria-controls={`agent-${id}-panel`} tabIndex={tab === name ? 0 : -1} className={tab === name ? "on" : ""} onClick={() => setTab(name)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "overview" : event.key === "End" ? "output" : name === "overview" ? "output" : "overview";
          setTab(next);
          document.getElementById(`agent-${id}-${next}-tab`)?.focus();
        }}>{name === "overview" ? "Overview" : "Output"}</button>)}
      </div>
      <div className="panel-body selectable" id={`agent-${id}-panel`} role="tabpanel" aria-labelledby={`agent-${id}-${tab}-tab`}>
        {tab === "output" ? <AgentOutput agent={agent}/> : <>
        <p style={{ margin: 0, fontSize: 14 }}>{agent.purpose}</p>
        <CodexReviewHandoff agent={agent}/>
        <dl className="kv">
          <dt>Project</dt>
          <dd>{project?.name}</dd>
          <AgentOrganizationRows id={agent.id} />
          <dt>Repository</dt>
          <dd>
            <button className="text-btn" style={{ padding: 0 }} onClick={() => select({ kind: "repo", id: agent.repository })}>
              {agent.repository}
            </button>
          </dd>
          {agent.model && (
            <>
              <dt>Model</dt>
              <dd>{agent.model}</dd>
            </>
          )}
          {agent.runtime && (
            <>
              <dt>Runtime</dt>
              <dd>{agent.runtime}</dd>
            </>
          )}
          {agent.trigger && (
            <>
              <dt>Trigger</dt>
              <dd>{agent.trigger}</dd>
            </>
          )}
          {agent.source && (
            <>
              <dt>Source</dt>
              <dd className="mono">
                <CopyValue value={agent.source} title="Copy source path" />
              </dd>
            </>
          )}
          <dt>Last run</dt>
          <dd>
            {last ? `${formatDate(last)} (${relative(last)})` : <span className="muted">Not recorded in the manifest</span>}
            {run && <div className="muted small">From GitHub Actions: {run.conclusion ?? run.status}</div>}
          </dd>
        </dl>
        <div>
          <div className="section-title">Links</div>
          <div className="links">
            {source && (
              <ExternalLink href={source}>
                <Icon name="external" size={14} /> Source on GitHub
              </ExternalLink>
            )}
            <ExternalLink href={`https://github.com/${agent.repository}`}>
              <Icon name="external" size={14} /> Repository
            </ExternalLink>
            {agent.links.map((l) => (
              <ExternalLink key={l.url} href={l.url}>
                <Icon name="external" size={14} /> {l.label}
              </ExternalLink>
            ))}
          </div>
        </div>
        <div>
          <div className="section-title">Activity history</div>
          {history.length === 0 ? (
            <div className="muted small">No history recorded yet. Live run history arrives with the n8n and local adapters in the next phase.</div>
          ) : (
            <ul className="timeline">
              {history.map((h) => (
                <li key={h.id} className={`k-${h.kind}`}>
                  <div className="small">{h.url ? <ExternalLink href={h.url}>{h.title}</ExternalLink> : h.title}</div>
                  <div className="muted small">
                    {formatDate(h.at)} · {h.subtitle}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        </>}
      </div>
    </>
  );
}

const CONCLUSION_HEALTH: Record<string, Health> = { success: "good", failure: "bad", timed_out: "bad", cancelled: "warn", action_required: "warn" };

type RepoTab = "overview" | "pulls" | "agents" | "activity" | "insights";
const REPO_TABS: { id: RepoTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "pulls", label: "PRs" },
  { id: "agents", label: "Agents" },
  { id: "activity", label: "Activity" },
  { id: "insights", label: "Insights" },
];

function RepoDetail({ name }: { name: string }) {
  const { catalog, repos, refreshing, select, setView, setFilters, clearFilters } = useAtlas();
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<RepoTab>("overview");
  const state = repos[name];
  const snap = repoData(state);
  const project = catalog.projects.find((p) => projectRepositories(p, catalog.agents).includes(name));
  const agents = catalog.agents.filter((a) => a.repository === name);
  const history = useMemo(() => activityFeed(catalog, repos, { repo: name }), [catalog, repos, name]);
  const indicators = repoHealth(snap, agents.length);
  const workflows = snap ? latestPerWorkflow(snap.runs) : [];
  const languages = snap ? Object.entries(snap.languages).sort((a, b) => b[1] - a[1]) : [];
  const total = languages.reduce((s, [, v]) => s + v, 0);
  const frameworks = [...new Set(agents.map((a) => a.framework))];
  const models = [...new Set(agents.flatMap((a) => (a.model ? [a.model] : [])))];

  return (
    <>
      <Head eyebrow={project ? "Repository · Project resource" : "Repository · Not in the catalog yet"} title={name.split("/")[1]}>
        <div className="mono muted" style={{ marginTop: 4 }}>
          <CopyValue value={name} title="Copy repository name" />
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          {project && <StatusPill status={project.status} />}
          <HealthBadge health={snap ? overallHealth(indicators) : "unknown"} />
          {snap && <span className="chip">{snap.visibility}</span>}
          {snap?.archived && <span className="chip">Archived</span>}
        </div>
        {project && <button className="ghost-btn" style={{ marginTop: 12 }} onClick={() => select({ kind: "project", id: project.id })}><Icon name="map" size={15} /> Back to {project.name}</button>}
      </Head>
      <div className="panel-tabs" role="tablist" aria-label="Inspector sections">
        {REPO_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "agents" && agents.length > 0 && <span className="count">{agents.length}</span>}
          </button>
        ))}
      </div>
      <div className="panel-body selectable" role="tabpanel">
        {tab === "overview" && (
          <>
          {state?.kind === "error" && (
            <RepositoryNotice message={state.message}/>
          )}
          {!snap && state?.kind !== "error" && (refreshing ? <p className="muted small">Checking GitHub…</p> : <RepositoryNotice message="No repository snapshot"/>)}
          {(snap?.description ?? project?.summary) && <p style={{ margin: 0, fontSize: 14 }}>{snap?.description ?? project?.summary}</p>}

          {project && <ProjectOrganization project={project} agents={agents} latest={history[0]} />}

          <section>
            <div className="section-head">
              <div className="section-title">Verified health</div>
              <span className="source">{snap ? `GitHub · synced ${relative(snap.fetchedAt)}` : "Not synced yet"}</span>
            </div>
            <div className="health-grid">
              {indicators.map((i) => (
                <Indicator key={i.key} ind={i} />
              ))}
            </div>
            {workflows.length > 0 && (
              <ul className="runs">
                {workflows.map((r) => (
                  <li key={r.name}>
                    <i className={`h-${r.status !== "completed" ? "unknown" : (CONCLUSION_HEALTH[r.conclusion ?? ""] ?? "unknown")}`} />
                    <span className="grow">
                      <ExternalLink href={r.url}>{r.name}</ExternalLink>
                      <span className="muted"> · {r.status !== "completed" ? r.status.replace("_", " ") : r.conclusion}</span>
                    </span>
                    <span className="muted small" title={new Date(r.createdAt).toLocaleString()}>
                      {relative(r.createdAt)}
                    </span>
                    <RerunButton repo={name} run={r} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="section-title">Tech stack</div>
            {total > 0 ? (
              <>
                <div className="lang-bar" role="img" aria-label={languages.map(([l, v]) => `${l} ${Math.round((v / total) * 100)}%`).join(", ")}>
                  {languages.map(([l, v]) => (
                    <i key={l} style={{ flexGrow: v, background: LANG_COLORS[l] ?? "var(--sage-400)" }} />
                  ))}
                </div>
                <div className="lang-legend">
                  {languages.slice(0, 5).map(([l, v]) => (
                    <span key={l} className="health">
                      <i className="lang-dot" style={{ background: LANG_COLORS[l] ?? "var(--sage-400)" }} />
                      {l} <span className="muted">{Math.round((v / total) * 100)}%</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="muted small">{snap ? "GitHub reports no languages for this repository." : "Languages appear after the first sync."}</div>
            )}
            {(frameworks.length > 0 || models.length > 0 || (project?.tags.length ?? 0) > 0) && (
              <div className="chips" style={{ marginTop: 10 }}>
                {frameworks.map((f) => (
                  <span key={f} className="chip">
                    <i className="swatch" style={{ background: frameworkColor(f) }} />
                    {f}
                  </span>
                ))}
                {models.map((m) => (
                  <span key={m} className="chip">
                    {m}
                  </span>
                ))}
                {project?.tags.map((t) => (
                  <span key={t} className="chip muted-chip">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </section>

          <dl className="kv">
            <dt>Default branch</dt>
            <dd className="mono">{snap?.defaultBranch ?? "–"}</dd>
            <dt>Last push</dt>
            <dd>{snap?.pushedAt ? `${formatDate(snap.pushedAt)} (${relative(snap.pushedAt)})` : "–"}</dd>
            <dt>Stars</dt>
            <dd>{snap ? snap.stars : "–"}</dd>
            <dt>License</dt>
            <dd>{snap ? (snap.license ?? "None") : "–"}</dd>
          </dl>
          <div>
            <div className="section-title">Links</div>
            <div className="links">
              <ExternalLink href={`https://github.com/${name}`}>
                <Icon name="external" size={14} /> Open on GitHub
              </ExternalLink>
              {snap?.homepage && (
                <ExternalLink href={snap.homepage}>
                  <Icon name="external" size={14} /> {snap.homepage.replace(/^https?:\/\//, "")}
                </ExternalLink>
              )}
              {project?.links.map((l) => (
                <ExternalLink key={l.url} href={l.url}>
                  <Icon name="external" size={14} /> {l.label}
                </ExternalLink>
              ))}
              {project && agents.length > 0 && (
                <button
                  className="text-btn link-row"
                  onClick={() => {
                    clearFilters();
                    setFilters({ project: project.id });
                    setView("agents");
                  }}
                >
                  <Icon name="agents" size={14} /> List these agents
                </button>
              )}
              <button className="text-btn link-row" onClick={() => setView("repos")}>
                <Icon name="repos" size={14} /> All repositories
              </button>
            </div>
          </div>
          </>
        )}
        {tab === "agents" && (
          <>
            {agents.length === 0 ? (
              <section>
                <div className="section-title">Agents (0)</div>
                <div className="muted small">{project ? "No agents are registered for this project." : "Add a manifest in catalog/ to register this repository's agents."}</div>
              </section>
            ) : (
              <GroupedAgents agents={agents} onPick={(id) => select({ kind: "agent", id })} />
            )}
          </>
        )}
        {tab === "activity" && (
          <>
          <div>
            <div className="section-title">Recent activity</div>
            {history.length === 0 ? (
              <div className="muted small">{snap ? "No commits or workflow runs in the synced window." : "Activity appears after the first sync."}</div>
            ) : (
              <>
                <ul className="timeline">
                  {history.slice(0, more ? 20 : 6).map((h) => (
                    <li key={h.id} className={`k-${h.kind}`}>
                      <div className="small">{h.url ? <ExternalLink href={h.url}>{h.title}</ExternalLink> : h.title}</div>
                      <div className="muted small" title={new Date(h.at).toLocaleString()}>
                        {relative(h.at)} · {h.subtitle}
                      </div>
                    </li>
                  ))}
                </ul>
                {history.length > 6 && (
                  <button className="text-btn small" onClick={() => setMore((m) => !m)}>
                    {more ? "Show less" : `Show ${Math.min(20, history.length) - 6} more`}
                  </button>
                )}
              </>
            )}
          </div>
          </>
        )}
        {tab === "pulls" && <PullRequests repo={name} />}
        {tab === "insights" && <RepoInsights name={name} />}
      </div>
      <div className="panel-foot">
        <ExternalLink href={`https://github.com/${name}`} className="btn primary">
          <Icon name="external" size={14} /> Open repository
        </ExternalLink>
        {project && agents.length > 0 ? (
          <button className="btn" onClick={() => {
    if (!project) return;
    clearFilters();
    setFilters({ project: project.id });
    setView("agents");
  }}>
            <Icon name="agents" size={14} /> View agents
          </button>
        ) : (
          <button className="btn" onClick={() => setView("repos")}>
            <Icon name="repos" size={14} /> All repositories
          </button>
        )}
      </div>
    </>
  );
}

/** Facts computed from what Atlas has synced for one repository; nothing here is estimated. */
function RepoInsights({ name }: { name: string }) {
  const { catalog, repos, uncataloged, select } = useAtlas();
  const snap = repoData(repos[name]);
  const agents = catalog.agents.filter((a) => a.repository === name);
  const flags = useMemo(
    () => attentionItems(catalog, repos, [], Date.now(), uncataloged).filter((i) => i.target && (i.target.id === name || agents.some((a) => a.id === i.target!.id))),
    [catalog, repos, uncataloged, name, agents],
  );
  if (!snap)
    return (
      <>
        <div className="muted small">Insights appear after the first sync with GitHub.</div>
        <IntelPanel repo={name} />
      </>
    );
  const done = snap.runs.filter((r) => r.status === "completed");
  const ok = done.filter((r) => r.conclusion === "success").length;
  const since = Date.now() - 14 * 86_400_000;
  const recentCommits = snap.commits.filter((c) => Date.parse(c.date) >= since).length;
  const authors = new Set(snap.commits.map((c) => c.author)).size;
  const tiles = [
    { label: "CI success", value: done.length ? `${Math.round((ok / done.length) * 100)}%` : "–", note: done.length ? `${ok} of ${done.length} synced runs` : "No completed runs" },
    { label: "Commits, 14 days", value: String(recentCommits), note: `of the latest ${snap.commits.length} synced` },
    { label: "Last push", value: snap.pushedAt ? relative(snap.pushedAt) : "–", note: snap.pushedAt ? formatDate(snap.pushedAt) : "Not reported" },
    { label: "Contributors", value: String(authors), note: "in the synced commits" },
    { label: "Open issues + PRs", value: String(snap.openIssues), note: "Reported by GitHub" },
    { label: "Agents", value: String(agents.length), note: `${agents.filter((a) => a.status === "active").length} active` },
  ];
  return (
    <>
      <section>
        <div className="section-head">
          <div className="section-title">At a glance</div>
          <span className="source">GitHub · synced {relative(snap.fetchedAt)}</span>
        </div>
        <div className="insight-grid">
          {tiles.map((t) => (
            <div key={t.label} className="insight">
              <div className="label">{t.label}</div>
              <div className="value">{t.value}</div>
              <div className="note">{t.note}</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="section-title">Worth a look</div>
        {flags.length === 0 ? (
          <div className="muted small">Nothing flagged for this repository or its agents.</div>
        ) : (
          <ul className="list" style={{ padding: 0 }}>
            {flags.map((f) => (
              <li key={f.id}>
                <button className="list-row" onClick={() => f.target && select(f.target)}>
                  <i className={`sev ${f.severity}`} />
                  <span className="grow">
                    <div className="title">{f.title}</div>
                    <div className="meta">{f.detail}</div>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <IntelPanel repo={name} />
    </>
  );
}
