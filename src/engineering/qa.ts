import { isDependencyFile, isProtectedPath, type EngineeringRepo } from "./repos";
import type { JobFacts } from "./classify";
import { ENGINEERING_LIMITS, type QaCheck, type QaOutcome, type QaReport } from "./types";
import type { ChangeArtifact } from "./contracts";

// Atlas Quality Assurance (atlas-qa): the independent check of an engineering change. It never takes
// the Engineering agent's word: the runner's own report is only used to know which run and branch to
// look at. The evidence is what GitHub itself says (the runner run's job and step results, and the
// real diff between the base commit and the pushed branch, and the checks run on that branch), read by the Atlas site with its own
// read-only token. No model is called; the same evidence always gives the same outcome.

export interface RunEvidence {
  id: number;
  path: string | null;
  event: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  htmlUrl: string | null;
  /** The ref the run ran on (head_branch). */
  branch?: string;
}

export interface QaEvidence {
  /** The runner run Engineering reported. */
  run: RunEvidence | null;
  /** The validate run on the pushed branch, for the reported commit (null when it hasn't started). */
  validation: RunEvidence | null;
  /** The validate run's jobs. */
  jobs: JobFacts[];
  compare: {
    mergeBaseSha: string | null;
    status: string;
    aheadBy: number;
    behindBy: number;
    headSha: string | null;
    files: { filename: string; status: string; additions: number; deletions: number; patch: string | null }[];
  } | null;
  /** Set when GitHub couldn't be read; QA is then BLOCKED (and retried), never passed. */
  error?: string;
}

