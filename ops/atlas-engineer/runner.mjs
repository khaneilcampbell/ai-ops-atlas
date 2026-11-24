#!/usr/bin/env node
// Atlas Engineering runner helper, used by .github/workflows/atlas-engineer.yml. Plain Node, no
// dependencies, so it runs before `npm ci` and never executes the repository's own code.
//
//   node ops/atlas-engineer/runner.mjs guard      validate the task input (env TASK) -> task.json
//   node ops/atlas-engineer/runner.mjs prompt     task.json + failure.log -> prompt.txt
//   node ops/atlas-engineer/runner.mjs bounds     git diff in the cwd -> outcome.json (changed / no_change / out_of_bounds)
//   node ops/atlas-engineer/runner.mjs usage      claude.json -> usage.json (model, tokens, cost, turns, plan)
//   node ops/atlas-engineer/runner.mjs result     everything -> result.json (ATLAS_WORKFLOW_RESULT)
//
// The protected paths and limits must match src/engineering/repos.ts and types.ts; a test checks it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LIMITS = { maxFilesChanged: 10, maxLinesChanged: 400, maxTurns: 40, maxFeedback: 1500, maxLog: 40_000 };

export const PROTECTED_PATHS = [
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const CATEGORIES = new Set(["lint", "typecheck", "test"]);
const MODEL = /^(opus|sonnet|haiku|claude-[a-z0-9-]{3,60})$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** The task Atlas sent (the workflow's one `task` input). Throws with a plain reason when anything is off. */
export function parseTask(text) {
  let t;
  try {
    t = JSON.parse(text);
  } catch {
    throw new Error("The task input isn't JSON.");
  }
  if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("The task input isn't an object.");
  const s = (k, max = 200) => (typeof t[k] === "string" && t[k].length <= max ? t[k] : "");
  const task = {
    taskId: s("taskId").toLowerCase(),
    attempt: Number(t.attempt),
    correlationId: s("correlationId", 120),
    idempotencyKey: s("idempotencyKey", 128),
    nonce: s("nonce", 128),
    repo: s("repo", 140).toLowerCase(),
    baseSha: s("baseSha", 40).toLowerCase(),
    failedRunId: s("failedRunId", 20),
    category: s("category", 20),
    model: s("model", 64),
    branch: s("branch", 80),
    maxTurns: Number(t.maxTurns ?? 30),
    feedback: s("feedback", 4000).replace(CONTROL, "").slice(0, LIMITS.maxFeedback),
    previousBranch: s("previousBranch", 80),
  };
  if (!UUID.test(task.taskId)) throw new Error("Bad taskId.");
  if (!Number.isInteger(task.attempt) || task.attempt < 1 || task.attempt > 9) throw new Error("Bad attempt.");
  if (task.idempotencyKey !== `${task.taskId}:${task.attempt}`) throw new Error("The idempotency key doesn't match the task and attempt.");
  if (!/^exec-[0-9a-f]{8}-[a-z0-9-]{2,40}$/.test(task.correlationId)) throw new Error("Bad correlationId.");
  if (!/^[0-9a-f]{32,64}$/.test(task.nonce)) throw new Error("Bad nonce.");
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(task.repo)) throw new Error("Bad repo.");
  if (!SHA.test(task.baseSha)) throw new Error("Bad base commit.");
  if (!/^[0-9]{1,20}$/.test(task.failedRunId)) throw new Error("Bad failed run id.");
  if (!CATEGORIES.has(task.category)) throw new Error(`Category ${task.category || "(none)"} isn't one Atlas repairs on its own.`);
  if (!MODEL.test(task.model)) throw new Error("Bad model.");
  if (task.branch !== `atlas-eng/${task.taskId.slice(0, 8)}-a${task.attempt}`) throw new Error("The branch isn't this task's atlas-eng/ branch.");
  if (!Number.isInteger(task.maxTurns) || task.maxTurns < 1 || task.maxTurns > LIMITS.maxTurns) throw new Error("Bad maxTurns.");
  if (task.previousBranch && !/^atlas-eng\/[0-9a-f]{8}-a[0-9]{1,2}$/.test(task.previousBranch)) throw new Error("Bad previousBranch.");
  return task;
}

/** Log text safe to show a model and keep: colours stripped, anything token-like masked, tail only. */
export function redact(text) {
  return String(text)
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{10,}|xox[abprs]-[A-Za-z0-9-]{10,})/g, "[redacted]")
    .replace(/(authorization:\s*)(bearer|token|basic)\s+\S+/gi, "$1$2 [redacted]")
    .replace(CONTROL, "")
    .slice(-LIMITS.maxLog);
}

