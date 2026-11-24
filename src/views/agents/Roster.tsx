import { useMemo, type ReactNode } from "react";
import type { Agent } from "../../catalog/types";
import { Icon } from "../../components/Icon";
import { AgentAvatar } from "../../components/AgentIdentity";
import type { IdentityStatus } from "../../registry/agentStatus";
import { identityFor } from "../../registry/identity";
import type { RegistryEntry } from "../../registry/registry";
import { OPERATIONAL_LABEL } from "../../registry/telemetry";
import { relative } from "../../lib/time";
import { AutonomyMeter } from "./parts";
import { buildRoster, filterRoster, rosterCounts, sortRoster, type RosterFilter, type RosterRow, type RosterSort } from "./rosterModel";
import "../../styles/roster.css";

const FILTERS: { id: RosterFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs", label: "Needs you" },
  { id: "verified", label: "Verified running" },
  { id: "unverified", label: "Not verified" },
  { id: "inactive", label: "Inactive" },
];
const COLS: { id: RosterSort | null; label: string }[] = [
  { id: "name", label: "Agent" },
  { id: "role", label: "Role" },
  { id: "health", label: "Health" },
  { id: "automations", label: "Automations" },
  { id: "verified", label: "Last verified" },
  { id: null, label: "Autonomy" },
  { id: null, label: "AI spend this month" },
];

export interface RosterPrefs { filter: RosterFilter; sort: RosterSort; desc: boolean }

/** Agents > Roster: every current AI agent in one sortable table, details beside it. Read-only. */
export function Roster({ agents, entries, statuses, query, setQuery, prefs, setPrefs, current, pick, detail }: {
  agents: Agent[];
  entries: RegistryEntry[];
  statuses: ReadonlyMap<string, { status: IdentityStatus }>;
  query: string;
  setQuery: (q: string) => void;
  prefs: RosterPrefs;
  setPrefs: (p: Partial<RosterPrefs>) => void;
  current?: string;
  pick: (id: string) => void;
  detail: ReactNode;
}) {
  const byId = useMemo(() => new Map(entries.map((e) => [e.profile.id, e])), [entries]);
  const all = useMemo(() => buildRoster(agents, byId), [agents, byId]);
  const counts = useMemo(() => rosterCounts(all), [all]);
  const rows = useMemo(() => sortRoster(filterRoster(all, prefs.filter, query), prefs.sort, prefs.desc), [all, prefs, query]);
  // Spend shows only once Atlas tracks it for some agent; a column of "Not tracked" says nothing.
  const cols = all.some((r) => r.spendUsd != null) ? COLS : COLS.filter((c) => c.label !== "AI spend this month");
  const sortBy = (id: RosterSort) => setPrefs(prefs.sort === id ? { desc: !prefs.desc } : { sort: id, desc: false });

  const automations = (r: RosterRow) => {
    const { live, paused, manual } = r.automations;
    const total = live + paused + manual;
    if (!total) return <span className="muted small">Works directly</span>;
    return (
      <span className="roster-autos" title={`${live} live · ${paused} paused · ${manual} manual or idle`}>
        <span className="roster-seg" aria-hidden>{live > 0 && <i className="live" style={{ flex: live }} />}{paused > 0 && <i className="paused" style={{ flex: paused }} />}{manual > 0 && <i className="manual" style={{ flex: manual }} />}</span>
        <span className="small">{total}</span>
      </span>
    );
  };

  return (
    <>
      <div className="filters roster-filters" role="search">
        <label className="field">
          <Icon name="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents, people, roles" aria-label="Search roster" />
        </label>
        <div className="roster-chips" role="group" aria-label="Roster filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={`roster-chip ${prefs.filter === f.id ? "on" : ""}`} aria-pressed={prefs.filter === f.id} onClick={() => setPrefs({ filter: f.id })}>
              {f.label} {counts[f.id]}
            </button>
          ))}
        </div>
      </div>
      <div className="agents-split roster-split">
        <div className="card roster-pane">
          <table className="roster" aria-label="Agent roster">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.label} aria-sort={c.id && prefs.sort === c.id ? (prefs.desc ? "descending" : "ascending") : undefined}>
                    {c.id ? <button onClick={() => sortBy(c.id!)}>{c.label}{prefs.sort === c.id ? (prefs.desc ? " ↓" : " ↑") : ""}</button> : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const who = identityFor(r.id, agents);
                return (
                  <tr key={r.id} data-id={r.id} className={`${r.id === current ? "on" : ""} ${r.inactive ? "dim" : ""}`} onClick={() => pick(r.id)}>
                    <td>
                      <button className="roster-who" onClick={(e) => { e.stopPropagation(); pick(r.id); }}>
                        <AgentAvatar identity={who} size={30} status={statuses.get(r.id)?.status} />
                        <span>
                          <b>{who.name}</b>
                          <span className="muted small">{who.name === r.name ? "" : r.name}</span>
                          {r.skills.length > 0 && <span className="muted small roster-skills" title={r.skills.join(" · ")}>{r.skills.length} skills: {r.skills.join(", ")}</span>}
                        </span>
                      </button>
                    </td>
                    <td className="small">{r.role}</td>
                    <td><span className="roster-health"><i className={`op-dot op-${r.operational}`} aria-hidden />{r.inactive ? "Inactive" : OPERATIONAL_LABEL[r.operational]}</span></td>
                    <td>{automations(r)}</td>
                    <td className="small">{r.lastVerifiedAt ? relative(r.lastVerifiedAt) : <span className="muted">No verified run</span>}</td>
                    <td><AutonomyMeter level={r.autonomy} /></td>
                    {cols.length === COLS.length && <td className="small mono">{r.spendUsd == null ? <span className="muted">Not tracked</span> : `$${r.spendUsd.toFixed(2)}`}</td>}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={cols.length} className="muted pad">No agents match.</td></tr>}
            </tbody>
          </table>
        </div>
        {detail}
      </div>
    </>
  );
}
