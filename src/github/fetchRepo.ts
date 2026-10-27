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

export interface SyncPlan {
  /** Commits and languages: these only change when something is pushed. */
  details: boolean;
  /** Workflow runs: these also change from schedules, manual runs and runs finishing. */
  runs: boolean;
}

export interface SyncOptions {
  /** Refetch everything regardless of what changed. */
  full?: boolean;
  /** Check runs for an unchanged repository at most this often. 0 checks every time. */
  runsEveryMs: number;
  now?: number;
}

const unfinished = (runs: WorkflowRun[]) => runs.some((r) => r.status !== "completed");

/** Decides which parts of a repository need asking GitHub again, given its listing metadata. */
export function syncPlan(prev: RepoSnapshot | undefined, meta: J, opts: SyncOptions): SyncPlan {
  const now = opts.now ?? Date.now();
  if (!prev) return { details: true, runs: true };
  const details = !!opts.full || prev.pushedAt !== meta.pushed_at || prev.defaultBranch !== meta.default_branch;
  const runs =
    details ||
    unfinished(prev.runs) ||
    Object.values(prev.workflowRuns).some(unfinished) ||
    now - Date.parse(prev.runsCheckedAt ?? prev.fetchedAt) >= opts.runsEveryMs;
  return { details, runs };
}

const workflowPath = (w: string) => (r: J) => r.path === `.github/workflows/${w}` || String(r.path ?? "").endsWith(`/${w}`);

/**
 * One repository-wide run list covers both the default branch's CI and the workflows agents
 * observe. Dedicated requests are made only for what that list doesn't show.
 */
async function fetchRuns(base: string, branch: string, workflows: string[]) {
  const PAGE = 30;
  const all = ((await optional(githubGet(`${base}/actions/runs?per_page=${PAGE}`) as Promise<J>, { workflow_runs: [] })).workflow_runs ?? []) as J[];
  let onBranch = all.filter((r) => r.head_branch === branch);
  if (!onBranch.length && all.length === PAGE) {
    onBranch = ((await optional(githubGet(`${base}/actions/runs?per_page=10&branch=${encodeURIComponent(branch)}`) as Promise<J>, { workflow_runs: [] })).workflow_runs ?? []) as J[];
  }
  const observed = await Promise.all(
    workflows.map(async (w) => {
      const seen = all.filter(workflowPath(w));
      if (seen.length) return seen;
      const res = await optional(githubGet(`${base}/actions/workflows/${encodeURIComponent(w)}/runs?per_page=5`) as Promise<J>, { workflow_runs: [] });
      return (res.workflow_runs ?? []) as J[];
    }),
  );
  return {
    runs: onBranch.slice(0, 10).map(toRun),
    workflowRuns: Object.fromEntries(workflows.map((w, i) => [w, observed[i].slice(0, 5).map(toRun)])),
  };
}

function license(repo: J): string | null {
  const l = repo.license;
  return l?.spdx_id && l.spdx_id !== "NOASSERTION" ? l.spdx_id : l?.name ?? null;
}

/**
 * Builds a repository snapshot, reusing the previous one for anything that can't have
 * changed. `meta` is the repository object from a repository list when discovery already
 * returned it; otherwise it is fetched here.
 */
export async function fetchRepo(
  fullName: string,
  workflows: string[],
  { meta, prev, ...opts }: SyncOptions & { meta?: J; prev?: RepoSnapshot } = { runsEveryMs: 0 },
): Promise<RepoSnapshot> {
  const base = `/repos/${fullName}`;
  const repo = meta ?? ((await githubGet(base)) as J);
  const branch = repo.default_branch;
  const plan = syncPlan(prev, repo, opts);
  const missingWorkflow = prev && workflows.some((w) => !(w in prev.workflowRuns));

  const [languages, commits, runs] = await Promise.all([
    plan.details || !prev ? optional(githubGet(`${base}/languages`) as Promise<Record<string, number>>, {}) : prev.languages,
    plan.details || !prev
      ? optional(githubGet(`${base}/commits?per_page=10&sha=${encodeURIComponent(branch)}`) as Promise<J[]>, []).then((cs) =>
          cs.map(
            (c): Commit => ({
              sha: c.sha,
              message: String(c.commit?.message ?? "").split("\n")[0],
              author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
              date: c.commit?.author?.date ?? c.commit?.committer?.date,
              url: c.html_url,
            }),
          ),
        )
      : prev.commits,
    plan.runs || missingWorkflow || !prev ? fetchRuns(base, branch, workflows) : null,
  ]);

  const now = new Date(opts.now ?? Date.now()).toISOString();
  return {
    fullName: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    homepage: repo.homepage || null,
    language: repo.language,
    languages,
    visibility: repo.visibility ?? (repo.private ? "private" : "public"),
    defaultBranch: branch,
    pushedAt: repo.pushed_at,
    stars: repo.stargazers_count ?? 0,
    openIssues: repo.open_issues_count ?? 0,
    license: license(repo),
    archived: !!repo.archived,
    commits,
    runs: runs ? runs.runs : prev!.runs,
    workflowRuns: runs ? runs.workflowRuns : prev!.workflowRuns,
    fetchedAt: now,
    runsCheckedAt: runs ? now : prev!.runsCheckedAt ?? prev!.fetchedAt,
  };
}
