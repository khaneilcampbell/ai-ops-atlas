import { isAiAgent } from "../catalog/roles";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { relative, formatDate } from "../lib/time";
import { load, save } from "../lib/storage";
import { useIntel } from "../intel/state";
import { ownership, rollupHealth } from "../catalog/ownership";
import { buildRegistry, filterEntries, GROUP_LABEL, groupEntries, runtimeOf, SORT_LABEL, sortEntries, summarize, type GroupKey, type RegistryEntry, type SortKey } from "../registry/registry";
import { OPERATIONAL_LABEL } from "../registry/telemetry";
import { CATEGORIES, CATEGORY_LABEL, CLASSIFICATION_INFO, CLASSIFICATIONS, type Operational } from "../registry/types";
import { useAtlas } from "../state";
import { Goals } from "./agents/Goals";
import { Inspector } from "./agents/Inspector";
import { Manage } from "./agents/Manage";
import { CLASS_COLOR, ClassBadge, OperationalPill, RiskPill } from "./agents/parts";
import { Portfolio } from "./agents/Portfolio";
import "../styles/registry.css";

type Sub = "directory" | "portfolio" | "goals" | "manage";
const SUBS: { id: Sub; label: string }[] = [
  { id: "directory", label: "Directory" },
  { id: "portfolio", label: "Portfolio" },
  { id: "goals", label: "Goals & performance" },
  { id: "manage", label: "Manage agents" },
];

interface Prefs {
  sub: Sub;
  group: GroupKey;
  sort: SortKey;
  category: string;
  classification: string;
  operational: string;
  runtime: string;
}
const DEFAULT_PREFS: Prefs = { sub: "directory", group: "none", sort: "title", category: "", classification: "", operational: "", runtime: "" };

