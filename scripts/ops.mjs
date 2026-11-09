// Local-first checks and a session handoff, in plain code: no model, no network.
// A coding session runs one command and reads a short report instead of opening files and logs.
//   npm run ops                 git state, what this change must run, changelog + JSON checks
//   npm run ops -- --run        also runs those checks and prints only the failures' last lines
//   npm run handoff -- "task"   a short markdown handoff to paste into a fresh session
// Rules come from CLAUDE.md; keep the two in step.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** CLAUDE.md "High risk" paths. */
const HIGH_RISK = [/^\.github\//, /^scripts\/.*signing/, /^src-tauri\/tauri\.conf\.json$/, /^src-tauri\/src\/(secrets|handoff)\.rs$/, /^src\/components\/UpdateButton\.tsx$/, /^src-tauri\/src\/actions\//, /^src\/actions\//, /^LICENSE$/];
const DOCS = /(^docs\/|\.md$|^LICENSE$)/;
const ON_SCREEN = /^src\/.*\.(tsx|css)$|^src\/styles\//;
const MAP = /^src\/views\/(map3d\/|Map\.tsx|office\/)/;
/** Hand-written files this long are cheaper to read in ranges or by search. */
export const BIG_FILE_LINES = 1200;

/** Where a path belongs, for grouping the file manifest. */
export function area(path) {
  if (HIGH_RISK.some((r) => r.test(path))) return "high risk";
  if (path.startsWith("src-tauri/")) return "rust";
  if (MAP.test(path)) return "map";
  if (/\.test\.|^visual\//.test(path)) return "tests";
  if (path.startsWith("src/")) return "app";
  if (path.startsWith("ops/") || path.startsWith("functions/") || path.startsWith("scripts/")) return "ops";
  if (DOCS.test(path)) return "docs";
  return "other";
}

/** What CLAUDE.md asks this set of changed paths to run before pushing, and what to say in the PR. */
export function plan(paths) {
  const code = paths.filter((p) => !DOCS.test(p));
  const checks = [];
  const notes = [];
  if (code.length) checks.push("npm run lint", "npm run typecheck", "npm test");
  if (paths.some((p) => p.startsWith("src-tauri/"))) {
    checks.push("cargo test --manifest-path src-tauri/Cargo.toml");
    notes.push('Rust changed: run CI by hand on the branch with "Also build the macOS app" before asking to merge.');
  }
  if (paths.some((p) => ON_SCREEN.test(p))) notes.push("On screen: npm run visual, before/after screenshots at desktop and iPhone width.");
  if (paths.some((p) => MAP.test(p))) notes.push("Map changed: npm run measure:perf to stay inside the map budget.");
  const risky = paths.filter((p) => HIGH_RISK.some((r) => r.test(p)));
  if (risky.length) notes.push(`High risk, say so in the PR: ${list(risky)}.`);
  if (code.length && !paths.includes("CHANGELOG.md")) notes.push("Add a line at the top of CHANGELOG.md.");
  return { checks, notes };
}

/** The newest changelog entry must read `- YYYY-MM-DD · What changed (#123)`. Returns a problem or null. */
export function changelogProblem(markdown) {
  const first = markdown.split("\n").find((l) => l.startsWith("- "));
  if (!first) return "CHANGELOG.md has no entries.";
  if (!/^- \d{4}-\d{2}-\d{2} · .+\(#(\d+|PR)\)$/.test(first.trim())) return `Newest CHANGELOG line doesn't match "- YYYY-MM-DD · What changed (#123)": ${first.slice(0, 80)}`;
  return null;
}

/** Cloudflare Pages' preview alias for a branch. */
export function previewUrl(branch) {
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 28).replace(/^-+|-+$/g, "");
  return `https://${slug}.ai-ops-atlas.pages.dev`;
}

/** At most `n` items, then "+N more", so one big merge never floods the report. */
export function list(items, n = 5) {
  return items.length > n ? `${items.slice(0, n).join(", ")} +${items.length - n} more` : items.join(", ");
}

/** The last `n` lines of a failing command's output, so a session reads the error and not the log. */
export function tail(text, n = 15) {
  const lines = text.trimEnd().split("\n");
  return (lines.length > n ? [`… ${lines.length - n} lines above`, ...lines.slice(-n)] : lines).join("\n");
}

/** A handoff short enough to paste into a fresh session. */
export function handoff({ task, branch, base, ahead, behind, dirty, commits, files, plan: p, date }) {
  const added = files.reduce((s, f) => s + f.added, 0);
  const removed = files.reduce((s, f) => s + f.removed, 0);
  const groups = new Map();
  for (const f of files) groups.set(area(f.path), [...(groups.get(area(f.path)) ?? []), f]);
  const out = [
    `# Handoff · ${branch} · ${date}`,
    "",
    `Task: ${task || "(say what is left to do)"}`,
    `Base: ${base} · ${ahead} ahead, ${behind} behind${dirty ? ` · ${dirty} uncommitted ${dirty === 1 ? "file" : "files"}` : ""}`,
    `Preview: ${previewUrl(branch)}`,
    "",
  ];
  if (commits.length) out.push("## Commits", ...commits.slice(0, 10).map((c) => `- ${c}`), ...(commits.length > 10 ? [`- … ${commits.length - 10} more`] : []), "");
  out.push(`## Files (${files.length}, +${added} −${removed})`);
  let shown = 0;
  for (const [name, list] of groups) {
    for (const f of list) {
      if (shown++ >= 30) break;
      out.push(`- ${name}: ${f.path} (+${f.added} −${f.removed})${f.lines >= BIG_FILE_LINES ? ` · ${f.lines} lines, read in ranges` : ""}`);
    }
  }
  if (files.length > 30) out.push(`- … ${files.length - 30} more`);
  out.push("", "## Before pushing", ...(p.checks.length ? [`- ${p.checks.join(" && ")}`] : ["- Docs only: no checks needed"]), ...p.notes.map((n) => `- ${n}`), "");
  out.push("## Start the next session with", "Read CLAUDE.md, then only the files above. Run `npm run ops -- --run` before pushing; it prints only failures.");
  return out.join("\n");
}

// ── Reading the repository ──────────────────────────────────────────────────

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const TEXT = /\.(m?[jt]sx?|rs|css|md|json|ya?ml|toml|py|sh|html)$/;

function lineCount(path) {
  if (!TEXT.test(path)) return 0;
  try {
    return fs.readFileSync(path, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

function state() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD") || "(detached)";
  const base = git("rev-parse", "--verify", "-q", "origin/main") ? "origin/main" : "main";
  const [behind, ahead] = (git("rev-list", "--left-right", "--count", `${base}...HEAD`) || "0\t0").split(/\s+/).map(Number);
  const status = git("status", "--porcelain").split("\n").filter(Boolean);
  const mergeBase = git("merge-base", base, "HEAD") || base;
  const commits = git("log", "--format=%h %s", `${mergeBase}..HEAD`).split("\n").filter(Boolean);
  const numstat = git("diff", "--numstat", mergeBase).split("\n").filter(Boolean);
  const files = numstat.map((l) => {
    const [a, r, path] = l.split("\t");
    return { path, added: Number(a) || 0, removed: Number(r) || 0, lines: lineCount(path) };
  });
  for (const s of status.filter((s) => s.startsWith("??"))) {
    const path = s.slice(3);
    if (!files.some((f) => f.path === path)) files.push({ path, added: lineCount(path), removed: 0, lines: lineCount(path) });
  }
  const upstream = git("rev-list", "--count", `@{u}..HEAD`);
  return { branch, base, ahead, behind, dirty: status.length, commits, files, unpushed: upstream === "" ? null : Number(upstream) };
}

function report(s, run) {
  const paths = s.files.map((f) => f.path);
  const p = plan(paths);
  const problems = [];
  const lines = [`${s.branch} · ${s.ahead} ahead / ${s.behind} behind ${s.base} · ${s.dirty} uncommitted · ${s.files.length} files changed`];
  if (s.branch === "main") problems.push("You're on main: make a branch first.");
  if (s.unpushed === null) lines.push("Not pushed yet: no upstream branch.");
  else if (s.unpushed > 0) lines.push(`${s.unpushed} ${s.unpushed === 1 ? "commit" : "commits"} not pushed.`);
  if (s.behind > 20) lines.push(`${s.behind} commits behind ${s.base}: merge it before the PR goes up.`);
  if (paths.includes("CHANGELOG.md") || p.checks.length) {
    const c = changelogProblem(fs.existsSync("CHANGELOG.md") ? fs.readFileSync("CHANGELOG.md", "utf8") : "");
    if (c) problems.push(c);
  }
  for (const f of paths.filter((x) => x.endsWith(".json") && fs.existsSync(x))) {
    try {
      JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      problems.push(`${f} isn't valid JSON: ${e.message}`);
    }
  }
  const big = s.files.filter((f) => f.lines >= BIG_FILE_LINES).map((f) => `${f.path} (${f.lines})`);
  if (big.length) lines.push(`Big files, read in ranges or grep: ${list(big)}`);
  lines.push(`Run before pushing: ${p.checks.join(" && ") || "nothing (docs only)"}`, ...p.notes);
  if (run) {
    for (const cmd of p.checks) {
      const [bin, ...args] = cmd.split(" ");
      const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (r.status === 0) lines.push(`✓ ${cmd}`);
      else problems.push(`✗ ${cmd}\n${tail(`${r.stdout ?? ""}${r.stderr ?? ""}`)}`);
    }
  }
  lines.push(...problems.map((x) => (x.startsWith("✗") ? x : `✗ ${x}`)));
  if (!problems.length) lines.push(run ? "All checks passed." : "No problems found.");
  return { text: lines.join("\n"), ok: problems.length === 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd = "check", ...rest] = process.argv.slice(2);
  const s = state();
  if (cmd === "handoff") {
    const task = rest.filter((a) => !a.startsWith("--")).join(" ");
    const text = handoff({ ...s, task, plan: plan(s.files.map((f) => f.path)), date: new Date().toISOString().slice(0, 10) });
    process.stdout.write(`${text}\n`);
  } else {
    const r = report(s, rest.includes("--run"));
    process.stdout.write(`${r.text}\n`);
    process.exitCode = r.ok ? 0 : 1;
  }
}
