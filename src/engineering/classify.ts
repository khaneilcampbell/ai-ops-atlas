import { engineeringRepo, type EngineeringRepo } from "./repos";
import { ENGINEERING_LIMITS, SUPPORTED_CATEGORIES, type FailedJob, type FailureCategory, type SupportedCategory } from "./types";

// ATLAS_GITHUB_MONITOR, the deterministic part: turns a GitHub Actions run into an incident and
// decides what Atlas may do about it. No model is called. Webhook payloads and job lists are
// untrusted data: only the fields read here are used, each checked for type and size.

export interface RunFacts {
  repo: string;
  runId: number;
  runAttempt: number;
  workflowName: string;
  workflowPath: string | null;
  event: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  branch: string;
  url: string | null;
  createdAt: string;
}

export interface JobFacts {
  name: string;
  conclusion: string | null;
  url: string | null;
  steps: { name: string; conclusion: string | null }[];
}

const SHA = /^[0-9a-f]{40}$/;
const s = (v: unknown, max = 200) => (typeof v === "string" && v.length <= max ? v : "");

/** The fields Atlas uses from a workflow_run payload (webhook or REST). Null when anything is off. */
export function runFacts(repo: unknown, run: unknown): RunFacts | null {
  if (!run || typeof run !== "object") return null;
  const r = run as Record<string, unknown>;
  const facts: RunFacts = {
    repo: s(repo).toLowerCase(),
    runId: Number(r.id),
    runAttempt: Number(r.run_attempt ?? 1),
    workflowName: s(r.name, 120),
    workflowPath: s(r.path, 200) || null,
    event: s(r.event, 40),
    status: s(r.status, 40),
    conclusion: s(r.conclusion, 40) || null,
    headSha: s(r.head_sha, 40).toLowerCase(),
    branch: s(r.head_branch, 200),
    url: s(r.html_url, 300).startsWith("https://github.com/") ? s(r.html_url, 300) : null,
    createdAt: s(r.created_at, 40),
  };
  if (!facts.repo || !Number.isSafeInteger(facts.runId) || facts.runId <= 0 || !SHA.test(facts.headSha) || !facts.workflowName || !facts.branch) return null;
  if (!Number.isSafeInteger(facts.runAttempt) || facts.runAttempt < 1) facts.runAttempt = 1;
  return facts;
}

export function jobFacts(raw: unknown): JobFacts[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { jobs?: unknown }).jobs) ? (raw as { jobs: unknown[] }).jobs : [];
  return list.slice(0, 50).flatMap((j) => {
    if (!j || typeof j !== "object") return [];
    const o = j as Record<string, unknown>;
    const steps = Array.isArray(o.steps) ? o.steps.slice(0, 60) : [];
    return [
      {
        name: s(o.name, 200),
        conclusion: s(o.conclusion, 40) || null,
        url: s(o.html_url, 300).startsWith("https://github.com/") ? s(o.html_url, 300) : null,
        steps: steps.flatMap((x) => (x && typeof x === "object" ? [{ name: s((x as Record<string, unknown>).name, 200), conclusion: s((x as Record<string, unknown>).conclusion, 40) || null }] : [])),
      },
    ];
  });
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

/** Category of one failed step, from its name. Unknown names are not guessed at. */
export function stepCategory(jobName: string, stepName: string): FailureCategory {
  const t = `${stepName}`.toLowerCase();
  const j = jobName.toLowerCase();
  if (/sign|notar|publish|release|updater/.test(t) || /sign|publish|release/.test(j)) return "release";
  if (/audit|codeql|secret scan|security/.test(t) || /audit|codeql|security/.test(j)) return "security";
  if (/cargo|rust|tauri/.test(t) || /rust|desktop shell|macos/.test(j)) return "rust";
  if (/visual|playwright|screenshot|baseline/.test(t) || /visual|screenshot/.test(j)) return "visual";
  if (/set up job|checkout|setup-node|setup node|npm ci|install|cache|post /.test(t)) return "infrastructure";
  if (/\blint\b|eslint/.test(t)) return "lint";
  if (/typecheck|tsc\b|type check/.test(t)) return "typecheck";
  if (/npm test|vitest|unit test|\btest\b/.test(t)) return "test";
  if (/build/.test(t)) return "build";
  return "unknown";
}

export interface Classification {
  category: FailureCategory;
  supported: boolean;
  failedJobs: FailedJob[];
  reason: string;
}

