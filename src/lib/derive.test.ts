import { describe, expect, it } from "vitest";
import type { Catalog } from "../catalog/types";
import type { RepoSnapshot } from "../github/types";
import { attentionItems, ciHealth, effectiveLastRun, verifiedState } from "./derive";

const snap = (over: Partial<RepoSnapshot> = {}): RepoSnapshot => ({
  fullName: "me/demo", description: null, url: "", homepage: null, language: "Python", languages: {}, visibility: "public",
  defaultBranch: "main", pushedAt: new Date().toISOString(), stars: 0, openIssues: 0, license: "MIT", archived: false,
  commits: [], runs: [], workflowRuns: {}, fetchedAt: new Date().toISOString(), ...over,
});

const run = (name: string, conclusion: string | null, createdAt = "2026-10-20T00:00:00Z") => ({
  name, status: "completed", conclusion, branch: "main", event: "push", createdAt, url: `u:${name}:${createdAt}`,
});

const catalog: Catalog = {
  projects: [{ id: "demo", name: "Demo", summary: "", status: "active", repository: "me/demo", tags: [], links: [], agentIds: ["ci", "loop"] }],
  agents: [
    { id: "ci", name: "CI", purpose: "", framework: "GitHub Actions", status: "active", lastRun: null, history: [], links: [], projectId: "demo", repository: "me/demo", observe: { githubWorkflow: "ci.yml" } },
    { id: "loop", name: "Loop", purpose: "", framework: "Shell", status: "active", lastRun: null, history: [], links: [], projectId: "demo", repository: "me/demo" },
  ],
};

describe("ciHealth", () => {
  it("uses only the latest run of each workflow", () => {
    const s = snap({ runs: [run("Tests", "success", "2026-10-21T00:00:00Z"), run("Tests", "failure"), run("Lint", "success")] });
    expect(ciHealth(s).health).toBe("good");
  });
  it("flags a failing workflow", () => {
    expect(ciHealth(snap({ runs: [run("Tests", "failure")] })).value).toBe("1 failing");
  });
  it("ignores Dependabot's own update jobs", () => {
    const dependabot = { ...run("cargo in /src-tauri for glib - Update #1658074936", "failure"), event: "dynamic" };
    expect(ciHealth(snap({ runs: [dependabot, run("CI", "success")] })).value).toBe("Passing");
  });
});

describe("verifiedState", () => {
  it("separates not yet verified, unavailable, failing, passing and no CI", () => {
    expect(verifiedState(undefined).kind).toBe("unverified");
    expect(verifiedState({ kind: "loading" }).kind).toBe("unverified");
    expect(verifiedState({ kind: "error", message: "404" }).kind).toBe("unavailable");
    expect(verifiedState({ kind: "ok", stale: false, data: snap({ runs: [run("Tests", "failure")] }) })).toEqual({ kind: "failing", label: "CI 1 failing now", stale: false });
    expect(verifiedState({ kind: "ok", stale: false, data: snap({ runs: [run("Tests", "success")] }) }).kind).toBe("passing");
    expect(verifiedState({ kind: "ok", stale: false, data: snap() }).kind).toBe("no-ci");
  });
  it("marks data kept from an earlier sync", () => {
    const v = verifiedState({ kind: "error", message: "rate limited", data: snap({ runs: [run("Tests", "success")] }) });
    expect(v).toEqual({ kind: "passing", label: "CI passing · last known", stale: true });
  });
});

describe("attention", () => {
  it("prefers an observed workflow run over a missing manifest last_run", () => {
    const s = snap({ workflowRuns: { "ci.yml": [run("Security", "success", new Date().toISOString())] } });
    expect(effectiveLastRun(catalog.agents[0], s)).not.toBeNull();
    const items = attentionItems(catalog, { "me/demo": { kind: "ok", data: s, stale: false } }, []);
    expect(items.map((i) => i.id)).toEqual(["agent:loop:norun"]);
  });

  it("raises failed observed runs and failing CI as high severity", () => {
    const s = snap({ runs: [run("Security", "failure")], workflowRuns: { "ci.yml": [run("Security", "failure")] } });
    const items = attentionItems(catalog, { "me/demo": { kind: "ok", data: s, stale: false } }, []);
    expect(items.filter((i) => i.severity === "high").map((i) => i.id)).toEqual(["agent:ci:run", "repo:me/demo:ci"]);
  });
});

describe("uncataloged repositories", () => {
  it("raise failing CI even without a manifest", () => {
    const s = snap({ fullName: "me/other", runs: [run("CI", "failure")] });
    const items = attentionItems({ projects: [], agents: [] }, { "me/other": { kind: "ok", data: s, stale: false } }, [], Date.now(), ["me/other"]);
    expect(items.map((i) => i.id)).toEqual(["repo:me/other:ci"]);
  });
});