/** Agent Registry: every registered agent, automation and pipeline, classified and documented. Read-only. */
export function AgentsView({ kind = "agents" }: { kind?: "agents" | "automations" }) {
  const { catalog: allCatalog, repos, filters, setFilters, select, selection } = useAtlas();
  const title = kind === "automations" ? "Automations" : "Agents";
  const catalog = useMemo(() => ({ ...allCatalog, agents: allCatalog.agents.filter(a => kind === "agents" ? isAiAgent(a) : !isAiAgent(a)) }), [allCatalog, kind]);
  const { telemetry: intel } = useIntel();
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const saved = { ...DEFAULT_PREFS, ...load<Partial<Prefs>>(`registry-prefs-${kind}`, {}) };
    // A saved filter from the former mixed directory must not hide the newly separated list.
    const types = kind === "agents" ? ["A", "F"] : ["B", "C", "D", "E"];
    return { ...saved, classification: types.includes(saved.classification) ? saved.classification : "" };
  });
  const set = (p: Partial<Prefs>) => setPrefs((x) => ({ ...x, ...p }));
  useEffect(() => save(`registry-prefs-${kind}`, prefs), [prefs, kind]);
  const list = useRef<HTMLDivElement>(null);

  const allEntries = useMemo(() => buildRegistry(allCatalog, repos, intel), [allCatalog, repos, intel]);
  const entries = useMemo(() => allEntries.filter((e) => catalog.agents.some((a) => a.id === e.profile.id)), [allEntries, catalog]);
  // Agents own goals; their automations are the fixed steps they run (catalog `owned_by`).
  const owns = useMemo(() => ownership(allCatalog), [allCatalog]);
  const byId = useMemo(() => new Map(allEntries.map((e) => [e.profile.id, e])), [allEntries]);
  const owners = useMemo(() => {
    const m = new Map<string, { id: string; title: string }>();
    for (const [agentId, autos] of owns.owned) for (const a of autos) m.set(a.id, { id: agentId, title: byId.get(agentId)?.profile.title ?? agentId });
    return m;
  }, [owns, byId]);
  const orphanIds = useMemo(() => new Set(owns.orphans.map((a) => a.id)), [owns]);
  const summary = useMemo(() => summarize(entries), [entries]);
  const rows = useMemo(
    () => sortEntries(filterEntries(entries, { query: filters.query, project: filters.project, category: prefs.category, classification: prefs.classification, operational: prefs.operational, runtime: prefs.runtime }), prefs.sort),
    [entries, filters.query, filters.project, prefs],
  );
  const groups = useMemo(() => groupEntries(rows, prefs.group, owners), [rows, prefs.group, owners]);
  const flat = groups.flatMap((g) => g.entries);
  const current = (selection?.kind === "agent" && entries.find((e) => e.profile.id === selection.id)) || flat[0];

  const open = (id: string) => {
    select({ kind: "agent", id });
    set({ sub: "directory" });
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = flat.findIndex((x) => x.profile.id === current?.profile.id);
    const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    select({ kind: "agent", id: next.profile.id });
    list.current?.querySelector<HTMLButtonElement>(`[data-id="${next.profile.id}"]`)?.focus();
  };

  const anyFilter = filters.query || filters.project || prefs.category || prefs.classification || prefs.operational || prefs.runtime;

  return (
    <div className="page wide">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">{title} registry{prefs.sub === "manage" ? "" : " · read-only"}</div>
          <h1>{title}</h1>
          <p className="lede">
            {summary.total} {kind === "automations" ? "automations, AI-assisted workflows, pipelines, and integrations" : "AI agents and planned agents"} supporting your projects. {summary.operational.verified} verified running from live data.
          </p>
          {kind === "automations" && owns.orphans.length > 0 && (
            <p className="orphan-note" role="note">
              <Icon name="alert" size={13} /> {owns.orphans.length} {owns.orphans.length === 1 ? "automation has" : "automations have"} no owning agent yet. Each one is marked in the list; group by Owning agent to see them together.
            </p>
          )}
          <p className="muted">{kind === "agents" ? "Agents use model-driven reasoning; planned agents are labeled separately. Fixed workflows are listed under Automations." : "Predefined workflows, including those with AI steps. Listed here does not mean enabled or running."}</p>
        </div>
        <div className="seg" role="tablist" aria-label="Registry views">
          {SUBS.filter((s) => s.id !== "manage" || kind === "agents").map((s) => (
            <button key={s.id} role="tab" aria-selected={prefs.sub === s.id} className={prefs.sub === s.id ? "on" : ""} onClick={() => set({ sub: s.id })}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {prefs.sub === "portfolio" && <Portfolio entries={entries} summary={summary} open={open} />}
      {prefs.sub === "goals" && <Goals entries={rows} open={open} />}
      {prefs.sub === "manage" && kind === "agents" && <Manage open={open} />}

      {prefs.sub === "directory" && (
        <>
          <div className="filters" role="search">
            <label className="field">
              <Icon name="search" size={14} />
              <input value={filters.query} onChange={(e) => setFilters({ query: e.target.value })} placeholder={`Search ${title.toLowerCase()}, tools, functions`} aria-label={`Search ${title.toLowerCase()}`} />
            </label>
            <Select label="Project" value={filters.project} onChange={(v) => setFilters({ project: v })} options={catalog.projects.filter((p) => p.agentIds.length).map((p) => ({ value: p.id, label: p.name }))} />
            <Select label="Function" value={prefs.category} onChange={(v) => set({ category: v })} options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
            <Select label="Type" value={prefs.classification} onChange={(v) => set({ classification: v })} options={CLASSIFICATIONS.filter(c => summary.byClass[c] > 0).map((c) => ({ value: c, label: `${c} · ${CLASSIFICATION_INFO[c].label}` }))} />
            <Select
              label="Status"
              value={prefs.operational}
              onChange={(v) => set({ operational: v })}
              options={(Object.keys(OPERATIONAL_LABEL) as Operational[]).map((o) => ({ value: o, label: OPERATIONAL_LABEL[o] }))}
            />
            <Select label="Runtime" value={prefs.runtime} onChange={(v) => set({ runtime: v })} options={[...new Set(entries.map(runtimeOf))].sort().map((r) => ({ value: r, label: r }))} />
            <Select label="Group" value={prefs.group} all={false} onChange={(v) => set({ group: v as GroupKey })} options={(Object.keys(GROUP_LABEL) as GroupKey[]).filter((g) => g !== "owner" || kind === "automations").map((g) => ({ value: g, label: GROUP_LABEL[g] }))} />
            <Select label="Sort" value={prefs.sort} all={false} onChange={(v) => set({ sort: v as SortKey })} options={(Object.keys(SORT_LABEL) as SortKey[]).map((s) => ({ value: s, label: SORT_LABEL[s] }))} />
            {anyFilter && (
              <button
                className="text-btn"
                onClick={() => {
                  setFilters({ query: "", project: "" });
                  set({ category: "", classification: "", operational: "", runtime: "" });
                }}
              >
                Clear filters
              </button>
            )}
            <span className="count">{rows.length} {title.toLowerCase()}</span>
          </div>

          {rows.length === 0 ? (
            <div className="card empty">No {title.toLowerCase()} match these filters.</div>
          ) : (
            <div className="agents-split">
              <div className="card agent-list reg-list-pane" ref={list} onKeyDown={onListKey} aria-label={title}>
                {groups.map((g) => (
                  <section key={g.key}>
                    {prefs.group !== "none" && (
                      <div className="reg-group">
                        {prefs.group === "operational" ? OPERATIONAL_LABEL[g.key as Operational] : g.label} <span className="count-pill">{g.entries.length}</span>
                      </div>
                    )}
                    <ul>
                      {g.entries.map((e) => {
                        const steps = (owns.owned.get(e.profile.id) ?? []).flatMap((a) => byId.get(a.id) ?? []);
                        const pick = (id: string) => () => select({ kind: "agent", id });
                        return (
                          <li key={e.profile.id}>
                            <Row
                              e={e}
                              on={e.profile.id === current?.profile.id}
                              onClick={pick(e.profile.id)}
                              group={steps.length ? rollupHealth([e.operational, ...steps.map((x) => x.operational)]) : undefined}
                              owner={kind === "automations" ? (owners.get(e.profile.id)?.title ?? (orphanIds.has(e.profile.id) ? null : undefined)) : undefined}
                            />
                            {steps.length > 0 && (
                              <ul className="reg-nested" aria-label={`Automations run by ${e.profile.title}`}>
                                {steps.map((x) => (
                                  <li key={x.profile.id}>
                                    <button className={`reg-step ${x.profile.id === current?.profile.id ? "on" : ""}`} onClick={pick(x.profile.id)}>
                                      <i className={`op-dot op-${x.operational}`} aria-hidden />
                                      <span className="grow">{x.profile.title}</span>
                                      <span className="muted small">{OPERATIONAL_LABEL[x.operational]}</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
              {current && <Inspector key={current.profile.id} entry={current} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** `group`: rolled-up health of an agent and the automations it owns. `owner`: for an automation,
 *  its owning agent's title, null when it has none (an orphan), undefined when not shown. */
function Row({ e, on, onClick, group, owner }: { e: RegistryEntry; on: boolean; onClick: () => void; group?: Operational; owner?: string | null }) {
  const p = e.profile;
  const last = e.telemetry.lastVerifiedRun;
  return (
    <button data-id={p.id} className={`agent-row reg-row ${on ? "on" : ""}`} aria-current={on || undefined} onClick={onClick}>
      <i className="roof" style={{ background: CLASS_COLOR[p.classification] }} />
      <span className="grow">
        <span className="title">{p.title}</span>
        <span className="meta">
          {p.project.name} · {CATEGORY_LABEL[p.category]}
        </span>
        <span className="reg-row-chips">
          <ClassBadge c={p.classification} />
          <span className="muted small">{p.framework}</span>
        </span>
        {owner === null && <span className="reg-row-owner"><span className="orphan-chip" title="No agent owns this automation yet">No owning agent</span></span>}
        {owner && <span className="reg-row-owner muted small">Run by {owner}</span>}
      </span>
      <span className="right">
        {group && (
          <span className="group-health" title={`Agent and its automations: ${OPERATIONAL_LABEL[group]}`}>
            <i className={`op-dot op-${group}`} aria-hidden /> Group: {OPERATIONAL_LABEL[group]}
          </span>
        )}
        <OperationalPill op={e.operational} />
        <span className="muted small" title={last ? formatDate(last.at) : undefined}>
          {last ? `Verified ${relative(last.at)}` : e.telemetry.source ? "No verified run" : "Not connected"}
        </span>
        <RiskPill risk={p.governance.risk} />
      </span>
    </button>
  );
}

function Select({ label, value, onChange, options, all = true }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; all?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {all && <option value="">All</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
