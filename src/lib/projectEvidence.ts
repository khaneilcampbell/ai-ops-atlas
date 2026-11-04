import type { Catalog, Project } from "../catalog/types";
import { projectRepositories } from "../catalog/projects";
import type { RepoState } from "../github/types";
import { latestPerWorkflow, repoData } from "./derive";

export function projectEvidence(project: Project, catalog: Catalog, repos: Record<string, RepoState>, now = Date.now()) {
  return projectRepositories(project, catalog.agents).map(name => {
    const state = repos[name], snapshot = repoData(state);
    const stale = !!snapshot && (state?.kind === "error" || (state?.kind === "ok" && state.stale) || now-Date.parse(snapshot.fetchedAt)>86400000);
    const failed = snapshot ? latestPerWorkflow(snapshot.runs).filter(r => r.conclusion === "failure" || r.conclusion === "timed_out") : [];
    return {name,snapshot,stale,failed,attention:!snapshot ? "Repository evidence unavailable" : stale ? "Refresh saved evidence before acting" : failed.length ? "Inspect failing workflow results" : "No failing workflow in the saved sample; deployment and business health remain separate"};
  });
}
