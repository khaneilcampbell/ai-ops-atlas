// SAMPLE data for the Insights and Engineering review screenshots only. The app never reads this
// file; in the real Mac app these objects come from the Rust side (intel_reports, review_report),
// which reads GitHub with GET requests. Shapes mirror src/intel/types.ts.
import type { AgentStatus, EcoReport, Facts, Report } from "../src/intel/types";

const AT = "2026-10-28T14:55:00Z";
const ATLAS = "khaneilcampbell/ai-ops-atlas";
const COMMERCE = "khaneilcampbell/multi-agent-commerce-pipeline";
const BENJAIRE = "khaneilcampbell/benjaire.com";

function facts(repo: string, over: Partial<Facts> = {}): Facts {
  const url = `https://github.com/${repo}`;
  return {
    full_name: repo,
    url,
    description: "Sample repository",
    homepage: null,
    visibility: "public",
    default_branch: "main",
    archived: false,
    fork: false,
    empty: false,
    head_sha: "65d9a0c",
    created_at: "2026-10-01T00:00:00Z",
    pushed_at: AT,
    languages: [{ name: "TypeScript", percent: 78 }, { name: "Rust", percent: 20 }],
    stack: ["React", "Vite", "Tauri"],
    agent_signals: ["anthropic"],
    root_files: ["README.md", "package.json", "docs/", "SECURITY.md"],
    activity: { commits_sampled: 30, commits_last_30d: 30, last_commit_at: AT, authors: ["Khaneil"], recent: [{ sha: "65d9a0c1", message: "Financial District interiors", author: "Khaneil", date: AT, url: `${url}/commit/65d9a0c1` }], branches: 40, open_prs: 20, pr_titles: [] },
    releases: { state: "assessed", data: [] },
    issues: { state: "assessed", data: { open: 3, recent: [] } },
    ci: { state: "passing", workflows: [{ run_id: 9001, name: "CI", status: "completed", conclusion: "success", branch: "main", at: AT, url: `${url}/actions/runs/9001` }], note: null },
    docs: { readme: true, readme_chars: 9000, license: "Other", contributing: false, changelog: true, docs_dir: true, security_policy: true },
    security: {
      dependabot: { state: "assessed", data: { open: 1, by_severity: { medium: 1 }, top: [{ number: 17, severity: "medium", subject: "minimatch", summary: "minimatch has potential denial of service via globparts amplification", url: `${url}/security/dependabot/17` }] } },
      code_scanning: { state: "assessed", data: { open: 0, by_severity: {}, top: [] } },
    },
    collected_at: AT,
    github_requests: 14,
    ...over,
  };
}

export const atlasReport: Report = {
  repo: ATLAS,
  facts: facts(ATLAS),
  findings: [{ id: "alert:dependabot:17", category: "security", severity: "medium", title: "Dependabot alert #17: minimatch", detail: "minimatch has potential denial of service via globparts amplification", url: `https://github.com/${ATLAS}/security/dependabot/17` }],
  ai: {
    summary: "Sample: a heavily developed single-author TypeScript/Tauri app with strong docs, a large PR backlog and one open medium Dependabot alert.",
    purpose: "A personal command center that shows AI agents, projects and repositories as a 3D city.",
    architecture: "",
    maturity: "active_development",
    implementation_status: "Feature-rich and working.",
    technologies: ["React", "Tauri"],
    agent_integrations: [],
    health: [{ area: "security", rating: "fair", rationale: "One medium alert is open.", evidence: ["alert:dependabot:17"], grounded: true }],
    maintenance_issues: [],
    documentation_gaps: [],
    technical_debt: [],
    security_observations: [],
    recommendations: [{ priority: "high", title: "Upgrade minimatch", rationale: "Closes the open medium alert.", evidence: ["alert:dependabot:17", "file:package.json"], grounded: true }],
    insufficient_data: false,
    data_gaps: [],
  },
  ai_state: "analyzed",
  analyzed_at: AT,
  analysis_run_id: "run-1",
  model: "claude-sonnet",
  depth: "standard",
  fingerprint: "x",
  validation: null,
  updated_at: AT,
  run_id: "run-1",
  context: { project: "Atlas", agents: [] },
  note: null,
};

