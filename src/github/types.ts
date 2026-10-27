export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface WorkflowRun {
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  event: string;
  createdAt: string;
  url: string;
}

export interface RepoSnapshot {
  fullName: string;
  description: string | null;
  url: string;
  homepage: string | null;
  language: string | null;
  languages: Record<string, number>;
  visibility: string;
  defaultBranch: string;
  pushedAt: string | null;
  stars: number;
  openIssues: number;
  license: string | null;
  archived: boolean;
  commits: Commit[];
  runs: WorkflowRun[];
  /** Latest runs per workflow file the catalog asked to observe. */
  workflowRuns: Record<string, WorkflowRun[]>;
  fetchedAt: string;
  /** When workflow runs were last asked for; older snapshots only have fetchedAt. */
  runsCheckedAt?: string;
}

export type RepoState =
  | { kind: "loading" }
  | { kind: "ok"; data: RepoSnapshot; stale: boolean }
  | { kind: "error"; message: string; data?: RepoSnapshot };
