import {projectOfficeAgents} from "../../catalog/workplaces";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActions } from "../../actions/state";
import { Icon } from "../../components/Icon";
import { ExternalLink, StatusPill } from "../../components/bits";
import { useIntel } from "../../intel/state";
import { repoData, verifiedState } from "../../lib/derive";
import { useReducedMotion } from "../../lib/motion";
import { formatDate, relative } from "../../lib/time";
import { buildRegistry, type RegistryEntry } from "../../registry/registry";
import type { ExecutionRecord } from "../../registry/types";
import { useAtlas } from "../../state";
import { CATEGORY_LABEL } from "../../registry/types";
import type { LightMode } from "../map3d/living";
import { AutonomyMeter, ListField, NA, OperationalPill } from "../agents/parts";
import { ApprovalQueue } from "../../components/ApprovalQueue";
import { useProposals } from "../../approvals/state";
import type { Proposal } from "../../approvals/proposals";
import { ACTION_AGENTS, accentFor, actionExecutions, planOffice, RUNTIME_LABEL, runtimeFor, toolIcon, type Runtime } from "./model";
import OfficeScene, { type DeskData, type OfficeApi } from "./OfficeScene";
import { leaveBuilding, useOffice } from "./store";
import { STATE_COLOR } from "./textures";
import "../../styles/office.css";

interface Row {
  entry: RegistryEntry;
  runtime: Runtime;
  history: ExecutionRecord[];
}

