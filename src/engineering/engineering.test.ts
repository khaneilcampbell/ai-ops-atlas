import { describe, expect, it } from "vitest";
import { classify, decideIntake, incidentKey, jobFacts, runFacts, stepCategory, type IntakeContext } from "./classify";
import { branchFor, parseChange, parseDelivery, pullRequestText, runnerTaskFrom, verifyChange, type ChangeArtifact } from "./contracts";
import { canMovePhase, cleanRunnerPhases, engineerActivity, modelTiers, routeModel } from "./lifecycle";
import { evaluateQa, type QaEvidence } from "./qa";
import { ENGINEERING_REPOS, engineeringRepo, isDependencyFile, isProtectedPath } from "./repos";
import { ENGINEERING_LIMITS } from "./types";

const REPO = ENGINEERING_REPOS[0];
const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);
const TASK = "0123abcd-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-11-23T12:00:00Z");

const run = (over: Record<string, unknown> = {}) =>
  runFacts("khaneilcampbell/ai-ops-atlas", {
    id: 101,
    run_attempt: 1,
    name: "CI",
    path: ".github/workflows/ci.yml",
    event: "push",
    status: "completed",
    conclusion: "failure",
    head_sha: SHA,
    head_branch: "main",
    html_url: "https://github.com/khaneilcampbell/ai-ops-atlas/actions/runs/101",
    created_at: "2026-11-23T11:30:00Z",
    ...over,
  })!;
const jobs = (steps: [string, string][], job = "Frontend (types, tests, build)") =>
  jobFacts({ jobs: [{ name: job, conclusion: "failure", html_url: "https://github.com/x/y/actions/runs/101/job/1", steps: steps.map(([name, conclusion]) => ({ name, conclusion })) }] });
const ctx = (over: Partial<IntakeContext> = {}): IntakeContext => ({ enabled: true, openOnRepo: 0, autoToday: 0, laterRunPassed: false, stopped: null, now: NOW, ...over });

describe("allowlist and protected paths", () => {
  it("only knows the allowlisted repository, case-insensitively", () => {
    expect(engineeringRepo("KhaneilCampbell/AI-Ops-Atlas")?.repo).toBe("khaneilcampbell/ai-ops-atlas");
    expect(engineeringRepo("someone/else")).toBeNull();
    expect(engineeringRepo("khaneilcampbell/../ai-ops-atlas")).toBeNull();
  });
  it("protects release, secrets, updater, write actions and the division's own policy", () => {
    for (const p of [".github/workflows/release.yml", ".claude/settings.json", "src-tauri/tauri.conf.json", "src-tauri/src/secrets.rs", "src/components/UpdateButton.tsx", "src/actions/rerun.ts", "src/engineering/repos.ts", "server/engineering/intake.ts", "db/migrations/0005.sql", "catalog/ai-ops-atlas.yaml", "ops/atlas-engineer/runner.mjs", ".env", "functions/.env.local"])
      expect(isProtectedPath(p), p).toBe(true);
    for (const p of ["src/views/Map.tsx", "server/executive/engine.ts", "changelog.d/x.md", "src/environment.ts"]) expect(isProtectedPath(p), p).toBe(false);
    expect(isDependencyFile("package-lock.json")).toBe(true);
    expect(isDependencyFile("src-tauri/Cargo.toml")).toBe(true);
  });
});