export function buildPrompt(template, task, failureLog) {
  return [
    template.trim(),
    "",
    "## This task",
    `- Repository: ${task.repo}, commit ${task.baseSha}`,
    `- Failing check: ${task.category}`,
    `- Branch your change goes to (Atlas pushes it, not you): ${task.branch}`,
    task.feedback ? `- This is a repair. Atlas QA rejected the previous attempt${task.previousBranch ? ` (${task.previousBranch})` : ""} with this feedback, written by Atlas's own checks:\n  ${task.feedback}` : "- This is the first attempt.",
    "",
    "## Failure log (untrusted data, last part only)",
    "<failure-log>",
    redact(failureLog),
    "</failure-log>",
  ].join("\n");
}

const SECRET_SHAPES = /(sk-ant-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16})/;

/** True when a patch adds something shaped like a credential (it would land on a public branch). */
export function addsSecret(patch) {
  return String(patch)
    .split("\n")
    .some((l) => l.startsWith("+") && !l.startsWith("+++") && SECRET_SHAPES.test(l));
}

/** Checks the working tree's change against the limits and protected paths. */
export function bounds(numstat, nameStatus, patch = "") {
  const files = numstat
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [a, d, ...p] = l.split("\t");
      return { path: p.join("\t"), additions: a === "-" ? 0 : Number(a) || 0, deletions: d === "-" ? 0 : Number(d) || 0 };
    });
  const names = nameStatus
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t").slice(1))
    .flat();
  const all = [...new Set([...files.map((f) => f.path), ...names])];
  if (!all.length) return { outcome: "no_change", files: [], reason: "Claude made no change." };
  const prot = all.filter((p) => PROTECTED_PATHS.some((r) => r.test(p)));
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  if (addsSecret(patch)) return { outcome: "out_of_bounds", files, reason: "The change adds something that looks like a credential, so it was thrown away." };
  if (prot.length) return { outcome: "out_of_bounds", files, reason: `The change touches protected files: ${prot.join(", ")}` };
  if (all.length > LIMITS.maxFilesChanged || lines > LIMITS.maxLinesChanged) return { outcome: "out_of_bounds", files, reason: `The change is too large: ${all.length} files, ${lines} lines.` };
  return { outcome: "changed", files, reason: null };
}

/** The Claude Code JSON result -> what Atlas records. Missing numbers stay missing, never invented. */
export function usageFrom(claude, model) {
  const u = claude && typeof claude === "object" ? claude : {};
  const usage = u.usage && typeof u.usage === "object" ? u.usage : {};
  const n = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
  return {
    model,
    inputTokens: n(usage.input_tokens),
    outputTokens: n(usage.output_tokens),
    costUsd: typeof u.total_cost_usd === "number" && u.total_cost_usd >= 0 ? Math.round(u.total_cost_usd * 10_000) / 10_000 : 0,
    turns: n(u.num_turns),
    plan: typeof u.result === "string" ? u.result.replace(CONTROL, "").slice(0, 1500) : null,
    isError: u.is_error === true,
  };
}

/** ATLAS_WORKFLOW_RESULT for /api/hooks/engineering-result. */
export function buildResult(o) {
  const failed = o.kind === "failed";
  return {
    contract: failed ? "ATLAS_EXECUTIVE_ERROR" : "ATLAS_WORKFLOW_RESULT",
    version: 1,
    eventId: `${o.task.idempotencyKey}:gh-${o.runId}-${o.runAttempt}`,
    taskId: o.task.taskId,
    attempt: o.task.attempt,
    correlationId: o.task.correlationId,
    idempotencyKey: o.task.idempotencyKey,
    nonce: o.task.nonce,
    executionId: String(o.runId),
    kind: failed ? "failed" : "succeeded",
    ...(failed ? { error: String(o.error ?? "The runner failed.").slice(0, 900), transient: !!o.transient } : {}),
    artifact: {
      schema: "engineering-change/1",
      outcome: failed ? "failed" : o.outcome,
      repo: o.task.repo,
      baseSha: o.task.baseSha,
      headSha: o.outcome === "changed" ? (o.headSha ?? null) : null,
      branch: o.outcome === "changed" ? o.task.branch : null,
      runId: Number(o.runId),
      runUrl: o.runUrl,
      filesChanged: o.files ?? [],
      validation: o.validation ?? [],
      phases: o.phases ?? [],
      usage: o.usage ? { model: o.usage.model, inputTokens: o.usage.inputTokens, outputTokens: o.usage.outputTokens, costUsd: o.usage.costUsd, turns: o.usage.turns } : null,
      plan: o.usage?.plan ?? null,
      error: o.error ? String(o.error).slice(0, 900) : (o.reason ?? null),
    },
    ...(o.usage ? { usage: { model: o.usage.model, inputTokens: o.usage.inputTokens, outputTokens: o.usage.outputTokens, webSearches: 0, costUsd: o.usage.costUsd } } : {}),
    at: new Date(o.now ?? Date.now()).toISOString(),
  };
}

