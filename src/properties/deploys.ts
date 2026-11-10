import { githubGet } from "../github/transport";
import type { WebProperty } from "./registry";

// Production deploys of a website, read from GitHub (no new credentials: the same read-only
// GitHub access the rest of Atlas uses). Cloudflare Workers Builds reports each build as a check
// run on the commit; GitHub Pages records a deployment with statuses.

export type DeployState = "success" | "failure" | "in_progress" | "queued" | "cancelled";

export interface Deploy {
  id: string;
  state: DeployState;
  /** When it started (or was created). */
  at: string;
  finishedAt: string | null;
  sha: string;
  /** Build log or deployment page. */
  url: string;
  /** "Workers Builds: benjaire-com", "github-pages". */
  label: string;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function checkRunState(r: J): DeployState {
  if (r.status === "queued" || r.status === "waiting" || r.status === "pending") return "queued";
  if (r.status !== "completed") return "in_progress";
  if (r.conclusion === "success" || r.conclusion === "neutral" || r.conclusion === "skipped") return "success";
  if (r.conclusion === "cancelled" || r.conclusion === "stale") return "cancelled";
  // failure, timed_out, action_required, startup_failure
  return "failure";
}

/** The deploy check runs on one commit. */
export function fromCheckRuns(j: J, sha: string, name: string, ignoreSkipped = false): Deploy[] {
  return (Array.isArray(j?.check_runs) ? j.check_runs : [])
    .filter((r: J) => typeof r?.name === "string" && r.name.startsWith(name))
    .filter((r: J) => !(ignoreSkipped && r.conclusion === "skipped"))
    .map(
      (r: J): Deploy => ({
        id: `check:${r.id}`,
        state: checkRunState(r),
        at: r.started_at ?? r.completed_at ?? new Date(0).toISOString(),
        finishedAt: r.completed_at ?? null,
        sha,
        url: r.details_url || r.html_url || "",
        label: r.name,
      }),
    );
}

export function deploymentState(status: J | undefined): DeployState {
  switch (status?.state) {
    case "success":
      return "success";
    case "failure":
    case "error":
      return "failure";
    case "inactive":
      // A newer deployment replaced it; it did go out.
      return "success";
    case "queued":
    case "pending":
      return "queued";
    case undefined:
      return "queued";
    default:
      return "in_progress";
  }
}

export function fromDeployment(d: J, latest: J | undefined, repoUrl: string): Deploy {
  return {
    id: `deployment:${d.id}`,
    state: deploymentState(latest),
    at: d.created_at,
    finishedAt: latest && latest.state !== "in_progress" && latest.state !== "queued" && latest.state !== "pending" ? latest.created_at ?? null : null,
    sha: String(d.sha ?? ""),
    url: latest?.log_url || latest?.target_url || `${repoUrl}/deployments/${encodeURIComponent(d.environment ?? "")}`,
    label: d.environment ?? "deployment",
  };
}

const newestFirst = (a: Deploy, b: Deploy) => Date.parse(b.at) - Date.parse(a.at);

/**
 * The newest production deploys, newest first. `shas` are the default branch's latest commits
 * (already in the repository snapshot), so check runs cost one request per commit, and
 * unchanged answers come back as free 304s.
 */
export async function fetchDeploys(p: Pick<WebProperty, "repository" | "deploy">, shas: string[]): Promise<Deploy[]> {
  const base = `/repos/${p.repository}`;
  if (p.deploy.kind === "check-runs") {
    const { name, ignoreSkipped } = p.deploy;
    const lists = await Promise.all(shas.slice(0, 3).map(async (sha) => fromCheckRuns((await githubGet(`${base}/commits/${sha}/check-runs?per_page=50`)) as J, sha, name, ignoreSkipped)));
    return lists.flat().sort(newestFirst);
  }
  const env = encodeURIComponent(p.deploy.environment);
  const list = ((await githubGet(`${base}/deployments?environment=${env}&per_page=5`)) as J[]) ?? [];
  const recent = Array.isArray(list) ? list.slice(0, 3) : [];
  const statuses = await Promise.all(recent.map(async (d) => ((await githubGet(`${base}/deployments/${d.id}/statuses?per_page=1`)) as J[])?.[0]));
  return recent.map((d, i) => fromDeployment(d, statuses[i], `https://github.com/${p.repository}`)).sort(newestFirst);
}