/** The office for the building that was entered, over the map, with its controls and inspector. */
export default function OfficeLayer({ light }: { light: LightMode }) {
  const { projectId, phase } = useOffice();
  const { catalog, repos, setView } = useAtlas();
  const { telemetry: intel } = useIntel();
  const actions = useActions();
  const pending = useProposals();
  const reduced = useReducedMotion();
  const [floor,setFloor]=useState(-1);
  const [picked, setPicked] = useState<string | null>(null);
  const api = useRef<OfficeApi | null>(null);
  const project = catalog.projects.find((p) => p.id === projectId);
  // Every registered worker belongs at a desk inside its project building.
  const agents = useMemo(() => projectOfficeAgents(catalog.agents,projectId??""), [catalog, projectId]);
  const plan = useMemo(() => (project ? planOffice(project, agents) : null), [project, agents]);

  const rows = useMemo(() => {
    const entries = buildRegistry({ projects: catalog.projects, agents }, repos, intel);
    const data = { available: actions.available, status: actions.status, audit: actions.audit };
    return new Map<string, Row>(
      entries.map((entry) => {
        const a = agents.find((x) => x.id === entry.profile.id)!;
        const action = ACTION_AGENTS[a.id];
        return [a.id, { entry, runtime: runtimeFor(a, entry.telemetry, data, pending.filter((p) => p.agentId === a.id).length), history: action ? actionExecutions(action, actions.audit) : entry.telemetry.executions }];
      }),
    );
  }, [catalog.projects, agents, repos, intel, actions.available, actions.status, actions.audit, pending]);

  const desks = useMemo<DeskData[]>(
    () =>
      (plan?.workstations ?? []).map((ws) => {
        const r = rows.get(ws.agentId)!;
        const a = agents.find((x) => x.id === ws.agentId)!;
        const b = r.runtime.basis;
        return {
          ws,
          floor: a.officeFloor ?? 4,
          name: r.entry.profile.title,
          accent: accentFor(ws.slot, ws.id.split("/")[0]),
          icon: toolIcon(a),
          runtime: r.runtime,
          // While waiting on KC, the monitor shows what the agent proposes, not its last run.
          task: firstFor(pending, ws.agentId)?.title ?? (b ? b.label : null),
          when: firstFor(pending, ws.agentId) ? `${pending.filter((p) => p.agentId === ws.agentId).length} awaiting approval` : b ? `${relative(b.at)} · ${r.runtime.source}` : r.runtime.source,
        };
      }),
    [plan, rows, agents, pending],
  );

  // Escape closes the inspector, then leaves the building. Captured first so the map's own
  // Escape handler (which clears the map selection) does not also fire.
  const exit = useCallback(() => leaveBuilding(reduced), [reduced]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (picked) setPicked(null);
      else exit();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [picked, exit]);

  if (!project || !plan) return null;
  const visibleDesks=desks.filter(d=>floor===-1||(d.floor??4)===floor);
  const topFloor=visibleDesks.length>0;
  const row = picked ? rows.get(picked) : undefined;
  const states = [...new Set(desks.map((d) => d.runtime.state))];

  return (
    <div className={`office-layer phase-${phase ?? "inside"} ${light === "night" ? "night" : ""}`} role="region" aria-label={`${project.name} office`}>
      <div className="office-stage">
        <OfficeScene
          plan={plan}
          floor={floor}
          desks={desks}
          wall={{ title: project.name, repo: project.repository, line: verifiedState(repos[project.repository]).label }}
          light={light}
          reduced={reduced}
          selected={picked}
          onSelect={setPicked}
          api={api}
        />
        <nav className="skyline-floor-picker office-floor-nav" aria-label="Building floor navigation"><strong>Floor navigation</strong>{[-1,4,3,2,1,0].map(n=><button key={n} aria-pressed={floor===n} onClick={()=>{setFloor(n);setPicked(null);}}>{n===-1?"All floors":n===0?"Lobby":n===3&&projectId==="ai-ops-atlas"?"Floor 3 · Production":n===4?"Floor 4 · Agents":`Floor ${n}`}</button>)}</nav>
        <div className="office-head">
          <button className="office-back" onClick={exit}>
            <span aria-hidden>‹</span> Exit building
          </button>
          <div>
            <div className="eyebrow">Headquarters · {project.repository}</div>
            <h2>{project.name}</h2>
            <div className="muted small">{`${floor===-1?"All floors · Lobby, hallways & elevator":floor===0?"Lobby":`Floor ${floor}`} · ${floor===4||floor===-1?"Agents by assigned floor":floor===3&&projectId==="ai-ops-atlas"?"Atlas system production":"Shared spaces"}`}</div>
          </div>
          {pending.some((p) => agents.some((a) => a.id === p.agentId)) && (
            <button className="office-awaiting" onClick={() => {setFloor(4);setPicked(pending.find((p) => agents.some((a) => a.id === p.agentId))!.agentId);}}>
              <i /> {pending.filter((p) => agents.some((a) => a.id === p.agentId)).length} awaiting approval
            </button>
          )}
        </div>

        {desks.length === 0 && (
          <div className="office-empty">
            <h3>No workers are registered here yet</h3>
            <p>This project has no registered agents or automations, so the office has no desks.</p>
          </div>
        )}

        {desks.length > 0 && topFloor && (
          <details className="office-roster" aria-label="Select an agent">
            <summary>Agents &amp; automations <span>{visibleDesks.length}</span></summary>
            <div className="office-roster-list">
            {visibleDesks.map((d) => (
              <button key={d.ws.id} className={picked === d.ws.agentId ? "on" : ""} onClick={() => setPicked(picked === d.ws.agentId ? null : d.ws.agentId)} title={`${d.name}: ${RUNTIME_LABEL[d.runtime.state]}`}>
                <i style={{ background: STATE_COLOR[d.runtime.state] }} />
                {d.name}
              </button>
            ))}
            </div>
          </details>
        )}

        <div className="office-legend" aria-label="Workstation states">
          {states.map((s) => (
            <span key={s}>
              <i style={{ background: STATE_COLOR[s] }} />
              {RUNTIME_LABEL[s]}
            </span>
          ))}
        </div>

        <div className="map-controls office-controls">
          <button className="icon-btn" onClick={() => api.current?.orbit(-0.35)} aria-label="Orbit left" title="Orbit left">
            <span aria-hidden>⟲</span>
          </button>
          <button className="icon-btn" onClick={() => api.current?.orbit(0.35)} aria-label="Orbit right" title="Orbit right">
            <span aria-hidden>⟳</span>
          </button>
          <button className="icon-btn" onClick={() => api.current?.reset()} aria-label="Reset view" title="Reset view">
            <Icon name="focus" size={17} />
          </button>
          <button className="icon-btn" onClick={() => api.current?.zoom(1.25)} aria-label="Zoom in" title="Zoom in">
            <Icon name="plus" size={17} />
          </button>
          <button className="icon-btn" onClick={() => api.current?.zoom(0.8)} aria-label="Zoom out" title="Zoom out">
            <Icon name="minus" size={17} />
          </button>
        </div>
      </div>

      {row && (
        <AgentInspectionPanel
          row={row}
          onClose={() => setPicked(null)}
          onProfile={() => {
            leaveBuilding(true);
            setView("agents");
          }}
          branch={repoData(repos[row.entry.profile.repository])?.defaultBranch ?? "HEAD"}
        />
      )}
    </div>
  );
}

const firstFor = (ps: Proposal[], agentId: string) => ps.find((p) => p.agentId === agentId);

const RESULT_LABEL: Record<ExecutionRecord["result"], string> = { success: "Succeeded", failure: "Failed", running: "In progress", other: "Other" };

