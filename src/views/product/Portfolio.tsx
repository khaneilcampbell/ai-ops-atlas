import { useMemo, useState } from "react";
import { CATEGORY_INFO, portfolio, type PortfolioProject } from "../../product/commandCenter";
import { CATEGORIES, productStore, type Category, type Workspace } from "../../product/workspace";
import { useAtlas } from "../../state";
import { useTasks } from "../../tasks/store";
import { KHANEIL } from "../../tasks/types";

/**
 * The owner's portfolio: every building grouped by category and business, with its repositories,
 * agents, workflows, tasks and outputs. Moving a building to another category only changes this
 * grouping (saved on the workspace); the map, its districts and building ids don't change.
 */
export function PortfolioCard({ w }: { w: Workspace | null }) {
  const { catalog, select } = useAtlas();
  const tasks = useTasks();
  const p = useMemo(() => portfolio(catalog, w, tasks), [catalog, w, tasks]);
  const [msg, setMsg] = useState<string | null>(null);
  const move = (id: string, to: Category | "") => {
    if (!w) return;
    const next = { ...w.categoryOverrides };
    if (to) next[id] = to;
    else delete next[id];
    const r = productStore().update(w.id, w.rev, { categoryOverrides: next }, KHANEIL, new Date().toISOString());
    setMsg(r.ok ? null : r.error);
  };
  return (
    <section className="card portfolio" aria-label="Portfolio">
      <div className="card-head">
        <h2 className="grow">Businesses and projects</h2>
      </div>
      <p className="muted small pf-portfolio-note">
        Category, then business, then building. Each building lists its repositories, agents, workflows, open tasks and outputs. A building's category follows its map district unless you move it here; moving it never moves it on the map.
      </p>
      {msg && <p className="small bad">{msg}</p>}
      {p.problems.length > 0 && (
        <div className="product-list warn">
          <h3>Broken references</h3>
          <ul>
            {p.problems.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="portfolio-cats">
        {p.categories.map((c) => (
          <div key={c.id} className="portfolio-cat">
            <h3>
              {c.label} <span className="muted small">· {c.businesses.reduce((n, b) => n + b.projects.length, 0)}</span>
            </h3>
            <p className="muted small">{c.description}</p>
            {c.businesses.length === 0 && <p className="muted small">No buildings here yet.</p>}
            {c.businesses.map((b) => (
              <div key={b.name} className="portfolio-biz">
                <h4>{b.name}</h4>
                <ul>
                  {b.projects.map((r) => (
                    <ProjectRow key={r.id} r={r} canMove={!!w} onOpen={() => select({ kind: "project", id: r.id })} onMove={(to) => move(r.id, to)} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectRow({ r, canMove, onOpen, onMove }: { r: PortfolioProject; canMove: boolean; onOpen: () => void; onMove: (to: Category | "") => void }) {
  const facts = [
    `${r.repositories.length} repo${r.repositories.length === 1 ? "" : "s"}`,
    `${r.agents.length} agent${r.agents.length === 1 ? "" : "s"}`,
    r.workflows.length ? `${r.workflows.length} workflow${r.workflows.length === 1 ? "" : "s"}` : "",
    r.openTasks ? `${r.openTasks} open task${r.openTasks === 1 ? "" : "s"}` : "",
    r.artifacts ? `${r.artifacts} output${r.artifacts === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return (
    <li className="portfolio-row">
      <button className="text-btn" onClick={onOpen}>
        {r.name}
      </button>
      <span className="muted small grow">{facts.join(" · ")}</span>
      {canMove && (
        <select aria-label={`Category for ${r.name}`} value={r.moved ? r.category : ""} onChange={(e) => onMove(e.target.value as Category | "")}>
          <option value="">{r.moved ? "Back to district default" : `${CATEGORY_INFO[r.category].label} (district)`}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_INFO[c].label}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}
