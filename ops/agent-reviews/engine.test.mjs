import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("./engine.cjs");

// Synthetic repositories only (made-up names and numbers).
const NOW = Date.UTC(2026, 10, 23, 12, 0);
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
const run = (d, conclusion, name = "CI") => ({ status: "completed", conclusion, created_at: ago(d), name });
const healthy = {
  repo: "example/healthy", project: "healthy", defaultBranch: "main",
  ci: { ok: true, runs: [run(0, "success"), run(1, "success"), run(2, "success")] },
  dependabot: { ok: true, alerts: [] }, codeScanning: { ok: true, enabled: true, alerts: [] },
  secretScanning: { ok: true, enabled: true, alerts: [] }, protection: { ok: true, protected: true, detail: "Ruleset: main" },
  dependencyPrs: { ok: true, prs: [] },
};
const broken = {
  repo: "example/broken", project: "broken", defaultBranch: "main",
  ci: { ok: true, runs: [run(0, "failure"), run(1, "failure"), run(2, "success")] },
  dependabot: { ok: true, alerts: [{ severity: "critical" }, { severity: "low" }] }, codeScanning: { ok: true, enabled: false, alerts: [] },
  secretScanning: { ok: true, enabled: true, alerts: [{ number: 1 }] }, protection: { ok: true, protected: false },
  dependencyPrs: { ok: true, prs: [{ created_at: ago(30) }, { created_at: ago(2) }] },
};
const unreadable = { repo: "example/unreadable", ci: { ok: false, error: "HTTP 404" }, dependabot: { ok: false, error: "HTTP 403" }, codeScanning: { ok: false, error: "HTTP 403" }, secretScanning: { ok: false, error: "HTTP 404" }, protection: { ok: false, error: "HTTP 403" }, dependencyPrs: { ok: false, error: "HTTP 500" } };
const partial = { ...healthy, repo: "example/partial", secretScanning: { ok: false, error: "HTTP 404" } };

describe("Margaret's engineering scorecard", () => {
  const c = E.scorecard([healthy, broken, unreadable, partial], [
    { id: "a1", name: "Bold Agent", status: "active", autonomy: 3, approval: "" },
    { id: "a2", name: "Careful Agent", status: "active", autonomy: 3, approval: "Khaneil approves each merge" },
    { id: "a3", name: "Unset Agent", status: "active", autonomy: "" },
  ], NOW);
  const row = (r) => c.rows.find((x) => x.repo === r);

  it("scores a clean repository 100 / A with no findings", () => {
    expect(row("example/healthy")).toMatchObject({ score: 100, grade: "A", findings: 0, not_read: "None" });
  });
  it("applies every matching rule, with evidence, to a broken repository", () => {
    const rules = c.findings.filter((f) => f.subject === "example/broken").map((f) => f.rule).sort();
    expect(rules).toEqual(["ci-failing", "ci-flaky", "code-scanning-off", "critical-alerts", "no-protection", "open-alerts", "secret-alerts", "stale-dependency-prs"].sort());
    expect(row("example/broken").score).toBe(0);
    expect(row("example/broken").grade).toBe("F");
  });
  it("never scores an unreadable repository and never shows its counts as zero", () => {
    expect(row("example/unreadable")).toMatchObject({ score: "", grade: "Not read", open_alerts: "Not read", high_critical: "Not read", ci_latest: "Not read" });
    expect(c.summary.scored).toBe(3);
  });
  it("marks a partly read repository as partial instead of a clean pass", () => {
    expect(row("example/partial").grade).toBe("A (partial)");
    expect(row("example/partial").not_read).toContain("Secret scanning: HTTP 404");
    expect(c.findings.some((f) => f.subject === "example/partial" && f.rule === "not-read")).toBe(true);
  });
  it("flags high autonomy without a written approval step, and a missing level", () => {
    const agentRules = c.findings.filter((f) => f.points === 0 && f.rule !== "not-read").map((f) => f.rule + ":" + f.subject);
    expect(agentRules).toEqual(expect.arrayContaining(["high-autonomy-no-approval:Bold Agent (a1)", "autonomy-missing:Unset Agent (a3)"]));
    expect(agentRules.some((r) => r.includes("Careful Agent"))).toBe(false);
  });
  it("ranks high priority first and marks every finding as a suggestion only", () => {
    const pri = c.findings.map((f) => f.priority);
    expect(pri.indexOf("Low")).toBeGreaterThan(pri.lastIndexOf("High"));
    expect(new Set(c.findings.map((f) => f.review_status))).toEqual(new Set([E.REVIEW]));
    expect(c.findings[0].rank).toBe(1);
  });
  it("writes a Markdown report and a CSV with every repository", () => {
    const m = E.scorecardMarkdown(c, { stamp: "23 Nov 2026", mode: "Run by hand" });
    for (const r of ["example/healthy", "example/broken", "example/unreadable"]) expect(m).toContain(r);
    expect(m).toContain("Not read");
    const t = E.csv(E.SCORE_COLS, c.rows);
    expect(t.trim().split("\n")).toHaveLength(5);
  });
});

