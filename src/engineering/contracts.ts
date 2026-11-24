import { engineeringRepo, isProtectedPath, type EngineeringRepo } from "./repos";
import { cleanRunnerPhases } from "./lifecycle";
import { BRANCH_PREFIX, CATEGORY_LABEL, ENGINEERING_LIMITS, type EngineeringPhase, type FailureCategory, type QaReport, type ValidationClaim } from "./types";

// The engineering contracts on top of the Executive's dispatch/result envelope
// (src/executive/control/contracts.ts). Public on purpose: no secret here.
//
//   ATLAS_ENGINEERING_DISPATCH  route "engineering-repair": Atlas -> n8n "Atlas · Engineering
//                               Dispatch" -> GitHub workflow_dispatch of the repository's runner.
//   engineering-change/1        the runner's report job -> POST /api/hooks/engineering-result
//                               (key ATLAS_ENGINEERING_CALLBACK_TOKEN), inside ATLAS_WORKFLOW_RESULT.
//   ATLAS_QA_VALIDATION         route "qa-validation": runs inside Atlas (no n8n, no model). Reads the
//                               runner's real results from GitHub and writes qa-report/1.
//   ATLAS_GITHUB_PR_DELIVERY    route "pr-delivery": Atlas -> n8n "Atlas · GitHub PR Delivery",
//                               which opens the pull request and posts pr-delivery/1 back to
//                               /api/hooks/executive-result. It has no merge step.

export interface ChangeArtifact {
  schema: "engineering-change/1";
  outcome: "changed" | "no_change" | "out_of_bounds" | "failed";
  repo: string;
  baseSha: string;
  headSha: string | null;
  branch: string | null;
  runId: number;
  runUrl: string | null;
  filesChanged: { path: string; additions: number; deletions: number }[];
  validation: ValidationClaim[];
  phases: { phase: EngineeringPhase; at: string }[];
  usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number; turns: number } | null;
  /** Claude's own short account of the fix: a hypothesis, stored and shown as such. */
  plan: string | null;
  error: string | null;
}

export interface DeliveryArtifact {
  schema: "pr-delivery/1";
  repo: string;
  prUrl: string;
  prNumber: number;
  branch: string;
  headSha: string;
}

const SHA = /^[0-9a-f]{40}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
const int = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export const branchFor = (taskId: string, attempt: number) => `${BRANCH_PREFIX}${taskId.slice(0, 8)}-a${attempt}`;
export const BRANCH_RE = /^atlas-eng\/[0-9a-f]{8}-a[0-9]{1,2}$/;

/** Strict parse of the runner's untrusted report. Unknown fields are dropped. */
export function parseChange(raw: unknown): { ok: true; value: ChangeArtifact } | { ok: false; error: string } {
  if (!isObj(raw) || raw.schema !== "engineering-change/1") return { ok: false, error: "Not an engineering-change/1 report." };
  const outcome = raw.outcome;
  if (outcome !== "changed" && outcome !== "no_change" && outcome !== "out_of_bounds" && outcome !== "failed") return { ok: false, error: "Unknown outcome." };
  const repo = str(raw.repo, 140)?.toLowerCase() ?? "";
  const baseSha = str(raw.baseSha, 40) ?? "";
  if (!repo || !SHA.test(baseSha)) return { ok: false, error: "Missing repo or base commit." };
  const headSha = raw.headSha === null || raw.headSha === undefined ? null : str(raw.headSha, 40);
  if (headSha !== null && !SHA.test(headSha)) return { ok: false, error: "Bad head commit." };
  const branch = raw.branch === null || raw.branch === undefined ? null : str(raw.branch, 80);
  if (branch !== null && !BRANCH_RE.test(branch)) return { ok: false, error: "The branch isn't an atlas-eng/ branch." };
  const runId = Number(raw.runId);
  if (!Number.isSafeInteger(runId) || runId <= 0) return { ok: false, error: "Bad runner run id." };
  const runUrl = str(raw.runUrl, 300);
  const files = Array.isArray(raw.filesChanged) ? raw.filesChanged.slice(0, 200) : [];
  const filesChanged = files.flatMap((f) => {
    if (!isObj(f)) return [];
    const path = str(f.path, 300);
    if (!path || path.includes("..")) return [];
    return [{ path, additions: int(f.additions, 1_000_000) ?? 0, deletions: int(f.deletions, 1_000_000) ?? 0 }];
  });
  const validation = (Array.isArray(raw.validation) ? raw.validation.slice(0, 10) : []).flatMap((v) =>
    isObj(v) && str(v.name, 80) && str(v.command, 200) ? [{ name: v.name as string, command: v.command as string, passed: v.passed === true }] : [],
  );
  let usage: ChangeArtifact["usage"] = null;
  if (isObj(raw.usage)) {
    const u = raw.usage;
    const model = str(u.model, 80);
    const cost = typeof u.costUsd === "number" && Number.isFinite(u.costUsd) && u.costUsd >= 0 && u.costUsd < 100 ? u.costUsd : null;
    if (model && cost !== null) usage = { model, inputTokens: int(u.inputTokens, 50_000_000) ?? 0, outputTokens: int(u.outputTokens, 5_000_000) ?? 0, costUsd: Math.round(cost * 10_000) / 10_000, turns: int(u.turns, 500) ?? 0 };
  }
  const clean = (v: unknown, n: number) => {
    const t = str(v, 20_000);
    return t ? t.replace(CONTROL, "").slice(0, n) : null;
  };
  return {
    ok: true,
    value: {
      schema: "engineering-change/1",
      outcome,
      repo,
      baseSha,
      headSha,
      branch,
      runId,
      runUrl: runUrl && runUrl.startsWith(`https://github.com/${repo}/actions/runs/`) ? runUrl : null,
      filesChanged,
      validation,
      phases: cleanRunnerPhases(raw.phases),
      usage,
      plan: clean(raw.plan, 1500),
      error: clean(raw.error, 1000),
    },
  };
}

