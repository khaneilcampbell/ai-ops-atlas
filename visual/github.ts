import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
  if (rest === "/actions/runs" || /^\/actions\/workflows\/[^/]+\/runs$/.test(rest)) return runs(full, i);
  if (rest === "/pulls") return [];
  if (rest.startsWith("/contents")) return contents(full, decodeURIComponent(rest.slice("/contents".length).replace(/^\//, "")));
  return null;
}

/** A small file tree for the editor: a README and a docs folder everywhere, the real catalog in Atlas. */
export const SAMPLE_README = "# Sample project\n\nA short description of the project.\n\n## Setup\n\n1. Install the tools.\n2. Run the checks.\n";

function fileEntry(full: string, path: string, text: string) {
  return {
    type: "file",
    name: path.split("/").pop(),
    path,
    size: Buffer.byteLength(text),
    sha: createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex"),
    encoding: "base64",
    content: Buffer.from(text).toString("base64"),
    html_url: `https://github.com/${full}/blob/main/${path}`,
  };
}

function contents(full: string, path: string): unknown {
  const files: Record<string, string> = { "README.md": SAMPLE_README, "docs/setup.md": "# Setup\n\nSteps go here.\n", "package.json": '{ "name": "sample" }\n' };
  if (full === "khaneilcampbell/ai-ops-atlas") {
    const dir = join(import.meta.dirname, "..", "catalog");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml"))) files[`catalog/${f}`] = readFileSync(join(dir, f), "utf8");
  }
  if (files[path] !== undefined) return fileEntry(full, path, files[path]);
  const prefix = path ? `${path}/` : "";
  const names = new Map<string, "file" | "dir">();
  for (const f of Object.keys(files).filter((f) => f.startsWith(prefix))) {
    const [head, ...more] = f.slice(prefix.length).split("/");
    names.set(head, more.length ? "dir" : "file");
  }
  if (!names.size) return null;
  return [...names].map(([name, type]) => (type === "file" ? { ...fileEntry(full, prefix + name, files[prefix + name]), content: undefined } : { type, name, path: prefix + name, size: 0, sha: "0".repeat(40) }));
}