const hRepo = (over) => ({
  repo: "example/active", project: "active", status: "active",
  repoInfo: { ok: true, default_branch: "main", pushed_at: ago(1), archived: false, open_issues_count: 4 },
  commits: { ok: true, count: 12, truncated: false, latest: ago(1) },
  pulls: { ok: true, open: [{ number: 7, draft: false, created_at: ago(3), updated_at: ago(1) }], merged30: 9 },
  release: { ok: true, latest: ago(10) },
  ci: { ok: true, runs: [run(0, "success")] },
  ...over,
});

describe("Samuel's repository health", () => {
  const h = E.repoHealth([
    hRepo({}),
    hRepo({ repo: "example/quiet", commits: { ok: true, count: 0, truncated: false, latest: null }, pulls: { ok: true, open: [{ number: 3, draft: false, created_at: ago(40), updated_at: ago(30) }, { number: 4, draft: true, created_at: ago(40), updated_at: ago(30) }], merged30: 0 }, release: { ok: true, latest: null }, ci: { ok: true, runs: [run(2, "failure")] } }),
    hRepo({ repo: "example/hidden", commits: { ok: false, error: "HTTP 409" }, pulls: { ok: false, error: "HTTP 403" } }),
    hRepo({ repo: "example/busy", commits: { ok: true, count: 100, truncated: true, latest: ago(0) }, release: { ok: true, latest: ago(200) }, repoInfo: { ok: true, default_branch: "main", pushed_at: ago(0), archived: false, open_issues_count: 31 } }),
  ], NOW);
  const f = (r) => h.facts.find((x) => x.repo === r);

  it("keeps verified facts for a healthy repository with no suggestions", () => {
    expect(f("example/active")).toMatchObject({ commits_30_days: "12", open_prs: 1, stale_prs: 0, merged_30_days: 9, open_issues: 3, not_read: "None", suggestions: 0 });
  });
  it("suggests fixes for a quiet repository with a red build and stale pull requests (drafts excluded)", () => {
    const rules = h.suggestions.filter((s) => s.subject === "example/quiet").map((s) => s.rule).sort();
    expect(rules).toEqual(["ci-red", "quiet-repo", "stale-prs"]);
    expect(f("example/quiet").stale_prs).toBe(1);
  });
  it("keeps unread facts as Not read, never zero, and does not call the repo quiet", () => {
    expect(f("example/hidden")).toMatchObject({ commits_30_days: "Not read", open_prs: "Not read", open_issues: "Not read" });
    expect(h.suggestions.filter((s) => s.subject === "example/hidden").map((s) => s.rule)).toEqual(["not-read"]);
  });
  it("says when the commit count was cut at one page, and flags old releases and big backlogs", () => {
    expect(f("example/busy").commits_30_days).toBe("100+ (first 100 read)");
    const rules = h.suggestions.filter((s) => s.subject === "example/busy").map((s) => s.rule).sort();
    expect(rules).toEqual(["issue-backlog", "no-release"]);
  });
  it("writes facts before suggestions in Markdown", () => {
    const m = E.healthMarkdown(h, { stamp: "23 Nov 2026", mode: "Run by hand" });
    expect(m.indexOf("## Verified facts")).toBeLessThan(m.indexOf("## Suggestions"));
    expect(m).toContain("example/hidden");
  });
});

describe("output keys", () => {
  it("are fixed per agent so each run adds a version, never a new item", () => {
    expect(E.FILES.scorecard.md.outputKey.startsWith("atlas-engineering-review:")).toBe(true);
    expect(E.FILES.health.md.outputKey.startsWith("repo-intelligence:")).toBe(true);
  });
});