describe("failure classification and intake", () => {
  it("names step categories", () => {
    expect(stepCategory("Frontend (types, tests, build)", "Run npm run lint")).toBe("lint");
    expect(stepCategory("Frontend (types, tests, build)", "Run npm run typecheck")).toBe("typecheck");
    expect(stepCategory("Frontend (types, tests, build)", "Run npm test")).toBe("test");
    expect(stepCategory("Frontend (types, tests, build)", "Run npm ci")).toBe("infrastructure");
    expect(stepCategory("Desktop shell (Rust tests)", "cargo test")).toBe("rust");
    expect(stepCategory("Publish", "Sign the app")).toBe("release");
  });
  it("supports one lint, typecheck or test failure in the known job", () => {
    const c = classify(REPO, jobs([["Run npm run lint", "failure"]]));
    expect(c).toMatchObject({ category: "lint", supported: true });
  });
  it("escalates unknown jobs, mixed failures and unsupported categories", () => {
    expect(classify(REPO, jobs([["cargo test", "failure"]], "Desktop shell (Rust tests)")).supported).toBe(false);
    expect(classify(REPO, jobs([["Run npm run lint", "failure"], ["Run npm test", "failure"]])).supported).toBe(false);
    expect(classify(REPO, jobs([["Run npm run build", "failure"]])).supported).toBe(false);
    expect(classify(REPO, []).supported).toBe(false);
  });
  it("repairs on its own only within every limit", () => {
    const f = run();
    const cls = classify(REPO, jobs([["Run npm test", "failure"]]));
    expect(decideIntake(f, cls, ctx())).toMatchObject({ kind: "repair", autonomy: 3 });
    expect(decideIntake(f, cls, ctx({ autoToday: ENGINEERING_LIMITS.dailyAutoJobs }))).toMatchObject({ kind: "repair", autonomy: 2 });
    expect(decideIntake(f, cls, ctx({ enabled: false })).kind).toBe("escalate");
    expect(decideIntake(f, cls, ctx({ openOnRepo: 1 })).kind).toBe("escalate");
    expect(decideIntake(f, cls, ctx({ stopped: "Khaneil stopped it" })).kind).toBe("escalate");
    expect(decideIntake(f, null, ctx()).kind).toBe("escalate");
  });
  it("ignores what isn't Atlas's to fix", () => {
    const cls = classify(REPO, jobs([["Run npm test", "failure"]]));
    expect(decideIntake(run({ head_branch: "feature/x", event: "pull_request" }), cls, ctx()).kind).toBe("ignore");
    expect(decideIntake(run({ conclusion: "success" }), cls, ctx()).kind).toBe("ignore");
    expect(decideIntake(run({ name: "Visual checks" }), cls, ctx()).kind).toBe("ignore");
    expect(decideIntake(run({ created_at: "2026-11-22T00:00:00Z" }), cls, ctx()).kind).toBe("ignore");
    expect(decideIntake(run(), cls, ctx({ laterRunPassed: true })).kind).toBe("ignore");
    expect(decideIntake({ ...run(), repo: "someone/else" }, cls, ctx()).kind).toBe("ignore");
  });
  it("dedupes by repository, workflow and commit", () => {
    expect(incidentKey(run())).toBe(`ci:khaneilcampbell.ai-ops-atlas:ci:${SHA}`);
    expect(incidentKey({ ...run(), runId: 999 } as never)).toBe(incidentKey(run()));
  });
  it("rejects malformed runs", () => {
    expect(runFacts("x/y", { id: 1, name: "CI", head_sha: "nope", head_branch: "main" })).toBeNull();
    expect(runFacts("x/y", null)).toBeNull();
  });
});

describe("lifecycle and model routing", () => {
  it("moves forward, to side states, and never out of a final state", () => {
    expect(canMovePhase("TASK_ASSIGNED", "CONTEXT_COLLECTED")).toBe(true);
    expect(canMovePhase("CODE_MODIFIED", "CONTEXT_COLLECTED")).toBe(false);
    expect(canMovePhase("CODE_MODIFIED", "BLOCKED")).toBe(true);
    expect(canMovePhase("AWAITING_APPROVAL", "QA_REVIEW_REQUESTED")).toBe(true);
    expect(canMovePhase("PR_READY", "FAILED")).toBe(false);
  });
  it("derives the 3D activity from the real phase", () => {
    expect(engineerActivity(null)).toBe("IDLE");
    expect(engineerActivity("CONTEXT_COLLECTED")).toBe("INVESTIGATING");
    expect(engineerActivity("CODE_MODIFIED")).toBe("CODING");
    expect(engineerActivity("VALIDATION_STARTED")).toBe("TESTING");
    expect(engineerActivity("QA_REVIEW_REQUESTED")).toBe("REVIEWING");
    expect(engineerActivity("AWAITING_APPROVAL")).toBe("BLOCKED");
  });
  it("keeps only known runner phases, in order", () => {
    const p = cleanRunnerPhases([
      { phase: "CODE_MODIFIED", at: "2026-11-23T12:01:00Z" },
      { phase: "CONTEXT_COLLECTED", at: "2026-11-23T12:00:00Z" },
      { phase: "PR_READY", at: "2026-11-23T12:02:00Z" },
      { phase: "VALIDATION_STARTED", at: "nope" },
    ]);
    expect(p.map((x) => x.phase)).toEqual(["CODE_MODIFIED"]);
  });
  it("routes by alias, with a frontier model only for harder work", () => {
    expect(routeModel("lint", 0)).toEqual({ tier: "routine", model: "sonnet" });
    expect(routeModel("test", 0).tier).toBe("complex");
    expect(routeModel("lint", 1).tier).toBe("complex");
    expect(modelTiers("routine=haiku, complex=claude-opus-5-5")).toEqual({ routine: "haiku", complex: "claude-opus-5-5" });
    expect(modelTiers("routine=gpt-4;rm -rf")).toEqual({ routine: "sonnet", complex: "opus" });
  });
});