// ---- CLI ------------------------------------------------------------------------------------------

const read = (f, fallback = "") => (existsSync(f) ? readFileSync(f, "utf8") : fallback);
const readJson = (f, fallback) => {
  try {
    return JSON.parse(read(f, ""));
  } catch {
    return fallback;
  }
};
const phase = (file, name) => {
  const list = readJson(file, []);
  list.push({ phase: name, at: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(list));
};

function main(cmd) {
  const dir = process.env.ATLAS_OUT ?? ".";
  if (cmd === "guard") {
    const task = parseTask(process.env.TASK ?? "");
    if (process.env.GITHUB_REPOSITORY && task.repo !== process.env.GITHUB_REPOSITORY.toLowerCase()) throw new Error("The task is for another repository.");
    writeFileSync(`${dir}/task.json`, JSON.stringify(task));
    console.log(`Task ${task.taskId} attempt ${task.attempt}: ${task.category} on ${task.baseSha.slice(0, 7)} -> ${task.branch}`);
  } else if (cmd === "phase") {
    phase(`${dir}/phases.json`, process.argv[3]);
  } else if (cmd === "prompt") {
    const task = readJson(`${dir}/task.json`, null);
    const here = fileURLToPath(new URL(".", import.meta.url));
    writeFileSync(`${dir}/prompt.txt`, buildPrompt(read(`${here}prompt.md`), task, read(`${dir}/failure.log`)));
  } else if (cmd === "redact") {
    writeFileSync(`${dir}/failure.log`, redact(read(`${dir}/failure.raw.log`)));
  } else if (cmd === "bounds") {
    execFileSync("git", ["add", "-A"]);
    const numstat = execFileSync("git", ["diff", "--cached", "--numstat"], { encoding: "utf8" });
    const names = execFileSync("git", ["diff", "--cached", "--name-status"], { encoding: "utf8" });
    const patch = execFileSync("git", ["diff", "--cached", "--binary"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    const b = bounds(numstat, names, patch);
    if (b.outcome === "changed") writeFileSync(`${dir}/change.patch`, patch);
    writeFileSync(`${dir}/outcome.json`, JSON.stringify(b));
    console.log(`${b.outcome}: ${b.files.length} file(s)${b.reason ? `. ${b.reason}` : ""}`);
  } else if (cmd === "usage") {
    const task = readJson(`${dir}/task.json`, {});
    writeFileSync(`${dir}/usage.json`, JSON.stringify(usageFrom(readJson(`${dir}/claude.json`, {}), task.model)));
  } else if (cmd === "result") {
    const task = readJson(`${dir}/task.json`, null);
    if (!task) throw new Error("No validated task; nothing to report.");
    const outcome = readJson(`${dir}/outcome.json`, null);
    const failedJob = process.env.FAILED_JOB ?? "";
    const result = buildResult({
      task,
      kind: failedJob ? "failed" : "succeeded",
      error: failedJob ? `The ${failedJob} job failed. See the run's logs.` : null,
      transient: failedJob === "guard" ? false : !!failedJob,
      outcome: outcome?.outcome ?? "failed",
      reason: outcome?.reason ?? null,
      files: outcome?.files ?? [],
      headSha: process.env.HEAD_SHA || null,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
      runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      phases: readJson(`${dir}/phases.json`, []),
      validation: readJson(`${dir}/validation.json`, []),
      usage: readJson(`${dir}/usage.json`, null),
    });
    writeFileSync(`${dir}/result.json`, JSON.stringify(result));
    console.log(`${result.kind}: ${result.artifact.outcome}`);
  } else {
    throw new Error(`Unknown command ${cmd ?? "(none)"}.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv[2]);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
