import { useMemo } from "react";
import { RunsLine } from "./RunsLine";
import { ESSENTIAL_ROLES, memberKind, placement, roleActivity, roleDirectory, roleOf } from "../../catalog/essentialRoles";
import type { Agent, Project } from "../../catalog/types";
import { filterEntries, EMPTY_FILTER, type RegistryEntry } from "../../registry/registry";
import { OPERATIONAL_LABEL } from "../../registry/telemetry";
import { AgentIdentityLine } from "../../components/AgentIdentity";
import { identityFor } from "../../registry/identity";
import type { IdentityStatus } from "../../registry/agentStatus";

export type RoleView = "roles" | "inactive" | "archived";
const NAME = new Map(ESSENTIAL_ROLES.map((r) => [r.id, r.name]));

/** Essential roles with their AI agents, plus Inactive and Archived agents. Automations are never listed
 *  here as agents (Khaneil, 2026-11-18): an owning agent shows the automations it runs as one plain
 *  line that opens them in the Automations tab. */
export function Roles({ agents, projects, entries, view, query, current, pick, statuses }: { agents: Agent[]; projects: Project[]; entries: RegistryEntry[]; view: RoleView; query: string; current?: string; pick: (id: string) => void; statuses?: ReadonlyMap<string, { status: IdentityStatus }> }) {
  const dir = useMemo(() => roleDirectory(agents), [agents]);
  const roles = useMemo(() => roleOf(agents), [agents]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const entry = useMemo(() => new Map(entries.map((e) => [e.profile.id, e])), [entries]);
  const hits = useMemo(() => new Set(filterEntries(entries, { ...EMPTY_FILTER, query }).map((e) => e.profile.id)), [entries, query]);
  const isAgent = (id: string) => memberKind(byId.get(id)!) !== "Automation";
  const show = (ids: string[]) => ids.filter((id) => entry.has(id) && hits.has(id));
  const where = (a: Pick<Agent, "projectId">) => {
    const p = placement(a, projects);
    const b = p.building ?? "No building";
    return !p.module ? `${b} · No module` : p.module === b ? `${b} (module)` : `${b} · ${p.module} module`;
  };
  const row = (id: string, withRole = false) => {
    const e = entry.get(id)!;
    const a = byId.get(id)!;
    const last = e.telemetry.lastVerifiedRun;
    const identity = identityFor(id, agents);
    return (
      <li key={id}>
        <button data-id={id} className={`reg-step ${id === current ? "on" : ""}`} onClick={() => pick(id)}>
          <i className={`op-dot op-${e.operational}`} aria-hidden />
          <span className="grow">
            {identity.kind === "own" ? <AgentIdentityLine identity={identity} status={statuses?.get(id)?.status} size={30} /> : e.profile.title}
            <span className="muted small role-meta">{memberKind(a)} · {where(a)}{withRole ? ` · ${a.status === "retired" ? "Archived" : (NAME.get(roles.get(id) ?? "") ?? "No owning role")}` : ""}</span>
          </span>
          <span className="muted small">{OPERATIONAL_LABEL[e.operational]}{last ? ` · ${last.at.slice(0, 10)}` : ""}</span>
        </button>
      </li>
    );
  };

  if (view !== "roles") {
    const ids = show(view === "inactive" ? dir.inactive : dir.archived).filter(isAgent);
    return ids.length ? <ul className="role-plain" aria-label={view === "inactive" ? "Inactive entries" : "Archived entries"}>{ids.map((id) => row(id, true))}</ul> : <p className="muted pad">Nothing {view} matches.</p>;
  }
  return (
    <div className="role-list">
      {ESSENTIAL_ROLES.map((r) => {
        const all = dir.members.get(r.id) ?? [];
        const ids = show(all);
        if (query && !ids.length) return null;
        const act = roleActivity(all.flatMap((id) => (entry.has(id) ? [{ operational: entry.get(id)!.operational, lastVerifiedAt: entry.get(id)!.telemetry.lastVerifiedRun?.at ?? null }] : [])));
        const autos = all.filter((id) => !isAgent(id)).length;
        // A search that matches only an automation still shows the agent that runs it.
        const leads = all.filter((id) => isAgent(id) && entry.has(id) && (ids.includes(id) || ids.some((s) => byId.get(s)!.ownedBy === id)));
        if (query && !leads.length) return null;
        return (
          <details key={r.id} className="role-card" open={!!query || undefined} data-role={r.id}>
            <summary>
              <span className="title">{r.name} <span className="class-badge" title="An organizational grouping, not an AI runtime">Role</span></span>
              <span className="meta">{r.purpose}</span>
              <span className="muted small">Home: {where(byId.get(r.id)!)}</span>
              <span className="muted small">
                {plural(all.length - autos, "agent")} · {plural(autos, "automation")} · {act.verified} verified{act.failing ? ` · ${act.failing} failed` : ""}{act.stale ? ` · ${act.stale} stale` : ""}{act.unknown ? ` · ${act.unknown} unknown` : ""} · {act.noEvidence} no run evidence
              </span>
            </summary>
            <ul aria-label={`${r.name} members`}>
              {leads.map((id) => {
                const steps = all.filter((s) => !isAgent(s) && byId.get(s)!.ownedBy === id && entry.has(s));
                return [row(id), <RunsLine key={`${id}-runs`} agent={entry.get(id)!.profile.title} steps={steps.map((s) => ({ id: s, title: entry.get(s)!.profile.title }))} />];
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
