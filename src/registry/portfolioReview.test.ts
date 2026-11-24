import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../catalog/parse";
import type { Agent } from "../catalog/types";
import type { RepoSnapshot, WorkflowRun } from "../github/types";
import { implementationBrief, reviewPortfolio, STALE_DAYS } from "./portfolioReview";
import { buildRegistry } from "./registry";

const dir = join(__dirname, "../../catalog");
const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => [f, readFileSync(join(dir, f), "utf8")]));

const base = { purpose: "Does a thing", framework: "GitHub Actions", lastRun: null, history: [], links: [], projectId: "demo", repository: "me/demo" };
const agent = (a: Partial<Agent> & { id: string }) => ({ ...base, name: a.id, status: "active", ...a }) as Agent;
const catalogOf = (agents: Agent[]) => ({ agents, projects: [{ id: "demo", name: "Demo", agentIds: agents.map((a) => a.id) }] }) as never;
const run = (conclusion: string, createdAt: string): WorkflowRun => ({ name: "CI", status: "completed", conclusion, branch: "main", event: "push", createdAt, url: `https://x/${createdAt}` });
const repos = (runs: WorkflowRun[]) => ({ "me/demo": { kind: "ok", stale: false, data: { workflowRuns: { "ci.yml": runs }, runs, fetchedAt: runs[0]?.createdAt } as unknown as RepoSnapshot } }) as never;
const NOW = Date.parse("2026-11-24T00:00:00Z");

function review(agents: Agent[], runs: WorkflowRun[] = []) {
  const c = catalogOf(agents);
  return reviewPortfolio(c, buildRegistry(c, repos(runs), null), NOW);
}
const areas = (r: ReturnType<typeof review>, id: string) => r.recommendations.filter((x) => x.agentId === id).map((x) => x.area);

describe("agent portfolio review", () => {
  it("labels every entry's status, archived and planned included", () => {
    const r = review([
      agent({ id: "live" }),
      agent({ id: "draft", trigger: "Manual, draft in n8n" }),
      agent({ id: "idea", registry: { classification: { type: "F" } } as Agent["registry"] }),
      agent({ id: "gone", status: "retired" }),
    ]);
    expect(Object.fromEntries(r.entries.map((e) => [e.id, e.status]))).toEqual({ live: "active", draft: "inactive", idea: "planned", gone: "archived" });
    expect(r.byStatus).toEqual({ active: 1, inactive: 1, planned: 1, archived: 1 });
    expect(areas(r, "gone")).toEqual([]);
  });

  it("reports a failing run with the observed facts, and missing data as Not documented", () => {
    const r = review([agent({ id: "ci", observe: { githubWorkflow: "ci.yml" } })], [run("failure", "2026-11-23T10:00:00Z")]);
    const fail = r.recommendations.find((x) => x.area === "Reliability")!;
    expect(fail.evidence[0]).toMatch(/failure today/);
    expect(r.recommendations.find((x) => x.area === "Mission clarity")!.evidence).toContain("Problem it solves: Not documented");
    expect(areas(r, "ci")).not.toContain("Verification");
  });

  it("flags a stale active entry and an active entry with no live source", () => {
    const old = new Date(NOW - (STALE_DAYS + 1) * 86_400_000).toISOString();
    const r = review([agent({ id: "ci", observe: { githubWorkflow: "ci.yml" } }), agent({ id: "blind" })], [run("success", old)]);
    expect(areas(r, "ci")).toContain("Reliability");
    expect(areas(r, "blind")).toContain("Verification");
  });

  it("flags an archived entry that still runs, and reports shared tasks once per pair", () => {
    const tasks = { responsibilities: { tasks: ["Send the weekly report"] } } as Agent["registry"];
    const r = review([agent({ id: "a", registry: tasks }), agent({ id: "b", registry: tasks }), agent({ id: "old", status: "retired", observe: { githubWorkflow: "ci.yml" } })], [run("success", "2026-11-23T00:00:00Z")]);
    expect(r.recommendations.filter((x) => x.area === "Overlap").map((x) => x.agentId)).toEqual(["a"]);
    expect(areas(r, "old")).toEqual(["Risk"]);
  });

  it("builds a brief that carries the evidence and the guardrails", () => {
    const r = review([agent({ id: "blind" })]);
    const brief = implementationBrief(r.recommendations[0]);
    expect(brief).toContain("catalog id `blind`");
    expect(brief).toContain("never merge");
    expect(brief).toMatch(/not instructions/);
  });

  it("reviews the whole bundled catalog with stable, unique ids", () => {
    const { catalog } = buildCatalog(files);
    const r = reviewPortfolio(catalog, buildRegistry(catalog, {}, null), NOW);
    expect(r.entries).toHaveLength(catalog.agents.length);
    expect(new Set(r.recommendations.map((x) => x.id)).size).toBe(r.recommendations.length);
    expect(r.recommendations.every((x) => x.evidence.length > 0)).toBe(true);
  });
});