export interface ChangeExpectation {
  repo: string;
  baseSha: string;
  taskId: string;
  attempt: number;
}

/**
 * The Engineering task's own acceptance: is this a well-formed, in-bounds change for the task Atlas
 * sent? This is not QA. It only decides whether there is something for QA to look at.
 */
export function verifyChange(c: ChangeArtifact, e: ChangeExpectation, at: string) {
  const checks: { name: string; passed: boolean; detail?: string }[] = [];
  const repo = engineeringRepo(c.repo);
  checks.push({ name: "Repository is the one Atlas sent", passed: !!repo && c.repo === e.repo.toLowerCase(), detail: c.repo });
  checks.push({ name: "Base commit is the failing commit", passed: c.baseSha === e.baseSha });
  checks.push({ name: "A change was produced", passed: c.outcome === "changed", detail: c.outcome === "changed" ? undefined : (c.error ?? c.outcome) });
  if (c.outcome === "changed") {
    checks.push({ name: "Branch is this task's atlas-eng/ branch", passed: c.branch === branchFor(e.taskId, e.attempt), detail: c.branch ?? "none" });
    checks.push({ name: "A commit was pushed", passed: !!c.headSha && c.headSha !== c.baseSha });
    const lines = c.filesChanged.reduce((n, f) => n + f.additions + f.deletions, 0);
    checks.push({ name: "Within the size limit", passed: c.filesChanged.length > 0 && c.filesChanged.length <= ENGINEERING_LIMITS.maxFilesChanged && lines <= ENGINEERING_LIMITS.maxLinesChanged, detail: `${c.filesChanged.length} files, ${lines} lines` });
    const prot = c.filesChanged.map((f) => f.path).filter(isProtectedPath);
    checks.push({ name: "No protected file in the change", passed: !prot.length, detail: prot.join(", ") || undefined });
  }
  return { passed: checks.every((x) => x.passed), checkedAt: at, checks };
}

export function parseDelivery(raw: unknown): { ok: true; value: DeliveryArtifact } | { ok: false; error: string } {
  if (!isObj(raw) || raw.schema !== "pr-delivery/1") return { ok: false, error: "Not a pr-delivery/1 report." };
  const repo = str(raw.repo, 140)?.toLowerCase() ?? "";
  const prNumber = int(raw.prNumber, 10_000_000);
  const prUrl = str(raw.prUrl, 300);
  const branch = str(raw.branch, 80);
  const headSha = str(raw.headSha, 40);
  if (!engineeringRepo(repo)) return { ok: false, error: "The repository isn't on the allowlist." };
  if (!prNumber || !prUrl || prUrl !== `https://github.com/${repo}/pull/${prNumber}`) return { ok: false, error: "The pull request link doesn't match the repository and number." };
  if (!branch || !BRANCH_RE.test(branch) || !headSha || !SHA.test(headSha)) return { ok: false, error: "Bad branch or head commit." };
  return { ok: true, value: { schema: "pr-delivery/1", repo, prUrl, prNumber, branch, headSha } };
}