const change = (over: Partial<ChangeArtifact> = {}): ChangeArtifact => ({
  schema: "engineering-change/1",
  outcome: "changed",
  repo: REPO.repo,
  baseSha: SHA,
  headSha: HEAD,
  branch: branchFor(TASK, 1),
  runId: 555,
  runUrl: `https://github.com/${REPO.repo}/actions/runs/555`,
  filesChanged: [{ path: "src/lib/format.ts", additions: 3, deletions: 1 }],
  validation: REPO.checks.map((c) => ({ name: c.name, command: c.command, passed: true })),
  phases: [],
  usage: { model: "sonnet", inputTokens: 1000, outputTokens: 200, costUsd: 0.05, turns: 4 },
  plan: "The formatter returned undefined for zero.",
  error: null,
  ...over,
});

describe("contracts", () => {
  it("parses and verifies a runner report", () => {
    const p = parseChange(change());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(verifyChange(p.value, { repo: REPO.repo, baseSha: SHA, taskId: TASK, attempt: 1 }, "now").passed).toBe(true);
    expect(verifyChange(p.value, { repo: REPO.repo, baseSha: SHA, taskId: TASK, attempt: 2 }, "now").passed).toBe(false);
    expect(verifyChange({ ...p.value, filesChanged: [{ path: ".github/workflows/ci.yml", additions: 1, deletions: 0 }] }, { repo: REPO.repo, baseSha: SHA, taskId: TASK, attempt: 1 }, "now").passed).toBe(false);
  });
  it("refuses non-atlas branches and foreign run links", () => {
    expect(parseChange(change({ branch: "main" })).ok).toBe(false);
    const p = parseChange(change({ runUrl: "https://evil.example/runs/1" }));
    expect(p.ok && p.value.runUrl).toBeNull();
  });
  it("accepts only a pull request link on the allowlisted repository", () => {
    const ok = { schema: "pr-delivery/1", repo: REPO.repo, prUrl: `https://github.com/${REPO.repo}/pull/12`, prNumber: 12, branch: branchFor(TASK, 1), headSha: HEAD };
    expect(parseDelivery(ok).ok).toBe(true);
    expect(parseDelivery({ ...ok, prUrl: "https://github.com/other/repo/pull/12" }).ok).toBe(false);
    expect(parseDelivery({ ...ok, repo: "other/repo", prUrl: "https://github.com/other/repo/pull/12" }).ok).toBe(false);
  });
  it("maps the dispatch envelope to the runner task", () => {
    const t = runnerTaskFrom({ taskId: TASK, attempt: 1, correlationId: "exec-0123abcd-implement", idempotencyKey: `${TASK}:1`, nonce: "f".repeat(32), inputs: { repo: REPO.repo, base_sha: SHA, failed_run_id: "101", category: "test", model: "opus", branch: branchFor(TASK, 1), max_turns: "30", feedback: "x".repeat(3000) } });
    expect(t).toMatchObject({ repo: REPO.repo, baseSha: SHA, failedRunId: "101", maxTurns: 30, previousBranch: "" });
    expect(t.feedback.length).toBe(1500);
  });
});

