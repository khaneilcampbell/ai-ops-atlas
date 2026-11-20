import { useMemo } from "react";
import { projectRepositories } from "../catalog/projects";
import { directoryItems } from "../catalog/roles";
import { STATUSES } from "../catalog/types";
import { FilterBar } from "../components/Filters";
import { StatusPill, statusLabel } from "../components/bits";
import { matches } from "../lib/search";
import { useAtlas } from "../state";
import { rosterAgents } from "./map3d/cityRoster";

/**
 * Projects: the practical list view of every Atlas project, next to the Map's city view. Each
 * project shows its status, linked repositories and assigned agents; opening one shows the same
 * detail panel as selecting its building. Read-only, from the catalog; nothing is fetched.
 */
export function ProjectsView() {
  const { catalog, filters, select } = useAtlas();
  const all = useMemo(
    () =>
      catalog.projects.map((p) => {
        const own = catalog.agents.filter((a) => a.projectId === p.id);
        // Counted like the map headline: active agents once per identity, and active automations.
        return { p, repositories: projectRepositories(p, catalog.agents), agents: rosterAgents(own), automations: directoryItems(own, "automations").length };
      }),
    [catalog],
  );
  const rows = all.filter(
    ({ p, repositories, agents }) =>
      (!filters.status || p.status === filters.status) &&
      matches(filters.query, p.name, p.summary, p.organization, ...(p.formerNames ?? []), ...p.tags, ...repositories, ...agents.map((a) => a.identity.name)),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Projects</div>
          <h1>Every project, as a list.</h1>
          <p className="lede">Status, linked repositories and assigned agents for each Atlas project. The Map shows the same projects as a city.</p>
        </div>
      </div>
      <FilterBar noun="projects" count={rows.length} defs={[{ key: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) }]} />
      {rows.length === 0 ? (
        <div className="card empty">No projects match these filters.</div>
      ) : (
        <section className="card">
          <table className="table">
            <caption className="sr-only">Atlas projects</caption>
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Repositories</th>
                <th>Agents</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, repositories, agents, automations }) => (
                <tr key={p.id}>
                  <td>
                    <button className="text-btn" onClick={() => select({ kind: "project", id: p.id })}>{p.name}</button>
                    <div className="muted small">{p.summary}</div>
                  </td>
                  <td><StatusPill status={p.status} /></td>
                  <td>
                    <div className="chips">
                      {repositories.map((r) => (
                        <button key={r} className="chip" onClick={() => select({ kind: "repo", id: r })} title={`Open ${r}`}>{r.split("/").pop()}</button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="chips">
                      {agents.map(({ agent, identity }) => (
                        <button key={agent.id} className="chip" onClick={() => select({ kind: "agent", id: agent.id })}>{identity.name}</button>
                      ))}
                      {agents.length === 0 && <span className="muted small">No agents</span>}
                    </div>
                    {automations > 0 && <div className="muted small">{automations} automation{automations === 1 ? "" : "s"}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
