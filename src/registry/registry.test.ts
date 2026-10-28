import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog, parseManifest } from "../catalog/parse";
import { SCHEMAS, type Agent, type ManifestIssue } from "../catalog/types";
import { AUTONOMY_LEVELS, CATEGORIES, CLASSIFICATIONS, CONFIDENCES, KPI_MEASURES, RISK_LEVELS, SENSITIVITIES, TRIGGER_TYPES } from "./types";
import type { RepoSnapshot, RepoState, WorkflowRun } from "../github/types";
import type { AgentStatus, Run } from "../intel/types";
import { documentationScore, toProfile } from "./profile";
import { buildRegistry, EMPTY_FILTER, filterEntries, groupEntries, sortEntries, summarize } from "./registry";
import { meetsTarget, observeKpi, operationalState, successTrend, telemetryFor } from "./telemetry";

const dir = join(__dirname, "../../catalog");
const files = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
);

const parse = (text: string) => {
  const issues: ManifestIssue[] = [];
  return { ...parseManifest("t.yaml", text, issues), issues };
};

const V1 = `
schema: atlas/v1
project: { id: demo, name: Demo, summary: s, status: active, repository: me/demo }
agents:
  - { id: a1, name: Old Name, purpose: Does a thing, framework: Python script, status: idle, trigger: Manual, source: run.py }
`;

const run = (conclusion: string | null, createdAt: string, status = "completed"): WorkflowRun => ({ name: "CI", status, conclusion, branch: "main", event: "push", createdAt, url: `https://x/${createdAt}` });
const snapshot = (runs: WorkflowRun[]): RepoSnapshot =>
  ({ workflowRuns: { "ci.yml": runs }, runs, fetchedAt: "2026-10-27T00:00:00Z" }) as unknown as RepoSnapshot;
const ciAgent = { id: "ci", name: "CI", purpose: "p", framework: "GitHub Actions", status: "active", lastRun: null, history: [], links: [], projectId: "demo", repository: "me/demo", observe: { githubWorkflow: "ci.yml" } } as Agent;

describe("bundled registry", () => {
  const { catalog, issues } = buildCatalog(files);
  const entries = buildRegistry(catalog, {}, null);

  it("keeps all 10 projects and 40 agents discoverable with no manifest problems", () => {
    expect(issues).toEqual([]);
    expect(catalog.projects).toHaveLength(10);
    expect(entries).toHaveLength(40);
  });

  it("classifies every registered item", () => {
    const s = summarize(entries);
    expect(s.byClass).toEqual({ A: 9, B: 5, C: 15, D: 10, E: 1, F: 0, unclassified: 0 });
    expect(entries.every((e) => e.profile.category !== "uncategorized")).toBe(true);
  });

  it("keeps stable ids and the original name when a display title is set", () => {
    const ci = entries.find((e) => e.profile.id === "atlas-ci")!.profile;
    expect(ci.title).toBe("Atlas Continuous Integration");
    expect(ci.originalName).toBe("Atlas CI");
    expect(catalog.agents.find((a) => a.id === "atlas-ci")?.observe?.githubWorkflow).toBe("ci.yml");
  });

  it("never claims a verified run without telemetry", () => {
    expect(summarize(entries).operational.verified).toBe(0);
    expect(entries.every((e) => e.telemetry.lastVerifiedRun === null)).toBe(true);
  });

  it("does not grant execution autonomy to anything Atlas runs", () => {
    const intel = entries.find((e) => e.profile.id === "repo-intelligence")!;
    expect(intel.profile.governance.autonomy).toBe(1);
  });

  it("keeps Atlas's write actions at approval required", () => {
    for (const id of ["atlas-rerun-failed", "atlas-merge-pr"]) {
      const action = entries.find((e) => e.profile.id === id)!;
      expect(action.profile.governance.autonomy).toBe(2);
      expect(action.profile.governance.approval).toBeTruthy();
      expect(action.profile.governance.permissions.length).toBeGreaterThan(0);
    }
    expect(entries.filter((e) => (e.profile.governance.autonomy ?? 0) >= 2 && e.profile.repository === "khaneilcampbell/ai-ops-atlas").map((e) => e.profile.id)).toEqual(["atlas-rerun-failed", "atlas-merge-pr"]);
  });
});

