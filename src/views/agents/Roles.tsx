import { useMemo } from "react";
import { ESSENTIAL_ROLES, memberKind, placement, roleActivity, roleDirectory, roleOf } from "../../catalog/essentialRoles";
import type { Agent, Project } from "../../catalog/types";
import { filterEntries, EMPTY_FILTER, type RegistryEntry } from "../../registry/registry";
import { OPERATIONAL_LABEL } from "../../registry/telemetry";

export type RoleView = "roles" | "inactive" | "archived";
const NAME = new Map(ESSENTIAL_ROLES.map((r) => [r.id, r.name]));

/** Essential roles with their agents and automations nested underneath, plus Inactive and Archived. */
export function Roles({ agents, projects, entries, view, query, current, pick }: { agents: Agent[]; projects: Project[]; entries: RegistryEntry[]; view: RoleView; query: string; current?: string; pick: (id: string) => void }) {
  const dir = useMemo(() => roleDirectory(agents), [agents]);
  const roles = useMemo(() => roleOf(agents), [agents]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const entry = useMemo(() => new Map(entries.map((e) => [e.profile.id, e])), [entries]);
  const hits = useMemo(() => new Set(filterEntries(entries, { ...EMPTY_FILTER, query }).map((e) => e.profile.id)), [entries, query]);
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
    return (
      <li key={id}>
        <button data-id={id} className={`reg-step ${id === current ? "on" : ""}`} onClick={() => pick(id)}>
          <i className={`op-dot op-${e.operational}`} aria-hidden />
          <span className="grow">
            {e.profile.title}
            <span className="muted small role-meta">{memberKind(a)} · {where(a)}{withRole ? ` · ${a.status === "retired" ? "Archived" : (NAME.get(roles.get(id) ?? "") ?? "No owning role")}` : ""}</span>
          </span>
          <span className="muted small">{OPERATIONAL_LABEL[e.operational]}{last ? ` · ${last.at.slice(0, 10)}` : ""}</span>
        </button>
      </li>
    );
  };

  if (view !== "roles") {
    const ids = show(view === "inactive" ? dir.inactive : dir.archived);
    return ids.length ? <ul className="role-plain" aria-label={view === "inactive" ? "Inactive entries" : "Archived entries"}>{ids.map((id) => row(id, true))}</ul> : <p className="muted pad">Nothing {view} matches.</p>;
  }
  return (
    <div className="role-list">
      {ESSENTIAL_ROLES.map((r) => {
        const all = dir.members.get(r.id) ?? [];
        const ids = show(all);
        if (query && !ids.length) return null;
        const act = roleActivity(all.flatMap((id) => (entry.has(id) ? [{ operational: entry.get(id)!.operational, lastVerifiedAt: entry.get(id)!.telemetry.lastVerifiedRun?.at ?? null }] : [])));
        const autos = all.filter((id) => memberKind(byId.get(id)!) === "Automation").length;
        const leads = ids.filter((id) => memberKind(byId.get(id)!) !== "Automation");
        const loose = ids.filter((id) => memberKind(byId.get(id)!) === "Automation" && !leads.includes(byId.get(id)!.ownedBy ?? ""));
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
                const steps = ids.filter((s) => byId.get(s)!.ownedBy === id);
                return [row(id), steps.length > 0 && <li key={`${id}-steps`}><ul className="reg-nested" aria-label={`Automations run by ${entry.get(id)!.profile.title}`}>{steps.map((s) => row(s))}</ul></li>];
              })}
              {loose.map((id) => row(id))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
