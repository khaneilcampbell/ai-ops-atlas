import { projectRepositories } from "../catalog/projects";
import type { Catalog } from "../catalog";
import type { RepoState } from "../github/types";

/** Why a cataloged repository no longer shows as a building or list row. */
export type HiddenReason = "deleted" | "archived";

export interface HiddenRepo {
  repository: string;
  reason: HiddenReason;
  /** Names of the cataloged projects that pointed at it. */
  projects: string[];
}

export interface LiveCatalog {
  catalog: Catalog;
  hidden: HiddenRepo[];
  /** Cataloged name -> the name GitHub now answers with, for repositories renamed on GitHub. */
  renamed: Record<string, string>;
}

const snapshotOf = (s: RepoState | undefined) => (s?.kind === "ok" ? s.data : s?.kind === "error" ? s.data : undefined);

/**
 * The catalog as GitHub currently has it: projects whose repository was deleted (`deleted` holds
 * names GitHub confirmed gone) or archived drop out, along with their agents. A repository
 * GitHub reports under a new name stays, and the new name is reported so discovery
 * doesn't list it a second time.
 */
export function liveCatalog(catalog: Catalog, repos: Record<string, RepoState>, deleted: Record<string, string>): LiveCatalog {
  const renamed: Record<string, string> = {};
  const reasons = new Map<string, HiddenReason>();
  for (const name of new Set(catalog.projects.flatMap((p) => projectRepositories(p, catalog.agents)))) {
    const snap = snapshotOf(repos[name]);
    if (deleted[name]) reasons.set(name, "deleted");
    else if (snap?.archived) reasons.set(name, "archived");
    if (snap && snap.fullName && snap.fullName.toLowerCase() !== name.toLowerCase()) renamed[name] = snap.fullName;
  }
  if (!reasons.size) return { catalog, hidden: [], renamed };
  const projects = catalog.projects.filter((p) => !projectRepositories(p, catalog.agents).every(name => reasons.has(name)));
  const keep = new Set(projects.map((p) => p.id));
  const hidden = [...reasons].map(([repository, reason]) => ({
    repository,
    reason,
    projects: catalog.projects.filter((p) => projectRepositories(p, catalog.agents).includes(repository)).map((p) => p.name),
  }));
  const agents = catalog.agents.filter((a) => keep.has(a.projectId) && !reasons.has(a.repository));
  const agentIds = new Set(agents.map((a) => a.id));
  return {
    catalog: {
      projects: projects.map((p) => ({
        ...p,
        agentIds: p.agentIds.filter((id) => agentIds.has(id)),
        ...(p.connections && { connections: p.connections.filter((c) => keep.has(c.to) || agentIds.has(c.to)) }),
      })),
      agents,
    },
    hidden,
    renamed,
  };
}