describe("schema and migration", () => {
  it("migrates an atlas/v1 agent to a full profile with undocumented fields left empty", () => {
    const r = parse(V1);
    expect(r.issues).toEqual([]);
    const p = toProfile(r.agents[0], r.projects[0]);
    expect(p.schema).toBe("v1");
    expect(p.title).toBe("Old Name");
    expect(p.originalName).toBeNull();
    expect(p.classification).toBe("unclassified");
    expect(p.category).toBe("uncategorized");
    expect(p.mission.purpose).toBe("Does a thing");
    expect(p.governance.autonomy).toBeNull();
    expect(p.governance.risk).toBeNull();
    expect(p.goals.kpis).toEqual([]);
    expect(p.execution.trigger).toBe("Manual");
    expect(p.execution.triggerType).toBeNull();
    expect(documentationScore(p).done).toBe(0);
  });

  it("rejects a registry block in an atlas/v1 manifest", () => {
    const r = parse(V1.replace("source: run.py }", "source: run.py, registry: { category: data } }"));
    expect(r.issues.map((i) => i.message)).toEqual([expect.stringContaining('needs schema "atlas/v2"')]);
    expect(r.agents[0].registry).toBeUndefined();
  });

  it("parses a v2 registry block and reports bad values without guessing", () => {
    const r = parse(`
schema: atlas/v2
project: { id: demo, name: Demo, summary: s, status: active, repository: me/demo }
agents:
  - id: a1
    name: Old Name
    purpose: p
    framework: CrewAI
    status: idle
    registry:
      title: New Title
      category: marketing
      classification: { type: A, confidence: sure }
      governance: { autonomy: 7, risk: low }
      goals:
        kpis:
          - { name: Uptime, target_value: 99, measure: run_success_rate }
          - { name: Cost, target_value: "5" , direction: max }
      colour: green
`);
    const msgs = r.issues.map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("registry.category"),
        expect.stringContaining("classification.confidence"),
        expect.stringContaining("governance.autonomy"),
        expect.stringContaining("kpis[0].direction"),
        expect.stringContaining("kpis[1].target_value"),
        expect.stringContaining("registry.colour"),
      ]),
    );
    const a = r.agents[0];
    expect(a.name).toBe("New Title");
    expect(a.originalName).toBe("Old Name");
    const p = toProfile(a, r.projects[0]);
    expect(p.category).toBe("uncategorized");
    expect(p.classification).toBe("A");
    expect(p.confidence).toBe("unverified");
    expect(p.governance.autonomy).toBeNull();
    expect(p.governance.risk).toBe("low");
  });

  it("accepts v1 and v2 manifests side by side", () => {
    const { catalog, issues } = buildCatalog({ "a.yaml": V1, "b.yaml": V1.replace("atlas/v1", "atlas/v2").replace(/demo/g, "demo2").replace("a1", "a2") });
    expect(issues).toEqual([]);
    expect(catalog.agents.map((a) => a.id)).toEqual(["a1", "a2"]);
  });
});

