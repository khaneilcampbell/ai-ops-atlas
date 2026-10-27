import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { StatusPill } from "../components/bits";
import { ciHealth, overallHealth, repoData, repoHealth, type Health } from "../lib/derive";
import { load, save } from "../lib/storage";
import { repoMatches, repoRows, type RepoRow } from "../lib/search";
import { relative } from "../lib/time";
import { useAtlas } from "../state";
import { frameworkColor } from "./mapLayout";

type Sort = "push" | "name" | "health" | "agents";
const SORTS: Record<Sort, string> = { push: "Last push", name: "Name", health: "Health", agents: "Agents" };
const HEALTH_RANK: Record<Health, number> = { bad: 0, warn: 1, unknown: 2, good: 3 };
const HEALTH_WORD: Record<Health, string> = { good: "Healthy", warn: "Needs a look", bad: "Failing", unknown: "Not verified" };

/** Every project and repository as a dense, sortable grid: the compact alternative to the map. */
export function GridView() {
  const { catalog, repos, uncataloged, filters, select, selection } = useAtlas();
  const [sort, setSortState] = useState<Sort>(() => load<Sort>("gridSort", "push"));
  const setSort = (s: Sort) => {
    setSortState(s);
    save("gridSort", s);
  };

  const rows = useMemo(() => {
    const all = repoRows(catalog, repos, uncataloged)
      .filter((r) => repoMatches(r, filters.query))
      .map((r) => {
        const snap = repoData(r.state);
        return { r, snap, health: snap ? overallHealth(repoHealth(snap, r.agents.length)) : ("unknown" as Health) };
      });
    const title = (r: RepoRow) => r.project?.name ?? r.name.split("/")[1];
    return all.sort((a, b) => {
      if (sort === "name") return title(a.r).localeCompare(title(b.r));
      if (sort === "health") return HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || title(a.r).localeCompare(title(b.r));
      if (sort === "agents") return b.r.agents.length - a.r.agents.length || title(a.r).localeCompare(title(b.r));
      return (b.snap?.pushedAt ?? "").localeCompare(a.snap?.pushedAt ?? "") || title(a.r).localeCompare(title(b.r));
    });
  }, [catalog, repos, uncataloged, filters.query, sort]);

  // Arrow keys move between tiles, row by row, like a grid of icons in Finder.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.grid-tile")];
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const cols = Math.max(1, tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: tiles.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, next))]?.focus();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Compact grid</div>
          <h1>Every project, side by side.</h1>
        </div>
        <label className="field">
          <label htmlFor="grid-sort">Sort</label>
          <select id="grid-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {(Object.keys(SORTS) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORTS[s]}
              </option>
            ))}
          </select>
        </label>
        <span className="count">
          {rows.length} {rows.length === 1 ? "repository" : "repositories"}
          {filters.query && ` matching “${filters.query}”`}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">No repositories match the search.</div>
      ) : (
        <div className="tile-grid" onKeyDown={onKeyDown}>
          {rows.map(({ r, snap, health }) => {
            const ci = ciHealth(snap);
            const selected = selection?.kind === "repo" && selection.id === r.name;
            return (
              <button key={r.name} className={`card grid-tile ${selected ? "selected" : ""}`} onClick={() => select({ kind: "repo", id: r.name })}>
                <div className="gt-top">
                  {r.project ? <StatusPill status={r.project.status} /> : <span className="chip">Not in the catalog</span>}
                  <span className="grow" />
                  <span className="health" title={`Verified from GitHub: ${HEALTH_WORD[health]}`}>
                    <i className={`h-${health}`} />
                    {HEALTH_WORD[health]}
                  </span>
                </div>
                <div className="gt-name">{r.project?.name ?? r.name.split("/")[1]}</div>
                <div className="mono muted gt-repo">{r.name}</div>
                <div className="gt-agents" aria-label={`${r.agents.length} agents`}>
                  {r.agents.slice(0, 14).map((a) => (
                    <i key={a.id} title={`${a.name} · ${a.framework}`} style={{ background: a.status === "attention" ? "var(--gold)" : frameworkColor(a.framework) }} />
                  ))}
                  <span className="muted small">
                    {r.agents.length} {r.agents.length === 1 ? "agent" : "agents"}
                  </span>
                </div>
                <div className="gt-foot muted small">
                  <span>
                    <Icon name="commit" size={12} /> {snap?.pushedAt ? relative(snap.pushedAt) : "Not synced"}
                  </span>
                  <span>CI {ci.value.toLowerCase()}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