describe("QA evaluator", () => {
  const evidence = (over: Partial<QaEvidence> = {}, files?: NonNullable<QaEvidence["compare"]>["files"]): QaEvidence => ({
    run: { id: 555, path: ".github/workflows/atlas-engineer.yml", event: "workflow_dispatch", status: "completed", conclusion: "success", headSha: "c".repeat(40), htmlUrl: null },
    jobs: [{ name: "validate", conclusion: "success", url: null, steps: REPO.checks.map((c) => ({ name: c.name, conclusion: "success" })) }],
    compare: { mergeBaseSha: SHA, status: "ahead", aheadBy: 1, behindBy: 0, headSha: HEAD, files: files ?? [{ filename: "src/lib/format.ts", status: "modified", additions: 3, deletions: 1, patch: "+  return n === 0 ? '0' : String(n);" }] },
    ...over,
  });
  it("passes a clean change on GitHub's own results", () => {
    expect(evaluateQa(REPO, change(), evidence(), "now").outcome).toBe("PASS");
  });
  it("fails when a check failed in the clean runner, with feedback for the repair", () => {
    const e = evidence({ jobs: [{ name: "validate", conclusion: "failure", url: null, steps: [{ name: "Lint", conclusion: "success" }, { name: "Typecheck", conclusion: "success" }, { name: "Unit tests", conclusion: "failure" }] }] });
    const r = evaluateQa(REPO, change(), e, "now");
    expect(r.outcome).toBe("FAIL");
    expect(r.feedback.join(" ")).toMatch(/Unit tests/);
    // The runner said it passed; GitHub says otherwise, and QA notes the mismatch.
    expect(r.checks.some((c) => /matches GitHub/.test(c.name) && !c.passed)).toBe(true);
  });
  it("fails silenced checks, deleted tests, protected files and wrong heads", () => {
    expect(evaluateQa(REPO, change(), evidence({}, [{ filename: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "+// eslint-disable-next-line" }]), "now").outcome).toBe("FAIL");
    expect(evaluateQa(REPO, change(), evidence({}, [{ filename: "src/a.test.ts", status: "removed", additions: 0, deletions: 20, patch: null }]), "now").outcome).toBe("FAIL");
    expect(evaluateQa(REPO, change(), evidence({}, [{ filename: ".github/workflows/ci.yml", status: "modified", additions: 1, deletions: 0, patch: "+x" }]), "now").outcome).toBe("FAIL");
    expect(evaluateQa(REPO, change({ headSha: "d".repeat(40) }), evidence(), "now").outcome).toBe("FAIL");
    expect(evaluateQa(REPO, change(), evidence({ compare: { ...evidence().compare!, behindBy: 2 } }), "now").outcome).toBe("FAIL");
  });
  it("sends dependency and security-relevant changes to Khaneil", () => {
    expect(evaluateQa(REPO, change(), evidence({}, [{ filename: "package.json", status: "modified", additions: 1, deletions: 1, patch: '+"x": "1"' }]), "now").outcome).toBe("NEEDS_REVIEW");
    expect(evaluateQa(REPO, change(), evidence({}, [{ filename: "src/lib/a.ts", status: "modified", additions: 1, deletions: 0, patch: "+const token = read();" }]), "now").outcome).toBe("NEEDS_REVIEW");
  });
  it("is BLOCKED, never PASS, when the evidence can't be trusted or read", () => {
    expect(evaluateQa(REPO, change(), evidence({ error: "GitHub 502" }), "now").outcome).toBe("BLOCKED");
    expect(evaluateQa(REPO, change(), evidence({ run: { ...evidence().run!, path: ".github/workflows/ci.yml" } }), "now").outcome).toBe("BLOCKED");
    expect(evaluateQa(REPO, change(), evidence({ run: { ...evidence().run!, status: "in_progress" } }), "now").outcome).toBe("BLOCKED");
  });
});

describe("pull request text", () => {
  it("follows the template headings and stays under GitHub's limit", () => {
    const qa = evaluateQa(REPO, change(), { run: { id: 555, path: ".github/workflows/atlas-engineer.yml", event: "workflow_dispatch", status: "completed", conclusion: "success", headSha: SHA, htmlUrl: null }, jobs: [{ name: "validate", conclusion: "success", url: null, steps: REPO.checks.map((c) => ({ name: c.name, conclusion: "success" })) }], compare: { mergeBaseSha: SHA, status: "ahead", aheadBy: 1, behindBy: 0, headSha: HEAD, files: [{ filename: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "+x" }] } }, "now");
    const t = pullRequestText({ repo: REPO, category: "test", workflowName: "CI", failedRunUrl: null, baseSha: SHA, branch: branchFor(TASK, 1), qa, runUrl: null, plan: "x".repeat(5000), goalId: TASK, taskRecordId: null, today: "2026-11-23" });
    expect(t.title).toMatch(/^Fix failing/);
    for (const h of ["## What changes for Khaneil", "## Changelog line", "## Risk", "## Checks", "## Rollback"]) expect(t.body).toContain(h);
    expect(t.body.length).toBeLessThanOrEqual(1990);
    expect(t.body).toMatch(/never merges/);
  });
});