export const ecoReport: EcoReport = {
  repos: [
    { repo: ATLAS, source: "intel_report", facts: facts(ATLAS), checks: null, findings: atlasReport.findings, error: null },
    { repo: COMMERCE, source: "collected", facts: facts(COMMERCE, { security: { dependabot: { state: "assessed", data: { open: 0, by_severity: {}, top: [] } }, code_scanning: { state: "not_assessed", reason: "code scanning is not enabled" } } }), checks: null, findings: [], error: null },
    { repo: BENJAIRE, source: "unavailable", facts: null, checks: null, findings: [], error: "GitHub returned 403 for this repository" },
  ],
  context: {
    projects: [{ id: "commerce", name: "Commerce Pipeline", repository: COMMERCE, status: "active" }],
    agents: [
      { id: "commerce-loop", name: "Commerce Loop", project: "Commerce Pipeline", repository: COMMERCE, kind: "autonomous", autonomy: 3, autonomy_note: null, trigger: null, permissions: [], telemetry: false, status: "active", approval: null, risk: null },
      { id: "benjaire-contact-worker", name: "Contact Worker", project: "Benjaire", repository: BENJAIRE, kind: "worker", autonomy: 3, autonomy_note: null, trigger: null, permissions: [], telemetry: false, status: "active", approval: null, risk: null },
    ],
  },
  review: {
    summary: "Sample review: the biggest risk is the commerce loop's broad credentials; dependency health is good with one open medium alert.",
    scorecard: [
      { area: "security", rating: "fair", rationale: "Alerts are few but the commerce loop holds broad credentials.", evidence: ["agent:commerce-loop"], grounded: true },
      { area: "reliability", rating: "fair", rationale: "Most repos show passing CI.", evidence: [], grounded: false },
      { area: "dependencies", rating: "good", rationale: "One medium alert open.", evidence: ["alert:ai-ops-atlas:dependabot:17"], grounded: true },
      { area: "tooling", rating: "unknown", rationale: "Not enough data on which GitHub-native features are enabled.", evidence: [], grounded: false },
    ],
    top_risks: [
      { title: "Root-level commerce loop with broad credentials", severity: "high", why: "A bug could spend money without approval.", repos: [COMMERCE], evidence: ["agent:commerce-loop", `repo:${COMMERCE}`], grounded: true },
      { title: "Open minimatch DoS advisory", severity: "medium", why: "A known medium advisory remains open.", repos: [ATLAS], evidence: ["alert:ai-ops-atlas:dependabot:17"], grounded: true },
    ],
    recommendations: [
      { priority: "now", category: "security", title: "Reduce blast radius of the commerce VPS credentials", rationale: "One compromise could spend money or email customers.", first_step: "Move commerce-loop to a non-root user with a least-privilege .env.", effort: "a_day", owner: "commerce-loop", repos: [COMMERCE], evidence: ["agent:commerce-loop", `repo:${COMMERCE}`], grounded: true },
      { priority: "now", category: "autonomy", title: "Add kill switches and caps to L3 agents", rationale: "Autonomous agents that email or spend money have no recorded stop control.", first_step: "Add a documented kill switch to each L3 agent.", effort: "hours", owner: "Khaneil", repos: [], evidence: ["agent:benjaire-contact-worker", "agent:commerce-loop"], grounded: true },
      { priority: "next", category: "dependencies", title: "Upgrade minimatch", rationale: "Closes the open advisory.", first_step: "Run npm update minimatch.", effort: "hours", repos: [ATLAS], evidence: ["alert:ai-ops-atlas:dependabot:17", "made-up:ref"], grounded: true },
    ],
    tools: [],
    autonomy_notes: [],
    quick_wins: [],
    data_gaps: ["Branch protection could not be read for benjaire.com."],
  },
  state: "analyzed",
  analyzed_at: AT,
  analysis_run_id: "rev-1",
  model: "claude-sonnet",
  depth: "standard",
  fingerprint: "y",
  validation: null,
  updated_at: AT,
  run_id: "rev-1",
  github_requests: 40,
  reused_facts: 1,
  note: null,
};

const schedule = { enabled: false, days: [], at: "09:00", consent_at: null };
export const intelStatus: AgentStatus = {
  id: "repo-intelligence",
  name: "Repository Intelligence Analyst",
  version: "1",
  prompt_version: "1",
  config: {
    depth: "standard",
    models: { quick: "claude-haiku", standard: "claude-sonnet", deep: "claude-opus" },
    pricing: {},
    max_run_usd: 0.6,
    monthly_budget_usd: 5,
    timeout_secs: 120,
    max_attempts: 2,
    refusal_fallback: false,
    schedule,
    assigned: [],
    review: { depth: "standard", max_run_usd: 0.6, schedule },
  },
  key_present: true,
  active: [],
  runs: [],
  month_spent_usd: 0.4,
};

// Same id as recKey in src/intel/links.ts (kept here so "before" screenshots run on older code too).
export function recKey(title: string, repo: string): string {
  const text = `${title.replace(/\s+/g, " ").trim().toLowerCase()}|${repo.trim().toLowerCase()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Issues Khaneil "already created" from earlier reviews, so the screenshots show tracked states.
const vpsKey = recKey("Reduce blast radius of the commerce VPS credentials", COMMERCE);
const minimatchKey = recKey("Upgrade minimatch", ATLAS);
const issue = (repo: string, number: number, title: string, key: string, state: "open" | "closed") => ({
  number,
  title,
  body: `Sent from Atlas\n<!-- atlas-rec:${key} -->`,
  state,
  state_reason: state === "closed" ? "completed" : null,
  html_url: `https://github.com/${repo}/issues/${number}`,
  created_at: "2026-10-27T12:00:00Z",
});

/** Answers the read-only issue and timeline GETs the tracking makes; null for anything else. */
export function trackingAnswer(path: string): unknown {
  if (path.startsWith(`/repos/${ATLAS}/issues?labels=claude-fix`)) return [issue(ATLAS, 236, `Fix: Reduce blast radius of the commerce VPS credentials (${COMMERCE})`, vpsKey, "closed")];
  if (path.startsWith(`/repos/${ATLAS}/issues?`)) return [issue(ATLAS, 240, "Upgrade minimatch", minimatchKey, "open")];
  if (path.startsWith(`/repos/${ATLAS}/issues/236/timeline`))
    return [{ event: "cross-referenced", source: { issue: { number: 31, html_url: `https://github.com/${COMMERCE}/pull/31`, state: "closed", pull_request: { merged_at: "2026-10-28T10:00:00Z" }, repository: { full_name: COMMERCE } } } }];
  if (/^\/repos\/[^/]+\/[^/]+\/issues(\?|\/\d+\/timeline)/.test(path)) return [];
  return null;
}
