import { useMemo } from "react";
import { projectRepositories } from "../catalog/projects";
import { directoryItems } from "../catalog/roles";
import { rosterAgents } from "./map3d/cityRoster";
import { ciSummary, repoData, verifiedState } from "../lib/derive";
import { relative } from "../lib/time";
import { useAtlas } from "../state";
import { useIntel } from "../intel/state";
import { usd } from "../intel/format";

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
          <div className="eyebrow">Intel · Intelligence</div>
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

/**
 * Intel → API: the API figures Atlas already holds, read-only, with links to the full Provider usage
 * and Claude & GitHub pages, which open with this tab still selected.
 */
export function AtlasApiView() {
  const { setView, usage } = useAtlas();
  const intel = useIntel();
  const rate = usage?.rate;
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Intel · API</div>
          <h1>API</h1>
          <p className="lede">Claude spend against its monthly budget and GitHub requests against the hourly limit. Open Provider usage for spend caps, costs by workflow and history.</p>
        </div>
      </div>
      <section className="card" aria-labelledby="intel-api">
        <div className="card-head">
          <h2 className="grow" id="intel-api">Spend and limits</h2>
          <button className="text-btn small" onClick={() => setView("usage")}>Provider usage →</button>
          <button className="text-btn small" onClick={() => setView("api-costs")}>Claude & GitHub →</button>
        </div>
        <table className="table">
          <tbody>
            <tr>
              <td>Claude (repository intelligence)</td>
              <td>{intel.status ? `${usd(intel.status.month_spent_usd, 2)} this month${intel.status.config.monthly_budget_usd > 0 ? ` of ${usd(intel.status.config.monthly_budget_usd, 0)} budget` : ""}` : "Shown in the desktop app, which keeps the Anthropic key"}</td>
            </tr>
            <tr>
              <td>GitHub requests</td>
              <td>{rate ? `${Math.max(0, rate.limit - rate.remaining).toLocaleString()} of ${rate.limit.toLocaleString()} used this hour` : "Shown after the first refresh"}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