describe("telemetry", () => {
  it("separates configured from verified", () => {
    const t = telemetryFor(ciAgent, undefined, null);
    expect(t.source).toBe("github");
    expect(t.loaded).toBe(false);
    expect(operationalState({ classification: "D" }, t)).toBe("configured");
  });

  it("verifies from a successful run and flags a failing latest run", () => {
    const ok = telemetryFor(ciAgent, snapshot([run("success", "2026-10-26T00:00:00Z")]), null);
    expect(operationalState({ classification: "D" }, ok)).toBe("verified");
    const bad = telemetryFor(ciAgent, snapshot([run("failure", "2026-10-27T00:00:00Z"), run("success", "2026-10-26T00:00:00Z")]), null);
    expect(operationalState({ classification: "D" }, bad)).toBe("failing");
    expect(bad.lastVerifiedRun?.at).toBe("2026-10-26T00:00:00Z");
    expect(bad.successRate).toBe(0.5);
  });

  it("takes status from the default branch, keeping pull request runs in the history", () => {
    const pr = { ...run("failure", "2026-10-28T00:00:00Z"), event: "pull_request", branch: "dependabot/npm_and_yarn/eslint-10" };
    const snap = { ...snapshot([pr, run("success", "2026-10-27T00:00:00Z")]), defaultBranch: "main" } as RepoSnapshot;
    const t = telemetryFor(ciAgent, snap, null);
    expect(operationalState({ classification: "D" }, t)).toBe("verified");
    expect(t.executions).toHaveLength(2);
    expect(t.executions[0].offMainline).toBe(true);
    expect(t.failures).toBe(0);
    expect(t.successRate).toBe(1);
    expect(t.lastAnyRun?.at).toBe("2026-10-27T00:00:00Z");
    // A failure on the default branch still shows as failing.
    const broken = { ...snap, workflowRuns: { "ci.yml": [pr, run("failure", "2026-10-27T12:00:00Z")] } } as RepoSnapshot;
    expect(operationalState({ classification: "D" }, telemetryFor(ciAgent, broken, null))).toBe("failing");
  });

  it("ignores in-progress runs in the success rate", () => {
    const t = telemetryFor(ciAgent, snapshot([run(null, "2026-10-27T00:00:00Z", "in_progress"), run("success", "2026-10-26T00:00:00Z")]), null);
    expect(t.successRate).toBe(1);
  });

  it("reads the app's own run log for agents that run inside Atlas", () => {
    const intelAgent = { ...ciAgent, observe: { atlasIntel: true } } as Agent;
    const runs = [
      { status: "succeeded", queued_at: "2026-10-27T01:00:00Z", started_at: null, finished_at: "2026-10-27T01:02:00Z", duration_ms: 120_000, cost_usd: 0.05, repo: "me/demo", trigger: "manual", model: "m" },
      { status: "failed", queued_at: "2026-10-26T01:00:00Z", started_at: null, finished_at: "2026-10-26T01:01:00Z", duration_ms: 60_000, cost_usd: null, repo: "me/demo", trigger: "manual", model: "m" },
    ] as Run[];
    const t = telemetryFor(intelAgent, undefined, runs, { month: 1.25, budget: 5 });
    expect(t.source).toBe("atlas-intel");
    expect(t.avgDurationMs).toBe(90_000);
    expect(t.monthSpendUsd).toBe(1.25);
    expect(observeKpi({ name: "d", kind: "quality", target: null, targetValue: null, direction: null, basis: null, measure: "avg_duration_minutes" }, t)?.display).toBe("1.5 min");
  });

  it("only reports observed KPI values that telemetry supplies", () => {
    const empty = telemetryFor(ciAgent, undefined, null);
    const kpi = { name: "Success", kind: "reliability" as const, target: "≥ 90%", targetValue: 90, direction: "min" as const, basis: null, measure: "run_success_rate" as const };
    expect(observeKpi(kpi, empty)).toBeNull();
    expect(observeKpi({ ...kpi, measure: null }, empty)).toBeNull();
    const t = telemetryFor(ciAgent, snapshot([run("success", "2026-10-27T00:00:00Z"), run("failure", "2026-10-26T00:00:00Z")]), null);
    const o = observeKpi(kpi, t)!;
    expect(o.display).toBe("50%");
    expect(meetsTarget(kpi, o.value)).toBe(false);
    expect(meetsTarget({ ...kpi, targetValue: null }, o.value)).toBeNull();
  });

  it("needs enough history before showing a trend", () => {
    const few = telemetryFor(ciAgent, snapshot([run("success", "2026-10-27T00:00:00Z")]), null);
    expect(successTrend(few)).toBeNull();
    const days = ["27", "26", "25", "24", "23", "22"].map((d) => `2026-10-${d}T00:00:00Z`);
    const up = telemetryFor(ciAgent, snapshot(days.map((d, i) => run(i < 3 ? "success" : "failure", d))), null);
    expect(successTrend(up)).toBe("up");
  });

  it("reads pipeline phases from the run feed for agents that opt in", () => {
    const seo = { ...ciAgent, id: "seo-maintainer", observe: { agentFeed: true } } as Agent;
    const feedRun = (id: number, status: "ok" | "failed" | "skipped" | "paused", at: string, agents = ["seo-maintainer"]) => ({ id, project: "commerce-pipeline", agents, phase: "Phase 6: SEO", status, detail: "", at });
    expect(telemetryFor(seo, undefined, null)).toMatchObject({ source: "agent-feed", loaded: false, executions: [] });
    const t = telemetryFor(seo, undefined, null, null, [
      feedRun(3, "paused", "2026-10-28T03:00:00Z"),
      feedRun(2, "failed", "2026-10-28T02:00:00Z"),
      feedRun(1, "ok", "2026-10-28T01:00:00Z"),
      feedRun(4, "ok", "2026-10-28T04:00:00Z", ["health-report"]),
    ]);
    expect(t.executions.map((e) => e.result)).toEqual(["other", "failure", "success"]);
    expect(t.lastVerifiedRun?.at).toBe("2026-10-28T01:00:00Z");
    expect(t.successRate).toBe(0.5);
    expect(operationalState({ classification: "C" }, t)).toBe("failing");
  });
});

