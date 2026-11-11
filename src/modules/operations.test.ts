import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { isAiAgent } from "../catalog/roles";
import type { RepoSnapshot, RepoState, WorkflowRun } from "../github/types";
import { buildingInstances, landmarkInstances } from "./instances";
import { aggregateHealth, buildingAssets, executionHistory } from "./operations";

const run = (name: string, conclusion: string | null, createdAt = "2026-11-10T10:00:00Z", status = "completed"): WorkflowRun =>
  ({ name, status, conclusion, branch: "main", event: "push", createdAt, url: `https://github.com/x/${name}` });
const snap = (runs: WorkflowRun[], workflowRuns: Record<string, WorkflowRun[]> = {}): RepoSnapshot =>
  ({ fullName: "x", defaultBranch: "main", runs, workflowRuns } as unknown as RepoSnapshot);
const ok = (s: RepoSnapshot, stale = false): RepoState => ({ kind: "ok", data: s, stale });

const building = (id: string) => buildingInstances(catalog).find((b) => b.id === id)!;
const landmark = (id: string) => landmarkInstances().find((l) => l.id === id)!;

describe("operational assets", () => {
  it("gives a project building its own repositories, agents and automations", () => {
    const a = buildingAssets(building("ai-ops-atlas"), catalog);
    expect(a.projects).toEqual(["ai-ops-atlas"]);
    expect(a.repositories[0]).toBe("khaneilcampbell/ai-ops-atlas");
    expect(a.agents.every((x) => x.projectId === "ai-ops-atlas" && isAiAgent(x))).toBe(true);
    expect(a.automations.map((x) => x.id)).toContain("atlas-ci");
  });

  it("gives the agent and automation modules the whole workspace's agents or automations, wherever they are housed", () => {
    const agents = buildingAssets(building("intelligence-hub"), catalog);
    expect(agents.automations).toEqual([]);
    expect(agents.agents.length).toBeGreaterThan(5);
    expect(agents.agents.every(isAiAgent)).toBe(true);
    expect(agents.agents.some((x) => x.projectId !== "intelligence-hub")).toBe(true);
    const plant = buildingAssets(landmark("atlas-station"), catalog);
    expect(plant.agents).toEqual([]);
    expect(plant.automations.some((x) => x.id === "atlas-ci")).toBe(true);
    expect(plant.automations.some(isAiAgent)).toBe(false);
  });

  it("gives a landmark linked to a project that repository and only the agents working in it", () => {
    const studio = buildingAssets(landmark("benjaire-marketing"), catalog);
    expect(studio.projects).toEqual(["benjaire-site"]);
    expect(studio.repositories).toEqual(["khaneilcampbell/benjaire.com"]);
    expect(studio.agents.map((a) => a.id)).toContain("benjaire-product-lab");
    expect([...studio.agents, ...studio.automations].every((a) => a.workplace?.building === "Benjaire Marketing Agency")).toBe(true);
    expect(studio.automations.map((a) => a.id)).not.toContain("benjaire-contact-worker");
  });

  it("gives other landmarks nothing rather than borrowing another building's data", () => {
    expect(buildingAssets(landmark("bmw-dealership"), catalog)).toEqual({ projects: [], repositories: [], agents: [], automations: [] });
  });
});

describe("health aggregation", () => {
  it("is unknown with no repositories, and while everything is still loading", () => {
    expect(aggregateHealth([], {})).toMatchObject({ health: "unknown", state: "none" });
    expect(aggregateHealth(["a", "b"], { a: { kind: "loading" } })).toMatchObject({ health: "unknown", state: "loading", summary: "Checking GitHub CI across 2 repositories…" });
  });

  it("fails when any repository fails, and passes only on checked repositories", () => {
    const repos = { a: ok(snap([run("ci", "success")])), b: ok(snap([run("ci", "failure")])), c: { kind: "loading" } as RepoState };
    expect(aggregateHealth(["a", "b", "c"], repos)).toMatchObject({ health: "bad", checked: 2, failing: ["b"], summary: "CI failing on 1 of 3: b" });
    expect(aggregateHealth(["a", "c"], repos)).toMatchObject({ health: "good", checked: 1, summary: "CI passing on 1 of 2 checked" });
  });

  it("says when data is unavailable or only last known", () => {
    expect(aggregateHealth(["a"], { a: { kind: "error", message: "403" } })).toMatchObject({ health: "unknown", state: "unavailable" });
    const stale = aggregateHealth(["a"], { a: { kind: "error", message: "502", data: snap([run("ci", "success")]) } });
    expect(stale).toMatchObject({ health: "good", state: "stale" });
    expect(stale.summary).toMatch(/last known/);
    expect(aggregateHealth(["a"], { a: ok(snap([])) })).toMatchObject({ health: "unknown", summary: "No CI workflows on this repository" });
  });
});

describe("execution history", () => {
  it("lists the latest observed run of each watched item, newest first", () => {
    const atlas = catalog.agents.filter((a) => a.repository === "khaneilcampbell/ai-ops-atlas" && a.observe?.githubWorkflow);
    const [first, second] = atlas;
    const repos = { "khaneilcampbell/ai-ops-atlas": ok(snap([], {
      [first.observe!.githubWorkflow!]: [run("a", "failure", "2026-11-10T09:00:00Z")],
      [second.observe!.githubWorkflow!]: [run("b", null, "2026-11-10T11:00:00Z", "in_progress")],
    })) };
    expect(executionHistory(atlas, repos).map((e) => [e.agentId, e.result])).toEqual([[second.id, "running"], [first.id, "failure"]]);
    expect(executionHistory(atlas, {})).toEqual([]);
  });
});
