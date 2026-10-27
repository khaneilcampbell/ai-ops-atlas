import type { Agent, Catalog, Project } from "../catalog/types";
import type { RepoState } from "../github/types";
import { repoData } from "./derive";

export function norm(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Every whitespace-separated term must appear somewhere in the haystack. */
export function matches(query: string, ...fields: (string | undefined | null)[]): boolean {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = norm(fields.filter(Boolean).join(" \u0001 "));
  return terms.every((t) => hay.includes(t));
}

export function agentMatches(a: Agent, project: Project | undefined, q: string) {
  return matches(q, a.name, a.purpose, a.framework, a.model, a.runtime, a.status, a.trigger, a.source, project?.name, a.repository);
}

export interface RepoRow {
  name: string;
  project: Project | undefined;
  agents: Agent[];
  state: RepoState | undefined;
}

export function repoRows(catalog: Catalog, repos: Record<string, RepoState>): RepoRow[] {
  const names = [...new Set(catalog.projects.map((p) => p.repository).concat(catalog.agents.map((a) => a.repository)))];
  return names.map((name) => ({
    name,
    project: catalog.projects.find((p) => p.repository === name),
    agents: catalog.agents.filter((a) => a.repository === name),
    state: repos[name],
  }));
}

export function repoMatches(r: RepoRow, q: string) {
  const d = repoData(r.state);
  return matches(q, r.name, r.project?.name, r.project?.summary, d?.description, d?.language, ...Object.keys(d?.languages ?? {}), ...(r.project?.tags ?? []));
}