describe("directory", () => {
  const { catalog } = buildCatalog(files);
  const repos: Record<string, RepoState> = {
    "khaneilcampbell/ai-ops-atlas": { kind: "ok", stale: false, data: snapshot([run("success", "2026-10-27T00:00:00Z")]) },
  };
  const intel = { runs: [], month_spent_usd: 0, config: { monthly_budget_usd: 5 } } as unknown as AgentStatus;
  const entries = buildRegistry(catalog, repos, intel);

  it("filters by function, type, project and search", () => {
    expect(filterEntries(entries, { ...EMPTY_FILTER, category: "security" }).map((e) => e.profile.id).sort()).toEqual(
      ["bruteforce-detection", "security-check", "service-desk-codeql", "soc-case-notes"].sort(),
    );
    expect(filterEntries(entries, { ...EMPTY_FILTER, classification: "A", project: "commerce-pipeline" })).toHaveLength(6);
    expect(filterEntries(entries, { ...EMPTY_FILTER, query: "website quality" }).map((e) => e.profile.id)).toEqual(["site-audit"]);
    expect(filterEntries(entries, { ...EMPTY_FILTER, operational: "verified" }).map((e) => e.profile.id)).toEqual(["atlas-ci"]);
  });

  it("groups by agent type in type order and by project", () => {
    const g = groupEntries(entries, "classification");
    expect(g.map((x) => x.key)).toEqual(["A", "B", "C", "D", "E"]);
    expect(groupEntries(entries, "project").reduce((n, x) => n + x.entries.length, 0)).toBe(40);
  });

  it("sorts verified runs first and keeps the rest stable by title", () => {
    const s = sortEntries(entries, "lastRun");
    expect(s[0].profile.id).toBe("atlas-ci");
    const t = sortEntries(entries, "title").map((e) => e.profile.title);
    expect(t).toEqual([...t].sort((a, b) => a.localeCompare(b)));
  });

  it("lists items that need review with a reason", () => {
    const s = summarize(entries);
    const loop = s.needsReview.find((e) => e.profile.id === "commerce-loop");
    expect(loop?.review).toContain("High risk");
    // Every classification is verified and every agent that acts on external systems documents its permissions.
    const reasons = s.needsReview.flatMap((e) => e.review);
    expect(reasons.filter((r) => r.startsWith("Classification is") || r.includes("no permissions"))).toEqual([]);
    expect(s.observable).toBe(29);
  });
});

describe("JSON Schema for editors", () => {
  const schema = JSON.parse(readFileSync(join(dir, "schema/atlas-v2.schema.json"), "utf8"));
  const reg = schema.properties.agents.items.properties.registry;

  it("matches the enums the parser accepts", () => {
    expect(schema.properties.schema.enum).toEqual([...SCHEMAS]);
    expect(reg.properties.category.enum).toEqual([...CATEGORIES]);
    expect(reg.properties.classification.properties.type.enum).toEqual([...CLASSIFICATIONS]);
    expect(reg.properties.classification.properties.confidence.enum).toEqual([...CONFIDENCES]);
    expect(reg.properties.execution.properties.trigger_type.enum).toEqual([...TRIGGER_TYPES]);
    expect(reg.properties.governance.properties.autonomy.enum).toEqual([...AUTONOMY_LEVELS]);
    expect(reg.properties.governance.properties.risk.enum).toEqual([...RISK_LEVELS]);
    expect(reg.properties.governance.properties.data_sensitivity.enum).toEqual([...SENSITIVITIES]);
    expect(reg.properties.goals.properties.kpis.items.properties.measure.enum).toEqual([...KPI_MEASURES]);
  });

  it("lists exactly the registry fields the parser reads", () => {
    const r = parse(`
schema: atlas/v2
project: { id: demo, name: Demo, summary: s, status: active, repository: me/demo }
agents:
  - id: a1
    name: A
    purpose: p
    framework: f
    status: idle
    registry: { ${Object.keys(reg.properties)
      .map((k) => `${k}: null`)
      .join(", ")} }
`);
    expect(r.issues).toEqual([]);
  });
});
