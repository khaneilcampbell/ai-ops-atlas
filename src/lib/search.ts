import { projectRepositories, LANDMARK_REPOSITORIES } from "../catalog/projects";
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
  return matches(q, a.name, a.originalName, a.purpose, a.framework, a.model, a.runtime, a.status, a.trigger, a.source, project?.name, a.repository);
}

export interface RepoRow {
  name: string;
  project: Project | undefined;
  agents: Agent[];
  state: RepoState | undefined;
}

export function repoRows(catalog: Catalog, repos: Record<string, RepoState>, uncataloged: string[] = []): RepoRow[] {
  const names = [...new Set([...LANDMARK_REPOSITORIES.filter(name => name in repos), ...catalog.projects.flatMap((p) => projectRepositories(p, catalog.agents)), ...catalog.agents.map((a) => a.repository), ...uncataloged])];
  return names.map((name) => ({
    name,
    project: catalog.projects.find((p) => projectRepositories(p, catalog.agents).includes(name)),
    agents: catalog.agents.filter((a) => a.repository === name),
    state: repos[name],
  }));
}

export function repoMatches(r: RepoRow, q: string) {
  const d = repoData(r.state);
  return matches(q, r.name, r.project?.name, r.project?.summary, d?.description, d?.language, ...Object.keys(d?.languages ?? {}), ...(r.project?.tags ?? []));
}

/** Exact names and known aliases precede broad description matches; other order stays stable. */
export function prioritizeExact<T extends {title:string;aliases?:readonly string[]}>(rows:T[],query:string):T[]{
 const key=(value:string)=>norm(value).trim().replace(/\s+/g,' '),wanted=key(query);
 const exact=(row:T)=>Number([row.title,...row.aliases??[]].some(value=>key(value)===wanted));
 return [...rows].sort((a,b)=>exact(b)-exact(a));
}
