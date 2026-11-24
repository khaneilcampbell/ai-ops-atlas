import { useMemo } from "react";
import type { Agent, Project } from "../../catalog/types";
import type { RegistryEntry } from "../../registry/registry";
import type { IdentityStatus } from "../../registry/agentStatus";
import { identityFor } from "../../registry/identity";
import { AgentAvatar } from "../../components/AgentIdentity";
import { buildTeam, type TeamRole } from "./teamModel";
import "../../styles/team.css";

const FACTORY = "atlas-agent-factory";

/** Agents > Team: the essential roles as an org chart, with what needs Khaneil. Read-only. */
export function Team({ agents, projects, entries, statuses, verified, open, openRoles }: {
  agents: Agent[];
  projects: Project[];
  entries: RegistryEntry[];
  statuses: ReadonlyMap<string, { status: IdentityStatus }>;
  verified: number;
  open: (id: string) => void;
  openRoles: () => void;
}) {
  const runs = useMemo(() => new Map(entries.map((e) => [e.profile.id, { operational: e.operational, lastVerifiedAt: e.telemetry.lastVerifiedRun?.at ?? null }])), [entries]);
  const team = useMemo(() => buildTeam(agents, projects, runs), [agents, projects, runs]);
  const factory = agents.find((a) => a.id === FACTORY)?.links.find((l) => /n8n/i.test(l.label));
  const who = (id: string) => identityFor(id, agents);
  const avatar = (id: string, size: number) => (
    <button key={id} className="team-face" onClick={() => open(id)} title={`${who(id).name} · ${who(id).role}`}>
      <AgentAvatar identity={who(id)} size={size} status={statuses.get(id)?.status} />
    </button>
  );
  const lead = (r: TeamRole, size: number) => {
    const p = who(r.lead);
    return (
      <div className="team-lead">
        {avatar(r.lead, size)}
        <div>
          <button className="team-name" onClick={() => open(r.lead)}>{p.name}</button>
          <div className="muted small">{p.role}</div>
          {r.building && <div className="muted small">{r.building}</div>}
        </div>
      </div>
    );
  };
  const health = (r: TeamRole) => <span className={`team-health ${r.health.tone}`}><i />{r.health.label}</span>;
  const count = (r: TeamRole) => [`${r.aiAgents} AI agent${r.aiAgents === 1 ? "" : "s"}`, r.skills.length ? `${r.skills.length} Product Lab skill${r.skills.length === 1 ? "" : "s"}` : "", `${r.automations} automation${r.automations === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  const waiting = team.needs.length;

  return (
    <div className="team">
      <div className="team-kpis">
        <div className="card team-kpi"><div className="eyebrow">AI agents</div><b>{team.counts.aiAgents}</b><span>{team.roles.length + 1} roles · {team.counts.unassigned} without a role{team.counts.skills ? ` · plus ${team.counts.skills} Product Lab skills` : ""}</span></div>
        <div className="card team-kpi"><div className="eyebrow">Verified running</div><b>{verified}</b><span>Seen running in live data</span></div>
        <div className="card team-kpi"><div className="eyebrow">Automations they own</div><b>{team.counts.automations}</b><span>Each one has an owning agent</span></div>
        <div className={`card team-kpi ${waiting ? "gold" : ""}`}><div className="eyebrow">Waiting on you</div><b>{waiting}</b><span>{waiting ? "Failing, drafts and inactive agents" : "Nothing right now"}</span></div>
        <div className="card team-kpi"><div className="eyebrow">Inactive · Archived</div><b>{team.counts.inactive} · {team.counts.archived}</b><span>Agents and automations listed apart, never counted as busy</span></div>
      </div>

      <div className="team-grid">
        <div className="team-main">
          <section className="card team-org" aria-label="Organisation">
            <div className="team-org-head"><h2>Organisation</h2><button className="link" onClick={openRoles}>Open the role directory</button></div>
            <div className="team-owner"><span className="team-owner-mark" aria-hidden>K</span><div><b>You</b><span>Owner · approve goals, merges and new agents</span></div></div>
            <div className="team-vline" />
            <div className="team-coord" data-role={team.coordinator.id}>
              {lead(team.coordinator, 56)}
              <div className="team-coord-meta">
                <div className="eyebrow">{team.coordinator.name} · coordinates every role</div>
                <span className="muted small">{count(team.coordinator)}</span>
                {health(team.coordinator)}
              </div>
            </div>
            <div className="team-vline" />
            <div className="team-roles">
              {team.roles.map((r) => (
                <article key={r.id} className="card team-role" data-role={r.id}>
                  <div className="team-role-head"><span className="eyebrow">{r.name}</span>{health(r)}</div>
                  {lead(r, 48)}
                  <div className="team-members">
                    {r.members.map((id) => avatar(id, 28))}
                    {r.skills.length > 0 && <span className="team-steps" title={r.skills.join(", ")}>{r.skills.length} Product Lab skills</span>}
                    {!r.members.length && !r.skills.length && <span className="muted small">Leads alone</span>}
                  </div>
                  <div className="muted small">{count(r)}</div>
                  <p className="muted small team-purpose">{r.purpose}</p>
                </article>
              ))}
              {factory && (
                <a className="team-propose" href={factory.url} target="_blank" rel="noreferrer">
                  <b>+ Propose an agent</b>
                  <span>Agent Factory drafts a spec. You approve or reject it in n8n.</span>
                </a>
              )}
            </div>
          </section>

          <section className="card team-life" aria-label="Lifecycle">
            <div><div className="eyebrow">Active AI agents</div><b>{team.lifecycle.active.length}</b><div className="team-stack">{team.lifecycle.active.slice(0, 14).map((id) => avatar(id, 24))}</div></div>
            <div><div className="eyebrow">Inactive AI agents</div><b>{team.lifecycle.inactive.length}</b>{team.lifecycle.inactive.length === 0 && <div className="muted small">Every AI agent is active</div>}<div className="team-stack">{team.lifecycle.inactive.map((id) => avatar(id, 24))}</div></div>
            <div><div className="eyebrow">Archived entries</div><b>{team.lifecycle.archived}</b><div className="muted small">Retired entries, kept for history</div></div>
          </section>
        </div>

        <aside className="card team-needs" aria-label="Needs you">
          <div className="team-org-head"><h2>Needs you</h2><span className="chip">{waiting}</span></div>
          {waiting === 0 && <p className="muted small">Nothing is failing, waiting to publish or inactive.</p>}
          {team.needs.map((n) => (
            <div key={`${n.kind}-${n.id}`} className={`team-need ${n.kind}`}>
              <AgentAvatar identity={who(n.agent)} size={30} />
              <div>
                <b>{n.title}</b>
                <span className="muted small">{who(n.agent).name} · {n.detail}</span>
                <div className="team-acts">
                  {n.link && <a className="btn" href={n.link.url} target="_blank" rel="noreferrer">Open in n8n</a>}
                  <button className="btn" onClick={() => open(n.id)}>Details</button>
                </div>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
