import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { relative, formatDate } from "../lib/time";
import { load, save } from "../lib/storage";
import { useIntel } from "../intel/state";
import { buildRegistry, filterEntries, GROUP_LABEL, groupEntries, runtimeOf, SORT_LABEL, sortEntries, summarize, type GroupKey, type RegistryEntry, type SortKey } from "../registry/registry";
import { OPERATIONAL_LABEL } from "../registry/telemetry";
import { CATEGORIES, CATEGORY_LABEL, CLASSIFICATION_INFO, CLASSIFICATIONS, type Operational } from "../registry/types";
import { useAtlas } from "../state";
import { Goals } from "./agents/Goals";
import { Inspector } from "./agents/Inspector";
import { CLASS_COLOR, ClassBadge, OperationalPill, RiskPill } from "./agents/parts";
import { Portfolio } from "./agents/Portfolio";
import "../styles/registry.css";

type Sub = "directory" | "portfolio" | "goals";
const SUBS: { id: Sub; label: string }[] = [
  { id: "directory", label: "Directory" },
  { id: "portfolio", label: "Portfolio" },
  { id: "goals", label: "Goals & performance" },
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
export function AgentsView() {
  const { catalog, repos, filters, setFilters, select, selection } = useAtlas();
  const { telemetry: intel } = useIntel();
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...load<Partial<Prefs>>("registry-prefs", {}) }));
  const set = (p: Partial<Prefs>) => setPrefs((x) => ({ ...x, ...p }));
  useEffect(() => save("registry-prefs", prefs), [prefs]);
  const list = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => buildRegistry(catalog, repos, intel), [catalog, repos, intel]);
  const summary = useMemo(() => summarize(entries), [entries]);
  const rows = useMemo(
    () => sortEntries(filterEntries(entries, { query: filters.query, project: filters.project, category: prefs.category, classification: prefs.classification, operational: prefs.operational, runtime: prefs.runtime }), prefs.sort),
    [entries, filters.query, filters.project, prefs],
  );
  const groups = useMemo(() => groupEntries(rows, prefs.group), [rows, prefs.group]);
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
  const b = summary.byClass;

  return (
    <div className="page wide">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Agent registry · read-only</div>
          <h1>Agents</h1>
          <p className="lede">
            {summary.total} registered items: {b.A} AI agents, {b.B} AI-assisted workflows, {b.C} automations, {b.D} CI/CD pipelines
            {b.E ? `, ${b.E} integration${b.E > 1 ? "s" : ""}` : ""}
            {b.F ? `, ${b.F} planned` : ""}. {summary.operational.verified} verified running from live data.
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="Registry views">
          {SUBS.map((s) => (
            <button key={s.id} role="tab" aria-selected={prefs.sub === s.id} className={prefs.sub === s.id ? "on" : ""} onClick={() => set({ sub: s.id })}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {prefs.sub === "portfolio" && <Portfolio entries={entries} summary={summary} open={open} />}
      {prefs.sub === "goals" && <Goals entries={rows} open={open} />}

      {prefs.sub === "directory" && (
        <>
          <div className="filters" role="search">
            <label className="field">
              <Icon name="search" size={14} />
              <input value={filters.query} onChange={(e) => setFilters({ query: e.target.value })} placeholder="Search agents, tools, functions" aria-label="Search agents" />
            </label>
            <Select label="Project" value={filters.project} onChange={(v) => setFilters({ project: v })} options={catalog.projects.filter((p) => p.agentIds.length).map((p) => ({ value: p.id, label: p.name }))} />
            <Select label="Function" value={prefs.category} onChange={(v) => set({ category: v })} options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
            <Select label="Type" value={prefs.classification} onChange={(v) => set({ classification: v })} options={CLASSIFICATIONS.map((c) => ({ value: c, label: `${c} · ${CLASSIFICATION_INFO[c].label}` }))} />
            <Select
              label="Status"
              value={prefs.operational}
              onChange={(v) => set({ operational: v })}
              options={(Object.keys(OPERATIONAL_LABEL) as Operational[]).map((o) => ({ value: o, label: OPERATIONAL_LABEL[o] }))}
            />
            <Select label="Runtime" value={prefs.runtime} onChange={(v) => set({ runtime: v })} options={[...new Set(entries.map(runtimeOf))].sort().map((r) => ({ value: r, label: r }))} />
            <Select label="Group" value={prefs.group} all={false} onChange={(v) => set({ group: v as GroupKey })} options={(Object.keys(GROUP_LABEL) as GroupKey[]).map((g) => ({ value: g, label: GROUP_LABEL[g] }))} />
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
            <span className="count">{rows.length} agents</span>
          </div>

          {rows.length === 0 ? (
            <div className="card empty">No agents match these filters.</div>
          ) : (
            <div className="agents-split">
              <div className="card agent-list reg-list-pane" ref={list} onKeyDown={onListKey} aria-label="Agents">
                {groups.map((g) => (
                  <section key={g.key}>
                    {prefs.group !== "none" && (
                      <div className="reg-group">
                        {prefs.group === "operational" ? OPERATIONAL_LABEL[g.key as Operational] : g.label} <span className="count-pill">{g.entries.length}</span>
                      </div>
                    )}
                    <ul>
                      {g.entries.map((e) => (
                        <li key={e.profile.id}>
                          <Row e={e} on={e.profile.id === current?.profile.id} onClick={() => select({ kind: "agent", id: e.profile.id })} />
                        </li>
                      ))}
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

function Row({ e, on, onClick }: { e: RegistryEntry; on: boolean; onClick: () => void }) {
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
      </span>
      <span className="right">
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
