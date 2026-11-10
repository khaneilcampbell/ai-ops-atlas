import { useEffect, useSyncExternalStore } from "react";
import { githubGet } from "../github/transport";

// How each repository's default branch is guarded, read from GitHub with the same read-only access
// the rest of Atlas uses. Rulesets come from "Get rules for a branch", which any reader can call.
// Classic branch protection details need admin access, so for those Atlas only knows that the
// branch is protected (the branch's `protected` flag) and says so. Nothing here changes a rule.

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface BranchRules {
  repo: string;
  branch: string;
  /** Rulesets apply to the branch. */
  rulesets: number;
  /** GitHub reports the branch as protected (classic protection or rulesets). */
  protected: boolean;
  /** null: no pull request rule. Otherwise the approvals it requires. */
  pullRequest: { approvals: number; codeOwners: boolean } | null;
  requiredChecks: string[];
  blocksForcePush: boolean;
  blocksDeletion: boolean;
  linearHistory: boolean;
  signedCommits: boolean;
}

export type Guard = "guarded" | "partial" | "classic" | "open";

/** One repository's branch rules from GitHub's two answers. */
export function toBranchRules(repo: string, branch: string, rules: unknown, branchInfo: unknown): BranchRules {
  const list: J[] = Array.isArray(rules) ? rules : [];
  const of = (type: string) => list.filter((r) => r?.type === type);
  const pr = of("pull_request");
  const checks = of("required_status_checks").flatMap((r) => (Array.isArray(r.parameters?.required_status_checks) ? r.parameters.required_status_checks : []).map((c: J) => String(c?.context ?? "")).filter(Boolean));
  return {
    repo,
    branch,
    rulesets: new Set(list.map((r) => r?.ruleset_id).filter((x) => x != null)).size,
    protected: (branchInfo as J | null)?.protected === true,
    pullRequest: pr.length
      ? { approvals: Math.max(0, ...pr.map((r) => Number(r.parameters?.required_approving_review_count ?? 0))), codeOwners: pr.some((r) => r.parameters?.require_code_owner_review === true) }
      : null,
    requiredChecks: [...new Set(checks)].sort(),
    blocksForcePush: of("non_fast_forward").length > 0,
    blocksDeletion: of("deletion").length > 0,
    linearHistory: of("required_linear_history").length > 0,
    signedCommits: of("required_signatures").length > 0,
  };
}

/**
 * guarded: changes go through a pull request, and force pushes and deletion are blocked.
 * partial: some rules apply, not all three. classic: protected by classic branch protection,
 * whose details Atlas can't read. open: nothing guards the branch.
 */
export function guardOf(r: BranchRules): Guard {
  if (r.pullRequest && r.blocksForcePush && r.blocksDeletion) return "guarded";
  if (r.rulesets > 0 || r.pullRequest || r.requiredChecks.length || r.blocksForcePush || r.blocksDeletion) return "partial";
  return r.protected ? "classic" : "open";
}

/** The rules as short plain phrases, most important first. */
export function ruleSummary(r: BranchRules): string[] {
  const out: string[] = [];
  if (r.pullRequest) out.push(r.pullRequest.approvals ? `${r.pullRequest.approvals} approval${r.pullRequest.approvals === 1 ? "" : "s"} to merge` : "Pull request to merge");
  if (r.requiredChecks.length) out.push(`${r.requiredChecks.length} required check${r.requiredChecks.length === 1 ? "" : "s"}`);
  if (r.blocksForcePush) out.push("No force push");
  if (r.blocksDeletion) out.push("Can't be deleted");
  if (r.linearHistory) out.push("Linear history");
  if (r.signedCommits) out.push("Signed commits");
  if (r.pullRequest?.codeOwners) out.push("Code owner review");
  return out;
}

export async function fetchBranchRules(repo: string, branch: string): Promise<BranchRules> {
  const b = encodeURIComponent(branch);
  const [rules, info] = await Promise.all([githubGet(`/repos/${repo}/rules/branches/${b}`), githubGet(`/repos/${repo}/branches/${b}`)]);
  return toBranchRules(repo, branch, rules, info);
}

// ── Shared store ─────────────────────────────────────────────────────────────

export type RepoRules = { state: "ready"; value: BranchRules; at: string } | { state: "error"; message: string } | { state: "loading" };

const EVERY_MS = 30 * 60_000;
let data: Record<string, RepoRules> = {};
const watchers = new Set<() => void>();
const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};
const set = (repo: string, v: RepoRules) => {
  data = { ...data, [repo]: v };
  watchers.forEach((w) => w());
};

async function refresh(repo: string, branch: string) {
  if (!data[repo]) set(repo, { state: "loading" });
  try {
    set(repo, { state: "ready", value: await fetchBranchRules(repo, branch), at: new Date().toISOString() });
  } catch (e) {
    set(repo, { state: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** Branch rules for these repositories' default branches; re-read every 30 minutes while on screen. */
export function useBranchRules(targets: readonly { repo: string; branch: string }[]): Record<string, RepoRules> {
  const key = targets.map((t) => `${t.repo}@${t.branch}`).join(",");
  useEffect(() => {
    const list = key ? key.split(",").map((k) => k.split("@") as [string, string]) : [];
    const run = () => list.forEach(([repo, branch]) => void refresh(repo, branch));
    run();
    const t = setInterval(() => visible() && run(), EVERY_MS);
    return () => clearInterval(t);
  }, [key]);
  return useSyncExternalStore(subscribe, () => data, () => data);
}
