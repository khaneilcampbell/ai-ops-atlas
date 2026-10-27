import { useMemo } from "react";
import { FilterBar, uniqueOptions } from "../components/Filters";
import { Icon } from "../components/Icon";
import { Indicator, LangDot } from "../components/bits";
import { repoData, repoHealth } from "../lib/derive";
import { repoMatches, repoRows } from "../lib/search";
import { relative } from "../lib/time";
import { useAtlas } from "../state";

export function ReposView() {
  const { catalog, repos, uncataloged, filters, select, selection } = useAtlas();
  const all = useMemo(() => repoRows(catalog, repos, uncataloged), [catalog, repos, uncataloged]);
  const rows = all.filter(
    (r) =>
      (!filters.project || r.project?.id === filters.project) &&
      (!filters.language || repoData(r.state)?.language === filters.language) &&
      (!filters.framework || r.agents.some((a) => a.framework === filters.framework)) &&
      (!filters.status || r.agents.some((a) => a.status === filters.status)) &&
      repoMatches(r, filters.query),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Read from GitHub</div>
          <h1>Repositories</h1>
        </div>
      </div>
      <FilterBar
        noun="repositories"
        count={rows.length}
        defs={[
          { key: "project", label: "Project", options: catalog.projects.map((p) => ({ value: p.id, label: p.name })) },
          { key: "language", label: "Language", options: uniqueOptions(all.map((r) => repoData(r.state)?.language)) },
          { key: "framework", label: "Agent framework", options: uniqueOptions(catalog.agents.map((a) => a.framework)) },
        ]}
      />
      {rows.length === 0 && <div className="card empty">No repositories match these filters.</div>}
      <div className="grid two">
        {rows.map((r) => {
          const snap = repoData(r.state);
          const latest = snap?.commits[0];
          const selected = selection?.kind === "repo" && selection.id === r.name;
          return (
            <button key={r.name} className={`card repo-card ${selected ? "selected" : ""}`} onClick={() => select({ kind: "repo", id: r.name })}>
              <div className="top">
                <Icon name="repos" size={18} />
                <div className="grow">
                  <div className="rname">{r.name.split("/")[1]}</div>
                  <div className="muted small">
                    {r.name.split("/")[0]} · {r.project?.name ?? "Not in the catalog yet"}
                  </div>
                </div>
                {snap && <span className="chip">{snap.visibility}</span>}
              </div>
              <div className="small" style={{ color: "var(--ink-2)" }}>
                {snap?.description ?? r.project?.summary ?? ""}
              </div>
              {r.state?.kind === "error" && (
                <div className="notice">
                  <Icon name="alert" size={15} />
                  <span>
                    {r.state.message}
                    {r.state.data ? ` Showing data from ${relative(r.state.data.fetchedAt)}.` : ""}
                  </span>
                </div>
              )}
              {r.state?.kind === "loading" && <div className="muted small">Loading from GitHub…</div>}
              <div className="commit">
                <div className="section-title" style={{ marginBottom: 4 }}>
                  Latest commit
                </div>
                {latest ? (
                  <>
                    <div className="small" style={{ fontWeight: 500 }}>
                      {latest.message}
                    </div>
                    <div className="muted small">
                      <span className="mono">{latest.sha.slice(0, 7)}</span> · {latest.author} · {relative(latest.date)}
                    </div>
                  </>
                ) : (
                  <div className="muted small">Not loaded</div>
                )}
              </div>
              <div className="indicators">
                <LangDot lang={snap?.language ?? null} />
                {repoHealth(snap, r.agents.length).map((i) => (
                  <Indicator key={i.key} ind={i} />
                ))}
              </div>
              <div className="chips">
                {!r.project && <span className="chip">Add a manifest in catalog/ to link agents</span>}
                {r.agents.slice(0, 6).map((a) => (
                  <span key={a.id} className="chip">
                    {a.name}
                  </span>
                ))}
                {r.agents.length > 6 && <span className="chip">+{r.agents.length - 6} more</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