/** Added lines that silence a check instead of fixing it. */
const SILENCERS: { re: RegExp; what: string }[] = [
  { re: /\b(it|test|describe)\.(skip|only|todo)\s*\(/, what: "skips or narrows tests" },
  { re: /\bx(it|describe|test)\s*\(/, what: "skips tests" },
  { re: /@ts-(ignore|nocheck|expect-error)/, what: "silences the type checker" },
  { re: /eslint-disable/, what: "silences the linter" },
  { re: /#\[allow\(|#!\[allow\(/, what: "silences a Rust lint" },
];

/** Words in a changed path or added line that make a change worth a human look. */
const SECURITY_WORDS = /\b(auth|token|secret|password|credential|crypto|signature|hmac|webhook|keychain|permission|cors|csp|access)\w*/i;

const TEST_FILE = /(^|\/)(__tests__\/|[^/]+\.(test|spec)\.[cm]?[jt]sx?$|test_[^/]+\.py$)/;

function addedLines(patch: string | null): string[] {
  if (!patch) return [];
  return patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

export function evaluateQa(repo: EngineeringRepo, claimed: ChangeArtifact, evidence: QaEvidence, at: string): QaReport {
  const checks: QaCheck[] = [];
  const feedback: string[] = [];
  const securityRelevant: string[] = [];
  const dependencyChanges: string[] = [];
  const add = (c: QaCheck) => checks.push(c);
  const report = (outcome: QaOutcome): QaReport => ({ schema: "qa-report/1", outcome, checkedAt: at, runId: String(claimed.runId), headSha: evidence.compare?.headSha ?? null, checks, feedback, securityRelevant, dependencyChanges });

  if (evidence.error || !evidence.run || !evidence.compare) {
    add({ name: "Evidence read from GitHub", passed: false, source: "github", detail: evidence.error ?? "The run or the diff couldn't be read." });
    return report("BLOCKED");
  }
  const { run, compare } = evidence;

  // 1. The run is the real runner workflow, started the way Atlas starts it.
  const expectedPath = `.github/workflows/${repo.runnerWorkflow}`;
  // (The run's own commit is the default branch tip when it was started; the base is checked on the diff below.)
  const genuine = run.path === expectedPath && run.event === "workflow_dispatch" && run.id === claimed.runId;
  add({ name: "The run is Atlas's runner workflow, started by dispatch", passed: genuine, source: "github", detail: genuine ? undefined : `path ${run.path ?? "?"}, event ${run.event}` });
  if (run.status !== "completed") {
    add({ name: "The runner finished", passed: false, source: "github", detail: `GitHub says the run is ${run.status}.` });
    return report("BLOCKED");
  }

  // 2. The checks ran in the validate workflow, on the pushed branch, for exactly the reported commit.
  const v = evidence.validation;
  if (!v) {
    add({ name: "The checks ran on the pushed branch", passed: false, source: "github", detail: "No validate run for this commit yet." });
    return report("BLOCKED");
  }
  const validPath = `.github/workflows/${repo.validateWorkflow}`;
  const validGenuine = v.path === validPath && v.event === "workflow_dispatch" && v.branch === claimed.branch && v.headSha === claimed.headSha;
  add({ name: "The checks ran on the pushed branch", passed: validGenuine, source: "github", detail: validGenuine ? undefined : `path ${v.path ?? "?"}, event ${v.event}, branch ${v.branch ?? "?"}, commit ${v.headSha.slice(0, 7)}` });
  if (!validGenuine) return report("BLOCKED");
  if (v.status !== "completed") {
    add({ name: "The checks finished", passed: false, source: "github", detail: `GitHub says the checks are ${v.status}.` });
    return report("BLOCKED");
  }

  // 3. Each approved check ran and passed, according to GitHub's own step results.
  const validate = evidence.jobs.find((j) => /^validate\b/i.test(j.name));
  if (!validate) {
    add({ name: "Validation job found", passed: false, source: "github", detail: "The validate run has no validate job." });
    feedback.push("The validation job didn't run, so nothing proves the fix works.");
  }
  for (const c of repo.checks) {
    const step = validate?.steps.find((x) => x.name === c.name);
    const ok = step?.conclusion === "success";
    add({ name: `${c.name} (${c.command})`, passed: ok, source: "github", detail: ok ? undefined : step ? `GitHub reports ${step.conclusion ?? "no result"}` : "This step didn't run" });
    if (!ok) feedback.push(`${c.name} (\`${c.command}\`) ${step ? `ended as ${step.conclusion ?? "unknown"}` : "didn't run"} in the clean runner${validate?.url ? `: ${validate.url}` : ""}.`);
    const said = claimed.validation.find((v) => v.name === c.name);
    if (said && said.passed !== ok) add({ name: `Engineering's report matches GitHub for ${c.name}`, passed: false, source: "github", detail: `reported ${said.passed ? "passed" : "failed"}, GitHub says ${step?.conclusion ?? "didn't run"}` });
  }

  // 4. The diff is the change Engineering reported, on the base Atlas asked for.
  const onBase = compare.mergeBaseSha === claimed.baseSha && compare.behindBy === 0;
  add({ name: "The branch starts from the failing commit", passed: onBase, source: "github", detail: onBase ? undefined : `merge base ${compare.mergeBaseSha?.slice(0, 7) ?? "?"}, ${compare.behindBy} behind` });
  const sameHead = !!compare.headSha && compare.headSha === claimed.headSha;
  add({ name: "The branch holds exactly the reported commit", passed: sameHead, source: "github", detail: sameHead ? undefined : `branch at ${compare.headSha?.slice(0, 7) ?? "?"}, reported ${claimed.headSha?.slice(0, 7) ?? "none"}` });
  if (!sameHead) feedback.push("The pushed branch doesn't match the change the runner reported.");

  const files = compare.files;
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const sized = files.length > 0 && files.length <= ENGINEERING_LIMITS.maxFilesChanged && lines <= ENGINEERING_LIMITS.maxLinesChanged;
  add({ name: `Change size within ${ENGINEERING_LIMITS.maxFilesChanged} files and ${ENGINEERING_LIMITS.maxLinesChanged} lines`, passed: sized, source: "rule", detail: `${files.length} files, ${lines} lines` });
  if (!sized) feedback.push(files.length ? `Keep the fix small: ${files.length} files and ${lines} changed lines is over the limit.` : "The branch has no change.");

  const protectedHits = files.map((f) => f.filename).filter(isProtectedPath);
  add({ name: "No protected file changed", passed: !protectedHits.length, source: "rule", detail: protectedHits.join(", ") || undefined });
  if (protectedHits.length) feedback.push(`Don't change protected files (${protectedHits.join(", ")}); they need Khaneil.`);

  const deletedTests = files.filter((f) => f.status === "removed" && TEST_FILE.test(f.filename)).map((f) => f.filename);
  add({ name: "No test file deleted", passed: !deletedTests.length, source: "rule", detail: deletedTests.join(", ") || undefined });
  if (deletedTests.length) feedback.push(`Fix the code instead of deleting tests (${deletedTests.join(", ")}).`);

  const silenced: string[] = [];
  for (const f of files) {
    for (const line of addedLines(f.patch)) {
      const hit = SILENCERS.find((s) => s.re.test(line));
      if (hit) silenced.push(`${f.filename}: ${hit.what}`);
      if (SECURITY_WORDS.test(line) && !securityRelevant.includes(f.filename)) securityRelevant.push(f.filename);
    }
    if (SECURITY_WORDS.test(f.filename) && !securityRelevant.includes(f.filename)) securityRelevant.push(f.filename);
    if (isDependencyFile(f.filename)) dependencyChanges.push(f.filename);
  }
  add({ name: "No check silenced (skipped tests, ts-ignore, eslint-disable)", passed: !silenced.length, source: "rule", detail: silenced.slice(0, 5).join("; ") || undefined });
  if (silenced.length) feedback.push(`Fix the cause instead of silencing the check (${silenced.slice(0, 3).join("; ")}).`);

  add({ name: "Dependency files unchanged", passed: !dependencyChanges.length, source: "rule", detail: dependencyChanges.join(", ") || undefined });
  add({ name: "No security-relevant code touched", passed: !securityRelevant.length, source: "rule", detail: securityRelevant.join(", ") || undefined });

  const hardFail = checks.some((c) => !c.passed && !/^(Dependency files unchanged|No security-relevant code touched)$/.test(c.name));
  if (!genuine) return report("BLOCKED");
  if (hardFail) return report("FAIL");
  if (dependencyChanges.length || securityRelevant.length) return report("NEEDS_REVIEW");
  return report("PASS");
}
