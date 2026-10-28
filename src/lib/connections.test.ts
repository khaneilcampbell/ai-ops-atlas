import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../catalog/parse";
import type { Catalog } from "../catalog/types";
import type { RepoSnapshot } from "../github/types";
import { buildConnections } from "./connections";

const NOW = Date.parse("2026-10-28T00:00:00Z");
const snap = (over: Partial<RepoSnapshot> = {}): RepoSnapshot => ({
  fullName: "me/a", description: null, url: "", homepage: null, language: null, languages: {}, visibility: "public",
  defaultBranch: "main", pushedAt: null, stars: 0, openIssues: 0, license: null, archived: false,
  commits: [], runs: [], workflowRuns: {}, fetchedAt: "2026-10-27T20:00:00Z", ...over,
});
const run = (conclusion: string, createdAt = "2026-10-26T00:00:00Z") => ({ name: "CI", status: "completed", conclusion, branch: "main", event: "push", createdAt, url: "" });
const agent = (id: string, projectId: string, over: Partial<Catalog["agents"][number]> = {}): Catalog["agents"][number] => ({
  id, name: id.toUpperCase(), purpose: "", framework: "Python", status: "active", lastRun: null, history: [], links: [], projectId, repository: `me/${projectId}`, ...over,
});
const project = (id: string, over: Partial<Catalog["projects"][number]> = {}): Catalog["projects"][number] => ({
  id, name: id, summary: "", status: "active", repository: `me/${id}`, tags: [], links: [], agentIds: [], ...over,
});
const deps = (...ids: string[]) => ({ responsibilities: { tasks: [], tools: [], inputs: [], outputs: [], dependencies: ids, limitations: [] } });

describe("buildConnections", () => {
  it("links a repository to the agents whose code or workflow it holds, and nothing else", () => {
    const catalog: Catalog = {
      projects: [project("p")],
      agents: [agent("coded", "p", { source: "x.py" }), agent("ci", "p", { observe: { githubWorkflow: "ci.yml" } }), agent("elsewhere", "p")],
    };
    const ids = buildConnections(catalog, {}, NOW).map((c) => c.id);
    expect(ids.sort()).toEqual(["repo:ci", "repo:coded"]);
  });

  it("takes status from observed runs only", () => {
    const catalog: Catalog = { projects: [project("p")], agents: [agent("ci", "p", { observe: { githubWorkflow: "ci.yml" } })] };
    const status = (r: ReturnType<typeof run> | null) =>
      buildConnections(catalog, { "me/p": { kind: "ok", stale: false, data: snap({ workflowRuns: r ? { "ci.yml": [r] } : {} }) } }, NOW)[0];
    expect(status(run("success")).status).toBe("active");
    expect(status(run("failure")).status).toBe("unhealthy");
    expect(status(run("success", "2026-08-01T00:00:00Z")).status).toBe("inactive");
    expect(status(null).status).toBe("unknown");
    expect(status({ ...run("failure"), branch: "feature" }).status).toBe("unknown");
    expect(buildConnections(catalog, {}, NOW)[0].status).toBe("unknown");
  });

  it("merges agents that list each other into one two-way link, typed n8n when either side is n8n", () => {
    const catalog: Catalog = {
      projects: [project("p"), project("q")],
      agents: [
        agent("worker", "p", { registry: deps("flow") }),
        agent("flow", "p", { framework: "n8n", registry: deps("worker") }),
        agent("a", "p", { registry: deps("b", "missing") }),
        agent("b", "q"),
      ],
    };
    const cs = buildConnections(catalog, {}, NOW);
    const pair = cs.filter((c) => c.id === "dep:flow~worker");
    expect(pair).toHaveLength(1);
    expect(pair[0]).toMatchObject({ type: "n8n", directed: false, status: "unknown", workflows: ["n8n: FLOW"] });
    const cross = cs.find((c) => c.id === "dep:a~b")!;
    expect(cross).toMatchObject({ type: "dependency", directed: true, relation: "A depends on B" });
    expect(cs.some((c) => c.id.includes("missing"))).toBe(false);
  });

  it("never connects projects for sharing a technology", () => {
    const catalog: Catalog = { projects: [project("p", { tags: ["claude"] }), project("q", { tags: ["claude"] })], agents: [agent("x", "p", { framework: "CrewAI" }), agent("y", "q", { framework: "CrewAI" })] };
    expect(buildConnections(catalog, {}, NOW)).toEqual([]);
  });

  it("draws declared project connections, ignoring targets that do not exist", () => {
    const catalog: Catalog = {
      projects: [project("p", { connections: [{ to: "q", type: "dependency", direction: "inbound", note: "q publishes data p reads" }, { to: "nope", type: "agent", note: "x" }] }), project("q")],
      agents: [],
    };
    const [c, ...rest] = buildConnections(catalog, {}, NOW);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ source: { kind: "project", id: "q" }, target: { kind: "project", id: "p" }, directed: true, status: "unknown" });
  });

  it("has Atlas read every other repository; a failed sync is unverified, not a failure", () => {
    const catalog: Catalog = { projects: [project("ai-ops-atlas"), project("p"), project("q"), project("r")], agents: [] };
    const cs = buildConnections(
      catalog,
      { "me/p": { kind: "ok", stale: false, data: snap() }, "me/q": { kind: "error", message: "API rate limit exceeded" } },
      NOW,
    );
    expect(Object.fromEntries(cs.map((c) => [c.id, c.status]))).toEqual({ "sync:p": "active", "sync:q": "unknown", "sync:r": "unknown" });
  });
});

describe("bundled catalog connections", () => {
  const dir = join(__dirname, "../../catalog");
  const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
  const { catalog } = buildCatalog(files);
  const cs = buildConnections(catalog, {}, NOW);

  it("finds the Benjaire contact Worker and n8n intake as one n8n link", () => {
    expect(cs.find((c) => c.id === "dep:benjaire-contact-worker~benjaire-flow-intake")).toMatchObject({ type: "n8n", directed: false });
  });

  it("cites a manifest for every connection and gives unique ids", () => {
    expect(new Set(cs.map((c) => c.id)).size).toBe(cs.length);
    for (const c of cs) expect(c.evidence[0]).toMatch(/^catalog\/[\w.-]+\.yaml/);
  });
});