/** Which failure this is, and whether it's one Atlas may try to repair (bounded and reproducible). */
export function classify(repo: EngineeringRepo, jobs: readonly JobFacts[]): Classification {
  const failed = jobs.filter((j) => j.conclusion && FAILED.has(j.conclusion));
  const failedJobs: FailedJob[] = failed.map((j) => ({ name: j.name, url: j.url, steps: j.steps.filter((x) => x.conclusion && FAILED.has(x.conclusion)).map((x) => x.name) }));
  if (!failed.length) return { category: "unknown", supported: false, failedJobs, reason: "GitHub lists no failed job for this run (cancelled or still settling)." };
  const cats = new Set<FailureCategory>();
  for (const j of failedJobs) {
    if (!j.steps.length) cats.add(stepCategory(j.name, j.name));
    for (const st of j.steps) cats.add(stepCategory(j.name, st));
  }
  const list = [...cats];
  const category: FailureCategory = list.length === 1 ? list[0] : list.find((c) => !SUPPORTED_CATEGORIES.includes(c as SupportedCategory)) ?? list[0];
  if (failedJobs.some((j) => !repo.supportedJobs.includes(j.name))) return { category, supported: false, failedJobs, reason: `A failed job (${failedJobs.map((j) => j.name).join(", ")}) is outside the jobs Atlas repairs on its own.` };
  if (list.length > 1) return { category, supported: false, failedJobs, reason: `More than one kind of check failed (${list.join(", ")}); Khaneil looks at it rather than Atlas guessing.` };
  if (!SUPPORTED_CATEGORIES.includes(category as SupportedCategory)) return { category, supported: false, failedJobs, reason: `${category} failures aren't repaired automatically.` };
  return { category, supported: true, failedJobs, reason: `A ${category} failure in a job Atlas can reproduce in a clean runner.` };
}

export type IntakeDecision =
  | { kind: "ignore"; reason: string }
  | { kind: "escalate"; reason: string }
  | { kind: "repair"; autonomy: 2 | 3; reason: string };

export interface IntakeContext {
  /** ATLAS_ENGINEERING_ENABLED on the site. */
  enabled: boolean;
  /** Open engineering jobs on this repository now. */
  openOnRepo: number;
  /** Automatic jobs started in the last 24 hours. */
  autoToday: number;
  /** A later run of the same workflow on the same branch already passed. */
  laterRunPassed: boolean;
  /** The emergency stop's reason, or null. */
  stopped: string | null;
  now: number;
}

/** Executive's intake rule: what to do with a failed run. Same inputs, same answer. */
export function decideIntake(facts: RunFacts, cls: Classification | null, ctx: IntakeContext): IntakeDecision {
  const repo = engineeringRepo(facts.repo);
  if (!repo) return { kind: "ignore", reason: `${facts.repo} isn't on the engineering allowlist.` };
  if (facts.status !== "completed" || !facts.conclusion || !FAILED.has(facts.conclusion)) return { kind: "ignore", reason: "The run didn't fail." };
  if (!repo.watchedWorkflows.includes(facts.workflowName)) return { kind: "ignore", reason: `${facts.workflowName} isn't a watched workflow.` };
  if (facts.branch !== repo.defaultBranch || (facts.event !== "push" && facts.event !== "workflow_dispatch" && facts.event !== "schedule"))
    return { kind: "ignore", reason: "Only failures on the default branch are picked up; pull request branches belong to their authors." };
  const age = ctx.now - Date.parse(facts.createdAt);
  if (Number.isFinite(age) && age > ENGINEERING_LIMITS.reconcileWindowHours * 3_600_000) return { kind: "ignore", reason: "The failure is older than the pickup window." };
  if (ctx.laterRunPassed) return { kind: "ignore", reason: "A later run of the same workflow already passed." };
  if (!cls) return { kind: "escalate", reason: "Atlas couldn't read the run's jobs from GitHub, so it can't tell what failed." };
  if (!cls.supported) return { kind: "escalate", reason: cls.reason };
  if (ctx.openOnRepo >= ENGINEERING_LIMITS.openJobsPerRepo) return { kind: "escalate", reason: "An engineering job is already open on this repository; two at once could write over each other." };
  if (!ctx.enabled) return { kind: "escalate", reason: "Automatic repair isn't switched on (ATLAS_ENGINEERING_ENABLED)." };
  if (ctx.stopped) return { kind: "escalate", reason: `The emergency stop is on: ${ctx.stopped}` };
  if (ctx.autoToday >= ENGINEERING_LIMITS.dailyAutoJobs) return { kind: "repair", autonomy: 2, reason: `The daily limit of ${ENGINEERING_LIMITS.dailyAutoJobs} automatic repairs is reached, so this one waits for Khaneil's approval.` };
  return repo.autoRepair ? { kind: "repair", autonomy: 3, reason: cls.reason } : { kind: "repair", autonomy: 2, reason: `${cls.reason} This repository needs Khaneil's approval for each repair.` };
}

export const incidentKey = (f: Pick<RunFacts, "repo" | "workflowName" | "headSha">) => `ci:${f.repo.replace(/\//g, ".")}:${f.workflowName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}:${f.headSha}`.slice(0, 160);
