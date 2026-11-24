// The Engineering Division's GitHub reads: GET only, allowlisted repositories only (src/engineering/
// repos.ts), a handful of paths, a time limit and a size cap. The token is the site's read-only
// GITHUB_TOKEN; it never reaches the page, a prompt or n8n. Everything GitHub returns is untrusted
// data and is parsed field by field by the caller (classify.ts, qa.ts).

import { jobFacts, runFacts, type JobFacts, type RunFacts } from "../../src/engineering/classify";
import { engineeringRepo } from "../../src/engineering/repos";
import type { QaEvidence } from "../../src/engineering/qa";

export interface GithubReadEnv {
  GITHUB_TOKEN?: string;
}

export interface GithubReader {
  configured: boolean;
  run(repo: string, runId: number): Promise<RunFacts | null>;
  jobs(repo: string, runId: number): Promise<JobFacts[]>;
  /** Recent runs on a branch, newest first (completed only). */
  recentRuns(repo: string, branch: string, status?: "failure" | "success"): Promise<RunFacts[]>;
  compare(repo: string, base: string, head: string): Promise<QaEvidence["compare"]>;
  /** Dispatched runs of a workflow file on one branch, newest first (any status). */
  dispatchedRuns(repo: string, workflowFile: string, branch: string): Promise<RunFacts[]>;
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;

export class GithubReadError extends Error {}

export function githubReader(env: GithubReadEnv, fetcher: typeof fetch = fetch): GithubReader {
  const get = async (repo: string, path: string): Promise<unknown> => {
    const r = engineeringRepo(repo);
    if (!r) throw new GithubReadError(`${repo} isn't on the engineering allowlist.`);
    if (path.includes("..")) throw new GithubReadError("Path not allowed.");
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "atlas-engineering" };
    if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN.trim()}`;
    let res: Response;
    try {
      res = await fetcher(`https://api.github.com/repos/${r.repo}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new GithubReadError(`GitHub didn't answer: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new GithubReadError(`GitHub answered ${res.status} for ${path.split("?")[0]}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new GithubReadError("GitHub's answer was too large.");
    try {
      return JSON.parse(text);
    } catch {
      throw new GithubReadError("GitHub's answer wasn't JSON.");
    }
  };
  return {
    configured: !!env.GITHUB_TOKEN,
    async run(repo, runId) {
      if (!Number.isSafeInteger(runId) || runId <= 0) throw new GithubReadError("Bad run id.");
      return runFacts(repo, await get(repo, `/actions/runs/${runId}`));
    },
    async jobs(repo, runId) {
      if (!Number.isSafeInteger(runId) || runId <= 0) throw new GithubReadError("Bad run id.");
      return jobFacts(await get(repo, `/actions/runs/${runId}/jobs?per_page=50`));
    },
    async recentRuns(repo, branch, status) {
      if (!BRANCH.test(branch)) throw new GithubReadError("Bad branch.");
      const q = `?branch=${encodeURIComponent(branch)}&per_page=20${status ? `&status=${status}` : "&status=completed"}`;
      const body = (await get(repo, `/actions/runs${q}`)) as { workflow_runs?: unknown[] };
      return (Array.isArray(body?.workflow_runs) ? body.workflow_runs : []).map((w) => runFacts(repo, w)).filter((x): x is RunFacts => !!x);
    },
    async dispatchedRuns(repo, workflowFile, branch) {
      if (!/^[a-z0-9_.-]+\.ya?ml$/i.test(workflowFile) || !/^atlas-eng\/[0-9a-f]{8}-a[0-9]{1,2}$/.test(branch)) throw new GithubReadError("Bad workflow or branch.");
      const q = `?branch=${encodeURIComponent(branch)}&event=workflow_dispatch&per_page=10`;
      const body = (await get(repo, `/actions/workflows/${workflowFile}/runs${q}`)) as { workflow_runs?: unknown[] };
      return (Array.isArray(body?.workflow_runs) ? body.workflow_runs : []).map((w) => runFacts(repo, w)).filter((x): x is RunFacts => !!x);
    },
    async compare(repo, base, head) {
      if (!SHA.test(base) || !(SHA.test(head) || /^atlas-eng\/[0-9a-f]{8}-a[0-9]{1,2}$/.test(head))) throw new GithubReadError("Bad compare range.");
      const c = (await get(repo, `/compare/${base}...${encodeURIComponent(head).replace(/%2F/g, "/")}`)) as Record<string, unknown>;
      const files = Array.isArray(c.files) ? c.files.slice(0, 300) : [];
      const commits = Array.isArray(c.commits) ? c.commits : [];
      const last = commits[commits.length - 1] as { sha?: unknown } | undefined;
      const mb = (c.merge_base_commit as { sha?: unknown } | undefined)?.sha;
      return {
        mergeBaseSha: typeof mb === "string" && SHA.test(mb) ? mb : null,
        status: typeof c.status === "string" ? c.status : "unknown",
        aheadBy: Number(c.ahead_by) || 0,
        behindBy: Number(c.behind_by) || 0,
        headSha: typeof last?.sha === "string" && SHA.test(last.sha) ? last.sha : null,
        files: files.flatMap((f) => {
          if (!f || typeof f !== "object") return [];
          const o = f as Record<string, unknown>;
          if (typeof o.filename !== "string" || o.filename.length > 300) return [];
          return [{ filename: o.filename, status: typeof o.status === "string" ? o.status : "modified", additions: Number(o.additions) || 0, deletions: Number(o.deletions) || 0, patch: typeof o.patch === "string" ? o.patch.slice(0, 100_000) : null }];
        }),
      };
    },
  };
}