/** AgentInspectionPanel: the registry profile plus what verified telemetry says right now. */
function AgentInspectionPanel({ row, onClose, onProfile, branch }: { row: Row; onClose: () => void; onProfile: () => void; branch: string }) {
  const { entry, runtime, history } = row;
  const p = entry.profile;
  const t = entry.telemetry;
  const errors = history.filter((e) => e.result === "failure").slice(0, 3);
  const file = (path: string) => `https://github.com/${p.repository}/blob/${branch}/${path}`;
  const lastVerified = history.find((e) => e.result === "success") ?? null;
  return (
    <aside className="panel docked office-panel" aria-label={`${p.title} details`}>
      <div className="panel-head">
        <div className="grow">
          <div className="eyebrow">Agent · {p.project.name}</div>
          <h2>{p.title}</h2>
          {p.originalName && <div className="muted small">Manifest name: {p.originalName}</div>}
          <div className="chips" style={{ marginTop: 10 }}>
            <span className={`chip office-state s-${runtime.state}`}>
              <i style={{ background: STATE_COLOR[runtime.state] }} />
              {RUNTIME_LABEL[runtime.state]}
            </span>
            <OperationalPill op={entry.operational} />
            <StatusPill status={entry.status} />
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close agent details">
          <Icon name="close" />
        </button>
      </div>
      <div className="panel-body selectable">
        <section>
          <div className="section-title">Current status</div>
          <p style={{ margin: 0, fontSize: 13.5 }}>{runtime.reason}</p>
          <div className="muted small">Source: {runtime.source ?? <NA kind="connected" />}</div>
        </section>
        {ACTION_AGENTS[p.id] && (
          <section>
            <div className="section-title">Awaiting your approval</div>
            <ApprovalQueue agentId={p.id} compact />
          </section>
        )}
        <section>
          <div className="section-title">Autonomy</div>
          <AutonomyMeter level={p.governance.autonomy} />
          {p.governance.approval && <div className="muted small">Approval: {p.governance.approval}</div>}
        </section>
        <section>
          <div className="section-title">Role</div>
          <p style={{ margin: 0, fontSize: 14 }}>{p.mission.purpose}</p>
          <div className="muted small">
            {CATEGORY_LABEL[p.category]}
            {p.subcategory ? ` · ${p.subcategory}` : ""}
          </div>
        </section>
        <ListField title="Responsibilities" items={p.responsibilities.tasks} />
        <dl className="kv">
          <dt>Repository</dt>
          <dd>
            <ExternalLink href={p.repositoryUrl}>{p.repository}</ExternalLink>
          </dd>
          <dt>Framework</dt>
          <dd>{p.framework}</dd>
          {p.model && (
            <>
              <dt>Model</dt>
              <dd>{p.model}</dd>
            </>
          )}
          <dt>Runtime</dt>
          <dd>{p.execution.environment ?? <NA />}</dd>
          <dt>Trigger</dt>
          <dd>{p.execution.trigger ?? <NA />}</dd>
          <dt>Last verified</dt>
          <dd>{lastVerified ? `${formatDate(lastVerified.at)} (${relative(lastVerified.at)})` : <NA kind="verified" />}</dd>
        </dl>
        <ListField title="Tools and integrations" items={p.responsibilities.tools} />
        <section>
          <div className="section-title">Recent task history</div>
          {history.length === 0 ? (
            <div className="muted small">{t.loaded || ACTION_AGENTS[p.id] ? "No executions observed yet." : runtime.reason}</div>
          ) : (
            <ul className="runs">
              {history.slice(0, 8).map((e) => (
                <li key={`${e.at}${e.label}`}>
                  <i className={`h-${e.result === "success" ? "good" : e.result === "failure" ? "bad" : "unknown"}`} />
                  <span className="grow">
                    {e.url ? <ExternalLink href={e.url}>{e.label}</ExternalLink> : e.label}
                    <span className="muted"> · {RESULT_LABEL[e.result]}</span>
                  </span>
                  <span className="muted small" title={new Date(e.at).toLocaleString()}>
                    {relative(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {errors.length > 0 && (
          <section>
            <div className="section-title">Recent failures</div>
            <ul className="runs">
              {errors.map((e) => (
                <li key={`f${e.at}`}>
                  <i className="h-bad" />
                  <span className="grow">{e.url ? <ExternalLink href={e.url}>{e.label}</ExternalLink> : e.label}</span>
                  <span className="muted small">{relative(e.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <div className="section-title">Sources</div>
          <div className="links">
            {p.docs.source && (
              <ExternalLink href={file(p.docs.source)}>
                <Icon name="external" size={14} /> Source on GitHub
              </ExternalLink>
            )}
            {p.docs.technical && (
              <ExternalLink href={file(p.docs.technical)}>
                <Icon name="external" size={14} /> Technical notes
              </ExternalLink>
            )}
            <ExternalLink href={p.repositoryUrl}>
              <Icon name="external" size={14} /> Repository
            </ExternalLink>
          </div>
        </section>
        <button className="ghost-btn office-profile" onClick={onProfile}>
          <Icon name="agents" size={15} /> Open full profile
        </button>
      </div>
    </aside>
  );
}