/** The pull request Atlas asks n8n to open, written from verified facts (QA's GitHub evidence). */
export function pullRequestText(o: { repo: EngineeringRepo; category: FailureCategory; workflowName: string; failedRunUrl: string | null; baseSha: string; branch: string; qa: QaReport; runUrl: string | null; plan: string | null; goalId: string; taskRecordId: string | null; today: string }): { title: string; body: string } {
  const what = CATEGORY_LABEL[o.category].toLowerCase();
  const title = `Fix failing ${what} on ${o.repo.defaultBranch} (${o.baseSha.slice(0, 7)})`;
  const passed = o.qa.checks.filter((c) => c.source === "github" && c.passed).map((c) => `- [x] ${c.name}`);
  const body = [
    "## What changes for Khaneil",
    `The ${o.workflowName} ${what} check that failed on ${o.repo.defaultBranch} at ${o.baseSha.slice(0, 7)} passes again on this branch. Opened by Atlas Engineering; Atlas QA checked it independently.`,
    "",
    "## Changelog line",
    `- ${o.today} · Fixed the failing ${what} check on ${o.repo.defaultBranch}`,
    "",
    "## Risk",
    o.qa.outcome === "PASS"
      ? "Low. QA passed; no protected, dependency or security-relevant file changed."
      : `Needs a careful look. QA outcome ${o.qa.outcome}${o.qa.dependencyChanges.length ? `; dependency files changed: ${o.qa.dependencyChanges.join(", ")}` : ""}${o.qa.securityRelevant.length ? `; security-relevant files: ${o.qa.securityRelevant.join(", ")}` : ""}. Khaneil approved opening this pull request.`,
    "",
    "## Checks",
    "Run by the Atlas runner in a clean GitHub Actions job with no secrets, read back from GitHub by Atlas QA:",
    ...passed,
    "",
    "## Evidence",
    `- Failed run: ${o.failedRunUrl ?? "not linked"}`,
    `- Runner run (logs): ${o.runUrl ?? "not linked"}`,
    `- Atlas goal: ${o.goalId}${o.taskRecordId ? `, Task Center task ${o.taskRecordId}` : ""}`,
    ...(o.plan ? ["", "Engineering's own account of the fix (model-written, not verified):", "", `> ${o.plan.replace(/\n+/g, " ").slice(0, 600)}`] : []),
    "",
    "## Rollback",
    "Revert this pull request.",
    "",
    "Atlas never merges: Khaneil reviews and merges.",
  ].join("\n");
  return { title: title.slice(0, 200), body: body.slice(0, 1990) };
}

/**
 * The runner's one `task` input, built from Atlas's dispatch envelope. n8n's "Atlas · Engineering
 * Dispatch" does exactly this mapping (ops/n8n/atlas-engineering-dispatch.sdk.js) and the runner's guard
 * (ops/atlas-engineer/runner.mjs parseTask) checks every field again; a test keeps the three in step.
 */
export interface RunnerTask {
  taskId: string;
  attempt: number;
  correlationId: string;
  idempotencyKey: string;
  nonce: string;
  repo: string;
  baseSha: string;
  failedRunId: string;
  category: string;
  model: string;
  branch: string;
  maxTurns: number;
  feedback: string;
  previousBranch: string;
}

export function runnerTaskFrom(e: { taskId: string; attempt: number; correlationId: string; idempotencyKey: string; nonce: string; inputs: Record<string, string> }): RunnerTask {
  const i = e.inputs;
  return {
    taskId: e.taskId,
    attempt: e.attempt,
    correlationId: e.correlationId,
    idempotencyKey: e.idempotencyKey,
    nonce: e.nonce,
    repo: i.repo ?? "",
    baseSha: i.base_sha ?? "",
    failedRunId: i.failed_run_id ?? "",
    category: i.category ?? "",
    model: i.model ?? "",
    branch: i.branch ?? "",
    maxTurns: Number(i.max_turns ?? ENGINEERING_LIMITS.maxTurns),
    feedback: (i.feedback ?? "").slice(0, 1500),
    previousBranch: i.previous_branch ?? "",
  };
}
