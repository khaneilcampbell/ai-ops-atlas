import { describe, expect, it } from "vitest";
import { parseManifest } from "./parse";
import type { ManifestIssue } from "./types";
import { projectRepositories } from "./projects";
import { layoutMap } from "../views/mapLayout";
import { buildScene } from "../views/map3d/scene";
import { endpointKey } from "../lib/connections";
import { repoRows } from "../lib/search";
import { liveCatalog } from "../lib/live";
import type { RepoState } from "../github/types";
import { planOffice } from "../views/office/model";

function fixture(extra = "") {
  const issues: ManifestIssue[] = [];
  const catalog = parseManifest("project.yaml", `schema: atlas/v2
project:
  id: demo
  name: Demo project
  summary: A project with linked resources
  status: active
  repository: me/default
  ${extra}
agents:
  - { id: helper, name: Helper, purpose: Review, framework: Claude, status: idle, repository: me/worker }
`, issues);
  return { catalog, issues, project: catalog.projects[0] };
}

describe("projects and linked repository resources", () => {
  it("supports additional repositories and agent overrides without duplicate resources", () => {
    const { catalog, project, issues } = fixture("repositories: [me/api, me/web, me/default]");
    expect(issues).toEqual([]);
    expect(projectRepositories(project, catalog.agents)).toEqual(["me/default", "me/api", "me/web", "me/worker"]);
    expect(repoRows(catalog, {}).map(r => [r.name, r.project?.id])).toEqual(["me/default", "me/api", "me/web", "me/worker"].map(name => [name, "demo"]));
    expect(buildScene(layoutMap(catalog)).towers).toHaveLength(1);
  });
  it("rejects invalid additional repository paths", () => {
    const { project, issues } = fixture("repositories: [me/api, not-a-repo, 42]");
    expect(project.repositories).toEqual(["me/api"]);
    expect(issues.map(i => i.message)).toEqual(expect.arrayContaining([expect.stringContaining("repositories[1]"), expect.stringContaining("repositories[2]")]));
  });
  it("keeps building, office, and connection identity stable across repository changes", () => {
    const { catalog, project } = fixture("repositories: [me/api]");
    const changed = { ...project, repository: "me/renamed" };
    const other = { ...project, id: "another-project" };
    const scene = buildScene(layoutMap({ ...catalog, projects: [changed, other] }));
    expect(new Set(scene.towers.map(t => t.key))).toEqual(new Set(["project:demo", "project:another-project"]));
    expect(planOffice(changed, []).buildingId).toBe(planOffice(project, []).buildingId);
    expect(endpointKey(catalog, { kind: "project", id: project.id })).toBe("project:demo");
  });
  it("keeps a project when another linked repository remains available", () => {
    const { catalog } = fixture("repositories: [me/api]");
    const live = liveCatalog(catalog, {}, { "me/default": "confirmed deleted" });
    expect(live.catalog.projects.map(p => p.id)).toEqual(["demo"]);
    expect(live.hidden[0].repository).toBe("me/default");
    expect(liveCatalog(catalog, {} as Record<string, RepoState>, { "me/default": "gone", "me/api": "gone", "me/worker": "gone" }).catalog.projects).toEqual([]);
  });
  it("keeps existing single-repository manifests compatible", () => {
    const { project, issues } = fixture();
    expect(issues).toEqual([]);
    expect(projectRepositories(project)).toEqual(["me/default"]);
  });
});
