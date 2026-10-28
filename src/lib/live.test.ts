import { describe, expect, it } from "vitest";
import type { Catalog } from "../catalog/types";
import type { RepoSnapshot, RepoState } from "../github/types";
import { liveCatalog } from "./live";

const snap = (fullName: string, over: Partial<RepoSnapshot> = {}): RepoSnapshot => ({
  fullName, description: null, url: "", homepage: null, language: null, languages: {}, visibility: "public",
  defaultBranch: "main", pushedAt: null, stars: 0, openIssues: 0, license: null, archived: false,
  commits: [], runs: [], workflowRuns: {}, fetchedAt: "2026-10-28T00:00:00Z", ...over,
});
const ok = (data: RepoSnapshot): RepoState => ({ kind: "ok", data, stale: false });

const catalog: Catalog = {
  projects: [
    { id: "a", name: "A", summary: "", status: "active", repository: "me/a", tags: [], links: [], agentIds: ["bot"], connections: [{ to: "b", type: "github", note: "" }] },
    { id: "b", name: "B", summary: "", status: "idle", repository: "me/b", tags: [], links: [], agentIds: [] },
  ],
  agents: [{ id: "bot", name: "Bot", purpose: "", framework: "Shell", status: "active", lastRun: null, history: [], links: [], projectId: "a", repository: "me/a" }],
};

describe("liveCatalog", () => {
  it("keeps the catalog as is when GitHub has every repository", () => {
    const live = liveCatalog(catalog, { "me/a": ok(snap("me/a")), "me/b": ok(snap("me/b")) }, {});
    expect(live.catalog).toBe(catalog);
    expect(live.hidden).toEqual([]);
  });

  it("drops a project whose repository was deleted, and connections to it", () => {
    const live = liveCatalog(catalog, { "me/b": { kind: "error", message: "gone" } }, { "me/b": "2026-10-28T00:00:00Z" });
    expect(live.catalog.projects.map((p) => p.id)).toEqual(["a"]);
    expect(live.catalog.projects[0].connections).toEqual([]);
    expect(live.hidden).toEqual([{ repository: "me/b", reason: "deleted", projects: ["B"] }]);
  });

  it("drops an archived repository's project and its agents", () => {
    const live = liveCatalog(catalog, { "me/a": ok(snap("me/a", { archived: true })) }, {});
    expect(live.catalog.projects.map((p) => p.id)).toEqual(["b"]);
    expect(live.catalog.agents).toEqual([]);
    expect(live.hidden[0].reason).toBe("archived");
  });

  it("keeps a project whose repository could not be read for other reasons", () => {
    const live = liveCatalog(catalog, { "me/b": { kind: "error", message: "Private or not found" } }, {});
    expect(live.catalog.projects).toHaveLength(2);
  });

  it("follows a repository renamed on GitHub", () => {
    const live = liveCatalog(catalog, { "me/a": ok(snap("me/a-renamed")) }, {});
    expect(live.catalog.projects).toHaveLength(2);
    expect(live.renamed).toEqual({ "me/a": "me/a-renamed" });
  });
});
