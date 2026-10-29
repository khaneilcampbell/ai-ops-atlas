import type { Agent, Project } from "./types";

/** Resources belonging to a project, including explicit per-agent repository overrides. */
export function projectRepositories(project: Pick<Project, "id" | "repository" | "repositories">, agents: Pick<Agent, "projectId" | "repository">[] = []): string[] {
  return [...new Set([project.repository, ...(project.repositories ?? []), ...agents.filter(a => a.projectId === project.id).map(a => a.repository)])];
}
