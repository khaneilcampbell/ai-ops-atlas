import { useMemo } from "react";
import { STATUSES } from "../catalog/types";
import { FilterBar, uniqueOptions } from "../components/Filters";
import { StatusPill, statusLabel } from "../components/bits";
import { effectiveLastRun, repoData } from "../lib/derive";
import { agentMatches } from "../lib/search";
import { formatDate, relative } from "../lib/time";
import { useAtlas } from "../state";

export function AgentsView() {
  const { catalog, repos, filters, select, selection } = useAtlas();
  const projectName = (id: string) => catalog.projects.find((p) => p.id === id)?.name ?? id;

  const rows = useMemo(
    () =>
      catalog.agents.filter(
        (a) =>
          (!filters.project || a.projectId === filters.project) &&
          (!filters.framework || a.framework === filters.framework) &&
          (!filters.status || a.status === filters.status) &&
          (!filters.language || repoData(repos[a.repository])?.language === filters.language) &&
          agentMatches(a, catalog.projects.find((p) => p.id === a.projectId), filters.query),
      ),
    [catalog, repos, filters],
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Registered in project manifests</div>
          <h1>Agents</h1>
        </div>
      </div>
      <FilterBar
        noun="agents"
        count={rows.length}
        defs={[
          { key: "project", label: "Project", options: catalog.projects.map((p) => ({ value: p.id, label: p.name })) },
          { key: "framework", label: "Framework", options: uniqueOptions(catalog.agents.map((a) => a.framework)) },
          { key: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) },
          { key: "language", label: "Language", options: uniqueOptions(Object.values(repos).map((r) => repoData(r)?.language)) },
        ]}
      />
      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">No agents match these filters.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Project</th>
                <th>Framework</th>
                <th>Status</th>
                <th>Last run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const last = effectiveLastRun(a, repoData(repos[a.repository]));
                return (
                  <tr
                    key={a.id}
                    className={selection?.kind === "agent" && selection.id === a.id ? "selected" : undefined}
                    onClick={() => select({ kind: "agent", id: a.id })}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && select({ kind: "agent", id: a.id })}
                  >
                    <td>
                      <div className="name">{a.name}</div>
                      <div className="desc">{a.purpose}</div>
                    </td>
                    <td className="small">{projectName(a.projectId)}</td>
                    <td>
                      <span className="chip">{a.framework}</span>
                    </td>
                    <td>
                      <StatusPill status={a.status} />
                    </td>
                    <td className="small" title={last ? formatDate(last) : undefined}>
                      <span className={last ? undefined : "muted"}>{relative(last)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
