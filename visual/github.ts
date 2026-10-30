import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

// A stand-in for api.github.com, so the views render the same data on every run with no
// token and no network. Every repository in the catalog is answered as a public repository
// with a few commits and green CI, except the ones listed in FAILING, which keep one red run
// so failure styling stays covered by the screenshots.

export const NOW = Date.parse("2026-10-28T15:00:00Z");
const FAILING = new Set(["khaneilcampbell/benjaire.com"]);

const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function catalogRepos(): string[] {
  const dir = join(import.meta.dirname, "..", "catalog");
  const names = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml"))) {
    const doc = yaml.load(readFileSync(join(dir, f), "utf8")) as { project?: { repository?: string } };
    if (doc.project?.repository) names.add(doc.project.repository);
  }
  return [...names].sort();
}

const REPOS = catalogRepos();

function meta(fullName: string, i: number) {
  const [owner, name] = fullName.split("/");
  return {
    name,
    full_name: fullName,
    owner: { login: owner },
    private: false,
    visibility: "public",
    fork: false,
    archived: false,
    description: `${name} (sample data)`,
    html_url: `https://github.com/${fullName}`,
    homepage: null,
    language: "TypeScript",
    default_branch: "main",
    pushed_at: iso(30 + i * 45),
    stargazers_count: i,
    open_issues_count: i % 3,
    license: { spdx_id: "MIT", name: "MIT License" },
  };
}

function runs(fullName: string, i: number) {
  const failing = FAILING.has(fullName);
  return {
    total_count: 3,
    workflow_runs: [0, 1, 2].map((k) => ({
      id: 1000 * (i + 1) + k,
      run_attempt: 1,
      name: "CI",
      display_title: "CI",
      path: ".github/workflows/ci.yml",
      status: "completed",
      conclusion: failing && k === 0 ? "failure" : "success",
      head_branch: "main",
      event: "push",
      created_at: iso(40 + i * 45 + k * 180),
      html_url: `https://github.com/${fullName}/actions/runs/${1000 * (i + 1) + k}`,
    })),
  };
}

function commits(fullName: string, i: number) {
  return [0, 1, 2].map((k) => ({
    sha: `${(i + 1).toString(16)}${k}`.padEnd(40, "0"),
    html_url: `https://github.com/${fullName}/commit/${k}`,
    commit: { message: ["Tidy the README", "Fix the build", "Add a feature"][k], author: { name: "KC", date: iso(30 + i * 45 + k * 240) } },
  }));
}

// The agents the Manage view lists: each gets its own few runs, so the view shows schedule,
// manual and failed runs rather than generic CI.
const AGENT_WORKFLOWS: Record<string, { name: string; events: string[]; failed?: number }> = {
  "merge-flow.yml": { name: "Merge flow", events: ["schedule", "workflow_run", "schedule", "workflow_dispatch"] },
  "opportunity-scout.yml": { name: "Opportunity scout", events: ["push", "workflow_dispatch", "schedule"], failed: 1 },
};

function agentRuns(fullName: string, file: string) {
  const w = AGENT_WORKFLOWS[file];
  return {
    total_count: w.events.length,
    workflow_runs: w.events.map((event, k) => ({
      id: 9000 + k,
      run_attempt: 1,
      name: w.name,
      path: `.github/workflows/${file}`,
      status: "completed",
      conclusion: w.failed === k ? "failure" : "success",
      head_branch: "main",
      event,
      created_at: iso(50 + k * 300),
      html_url: `https://github.com/${fullName}/actions/runs/${9000 + k}`,
    })),
  };
}

function workflows(fullName: string) {
  const files = ["ci.yml", ...Object.keys(AGENT_WORKFLOWS)];
  return {
    total_count: files.length,
    workflows: files.map((f, i) => ({ id: 500 + i, path: `.github/workflows/${f}`, state: "active", html_url: `https://github.com/${fullName}/actions/workflows/${f}` })),
  };
}

/** The JSON GitHub would answer for an API path, or null for a 404. */
export function answer(path: string): unknown {
  const url = new URL(path, "https://api.github.com");
  const p = url.pathname;
  if (/^\/users\/[^/]+\/repos$/.test(p)) return REPOS.map(meta);
  const m = p.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  if (!m) return null;
  const i = REPOS.findIndex((r) => r.toLowerCase() === m[1].toLowerCase());
  if (i < 0) return null;
  const full = REPOS[i];
  const rest = m[2] ?? "";
  if (rest === "") return meta(full, i);
  if (rest === "/languages") return { TypeScript: 8000, CSS: 1500, HTML: 300 };
  if (rest === "/commits") return commits(full, i);
  if (rest === "/actions/workflows") return workflows(full);
  const agent = /^\/actions\/workflows\/([^/]+)\/runs$/.exec(rest);
  if (agent && AGENT_WORKFLOWS[agent[1]]) return agentRuns(full, agent[1]);
  if (rest === "/actions/runs" || agent) return runs(full, i);
  if (rest === "/pulls") return [];
  return null;
}
