import { useMemo } from "react";
import { projectRepositories } from "../catalog/projects";
import { directoryItems } from "../catalog/roles";
import { rosterAgents } from "./map3d/cityRoster";
import { ciSummary, repoData, verifiedState } from "../lib/derive";
import { relative } from "../lib/time";
import { useAtlas } from "../state";

/**
 * Intel → Intelligence: what Atlas knows about each of its projects, from the catalog and the
 * GitHub data already loaded. Read-only; it fetches nothing and starts no runs.
 */
export function AtlasIntelligenceView() {
  const { catalog, repos, select } = useAtlas();
  const rows = useMemo(
    () =>
      catalog.projects.map((p) => {
          const agents = catalog.agents.filter((a) => a.projectId === p.id);
          const repositories = projectRepositories(p, catalog.agents);
          const live = repositories.filter((r) => repoData(repos[r])).length;
          const pushed = repositories.map((r) => repoData(repos[r])?.pushedAt ?? null).filter((d): d is string => !!d).sort().pop() ?? null;
          // Counted like the map headline: active agents once per identity, and active automations.
          return { p, ai: rosterAgents(agents).length, automations: directoryItems(agents, "automations").length, repositories, live, pushed, ci: ciSummary(repositories, repos) };
        }),
    [catalog, repos],
  );
  const allRepos = [...new Set(rows.flatMap((r) => r.repositories))];
  const ci = ciSummary(allRepos, repos);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Atlas · read-only</div>
          <h1>Data intelligence</h1>
          <p className="lede">Every Atlas project with its agents, automations, repositories and the GitHub data Atlas has for them. Open a project for its details.</p>
        </div>
      </div>
      <div className="grid tiles" style={{ marginBottom: 16 }}>
        <div className="card tile accent">
          <div className="eyebrow">Projects</div>
          <div className="num">{rows.length}</div>
          <div className="sub">in the catalog</div>
        </div>
        <div className="card tile">
          <div className="eyebrow">Agents · automations</div>
          <div className="num">{rosterAgents(catalog.agents).length} · {directoryItems(catalog.agents, "automations").length}</div>
          <div className="sub">in the catalog</div>
        </div>
        <div className="card tile">
          <div className="eyebrow">Repositories with data</div>
          <div className="num">{allRepos.filter((r) => repoData(repos[r])).length} / {allRepos.length}</div>
          <div className="sub">read from GitHub</div>
        </div>
        <div className="card tile">
          <div className="eyebrow">CI failing</div>
          <div className="num">{ci.failing.length}</div>
          <div className="sub">{ci.checked} of {ci.total} repositories checked</div>
        </div>
      </div>
      <section className="card">
        <table className="table">
          <caption className="sr-only">Atlas projects and their data</caption>
          <thead>
            <tr>
              <th>Project</th>
              <th>Agents</th>
              <th>Automations</th>
              <th>Repositories</th>
              <th>CI</th>
              <th>Last push</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, ai, automations, repositories, live, pushed, ci }) => (
              <tr key={p.id}>
                <td>
                  <button className="text-btn" onClick={() => select({ kind: "project", id: p.id })}>{p.name}</button>
                </td>
                <td>{ai}</td>
                <td>{automations}</td>
                <td>{live} of {repositories.length} with data</td>
                <td className="small">{ci.failing.length ? `${ci.failing.length} failing` : ci.checked ? "Passing" : repositories.map((r) => verifiedState(repos[r]).label)[0]}</td>
                <td className="small muted">{pushed ? relative(pushed) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
