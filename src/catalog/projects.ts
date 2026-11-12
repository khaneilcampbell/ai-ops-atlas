import type { Agent, Project } from "./types";

/** Resources belonging to a project, including explicit per-agent repository overrides. */
export function projectRepositories(project: Pick<Project, "id" | "repository" | "repositories">, agents: Pick<Agent, "projectId" | "repository">[] = []): string[] {
  return [...new Set([project.repository, ...(project.repositories ?? []), ...agents.filter(a => a.projectId === project.id).map(a => a.repository)])];
}

/** Repository-backed city amenities that do not create another project tower. */
export const LANDMARK_REPOSITORIES: string[] = [];

/** Suppress retired repositories in saved discovery results without fetching them. */
export const RETIRED_REPOSITORIES = ["khaneilcampbell/skyline", "khaneilcampbell/benjaire-dashboard", "khaneilcampbell/projects-intelligence-hub", "khaneilcampbell/service-desk-intelligence"];

/**
 * The project that owns each repository. Several projects can share one repository (Skyline,
 * Benjaire Ops and Atlas all live in ai-ops-atlas), so prefer the project named after the
 * repository, then the first one registered. Keys are lower case.
 */
export function projectByRepository<P extends Pick<Project, "id" | "repository">>(projects: P[]): Map<string, P> {
  const out = new Map<string, P>();
  for (const p of projects) {
    const key = p.repository.toLowerCase();
    if (!out.has(key) || p.id.toLowerCase() === key.split("/").pop()) out.set(key, p);
  }
  return out;
}
