import { githubGet } from "./transport";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** An open pull request, as GitHub's list endpoint reports it. */
export interface PullSummary {
  number: number;
  title: string;
  author: string | null;
  draft: boolean;
  head: string;
  headSha: string;
  base: string;
  url: string;
  updatedAt: string;
}

export function toPull(p: J): PullSummary {
  return {
    number: p.number,
    title: p.title ?? `#${p.number}`,
    author: p.user?.login ?? null,
    draft: !!p.draft,
    head: p.head?.ref ?? "",
    headSha: p.head?.sha ?? "",
    base: p.base?.ref ?? "",
    url: p.html_url,
    updatedAt: p.updated_at,
  };
}

/** The repository's open pull requests, most recently updated first. Read-only. */
export async function fetchOpenPulls(repo: string): Promise<PullSummary[]> {
  const body = await githubGet(`/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=20`);
  return Array.isArray(body) ? body.map(toPull) : [];
}
