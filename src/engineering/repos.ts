// The repositories the Engineering Division may touch, and how. This file is the allowlist: a
// repository that isn't here is never read for engineering, never gets a task and never gets a
// branch, whatever a webhook or a result says. Changing it takes a reviewed pull request, so an
// agent can't widen its own access (the runner refuses to edit this file too: see PROTECTED_PATHS).
//
// Each repository also needs the runner workflow (.github/workflows/atlas-engineer.yml) on its
// default branch; until then it stays monitor-only.

export interface ApprovedCheck {
  /** The step name in the runner's validate job (QA reads the step's real result from GitHub). */
  name: string;
  command: string;
}

export interface EngineeringRepo {
  /** owner/name, lower case. */
  repo: string;
  defaultBranch: string;
  /** GitHub Actions workflows whose failures on the default branch become incidents. */
  watchedWorkflows: readonly string[];
  /** The job inside those workflows Atlas understands (others are escalated, not guessed at). */
  supportedJobs: readonly string[];
  /** The runner workflow file in this repository. */
  runnerWorkflow: string;
  /**
   * The workflow that runs the approved checks on the pushed atlas-eng branch. Started by the runner
   * with the branch as its ref, so it runs (and caches) in that branch's context, never main's.
   */
  validateWorkflow: string;
  /** Repairs start without asking (true), or each one waits for Khaneil's approval (false). */
  autoRepair: boolean;
  /** The only commands the runner may run, in order. */
  checks: readonly ApprovedCheck[];
}

export const ENGINEERING_REPOS: readonly EngineeringRepo[] = [
  {
    repo: "khaneilcampbell/ai-ops-atlas",
    defaultBranch: "main",
    watchedWorkflows: ["CI"],
    supportedJobs: ["Frontend (types, tests, build)"],
    runnerWorkflow: "atlas-engineer.yml",
    validateWorkflow: "atlas-engineer-validate.yml",
    autoRepair: true,
    checks: [
      { name: "Lint", command: "npm run lint" },
      { name: "Typecheck", command: "npm run typecheck" },
      { name: "Unit tests", command: "npm test" },
    ],
  },
];

const NAME = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

export function engineeringRepo(repo: string | null | undefined): EngineeringRepo | null {
  const r = (repo ?? "").trim().toLowerCase();
  if (!NAME.test(r) || r.includes("..")) return null;
  return ENGINEERING_REPOS.find((x) => x.repo === r) ?? null;
}

/**
 * Paths no engineering change may touch. Matches CLAUDE.md's high-risk list (signing, release,
 * secrets, the updater, write actions) plus the division's own rules, so an agent can't loosen its
 * own policy. A change touching one fails the runner's bounds check; QA re-checks the real diff.
 */
export const PROTECTED_PATHS: readonly RegExp[] = [
  /^\.github\//,
  /^\.claude\//,
  /^scripts\/[^/]*signing[^/]*$/,
  /^src-tauri\/tauri\.conf\.json$/,
  /^src-tauri\/src\/secrets\.rs$/,
  /^src-tauri\/src\/handoff\.rs$/,
  /^src\/components\/UpdateButton\.tsx$/,
  /^src-tauri\/src\/actions\//,
  /^src\/actions\//,
  /^src\/engineering\//,
  /^server\/engineering\//,
  /^src\/executive\/control\/policy\.ts$/,
  /^src\/intelligence\/capabilities\.ts$/,
  /^db\//,
  /^catalog\//,
  /^ops\/atlas-engineer\//,
  /(^|\/)\.env(\.|$)/,
];

/** Dependency and lock files: allowed, but QA sends the change to Khaneil instead of passing it. */
export const DEPENDENCY_FILES: readonly RegExp[] = [/(^|\/)package(-lock)?\.json$/, /(^|\/)Cargo\.(toml|lock)$/, /(^|\/)requirements[^/]*\.txt$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)yarn\.lock$/];

export const isProtectedPath = (p: string) => PROTECTED_PATHS.some((r) => r.test(p));
export const isDependencyFile = (p: string) => DEPENDENCY_FILES.some((r) => r.test(p));
