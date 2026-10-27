import { githubGet, GithubError } from "./transport";
import type { Commit, RepoSnapshot, WorkflowRun } from "./types";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toRun(r: J): WorkflowRun {
  return {
    name: r.name ?? r.display_title ?? "workflow",
    status: r.status,
    conclusion: r.conclusion ?? null,
    branch: r.head_branch ?? "",
    event: r.event ?? "",
    createdAt: r.created_at,
    url: r.html_url,
  };
}

async function optional<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    // A repo with Actions disabled or no commits answers 404/409 on these endpoints.
    if (e instanceof GithubError && (e.status === 404 || e.status === 409)) return fallback;
    throw e;
  }
}

export async function fetchRepo(fullName: string, workflows: string[]): Promise<RepoSnapshot> {
  const base = `/repos/${fullName}`;
  const repo = (await githubGet(base)) as J;
  const branch = encodeURIComponent(repo.default_branch);

  const [languages, commits, runs, ...wf] = await Promise.all([
    optional(githubGet(`${base}/languages`) as Promise<Record<string, number>>, {}),
    optional(githubGet(`${base}/commits?per_page=10&sha=${branch}`) as Promise<J[]>, []),
    optional(githubGet(`${base}/actions/runs?per_page=10&branch=${branch}`) as Promise<J>, { workflow_runs: [] }),
    ...workflows.map((w) =>
      optional(githubGet(`${base}/actions/workflows/${encodeURIComponent(w)}/runs?per_page=5`) as Promise<J>, { workflow_runs: [] }),
    ),
  ]);

  return {
    fullName: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    homepage: repo.homepage || null,
    language: repo.language,
    languages,
    visibility: repo.visibility ?? (repo.private ? "private" : "public"),
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
    stars: repo.stargazers_count ?? 0,
    openIssues: repo.open_issues_count ?? 0,
    license: repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION" ? repo.license.spdx_id : repo.license?.name ?? null,
    archived: !!repo.archived,
    commits: commits.map(
      (c): Commit => ({
        sha: c.sha,
        message: String(c.commit?.message ?? "").split("\n")[0],
        author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
        date: c.commit?.author?.date ?? c.commit?.committer?.date,
        url: c.html_url,
      }),
    ),
    runs: (runs.workflow_runs ?? []).map(toRun),
    workflowRuns: Object.fromEntries(workflows.map((w, i) => [w, ((wf[i] as J).workflow_runs ?? []).map(toRun)])),
    fetchedAt: new Date().toISOString(),
  };
}
