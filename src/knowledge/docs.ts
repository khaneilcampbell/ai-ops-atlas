import type { Catalog, Link, Project } from "../catalog/types";
import type { RepoState } from "../github/types";
import { projectRepositories } from "../catalog/projects";

// The Knowledge Repository's first real list: the documents the workspace relies on, from what
// Atlas already knows. Every row is a repository page (each repository's README lives there), a
// website a repository declares on GitHub, or a link a manifest declares. Atlas does not read the
// documents themselves and never claims to: knowledge search stays a planned capability.

export type DocumentKind = "repository" | "website" | "link";

export interface DocumentRow {
  url: string;
  label: string;
  kind: DocumentKind;
  /** Where Atlas learned of it. */
  source: "GitHub" | "manifest";
  /** When the repository was last pushed to, for repository rows with a snapshot. */
  updated: string | null;
}

export interface ProjectDocuments {
  projectId: string;
  name: string;
  documents: DocumentRow[];
}

const DOC_RE = /\b(docs?|documentation|readme|wiki|guide|handbook|case study|setup|spec)\b/i;

/** Links a manifest declares that are documents, not consoles or live services. Links whose label
 *  says nothing about documents are listed too, after the obvious ones, so nothing declared is hidden. */
function manifestDocs(links: Link[]): DocumentRow[] {
  const rows = links.map((l): DocumentRow => ({ url: l.url, label: l.label, kind: "link", source: "manifest", updated: null }));
  return rows.sort((a, b) => Number(DOC_RE.test(b.label)) - Number(DOC_RE.test(a.label)));
}

export function projectDocuments(project: Project, catalog: Catalog, repos: Record<string, RepoState | undefined>): ProjectDocuments {
  const seen = new Set<string>();
  const out: DocumentRow[] = [];
  const add = (r: DocumentRow) => {
    const key = r.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  for (const name of projectRepositories(project, catalog.agents)) {
    const st = repos[name];
    const snap = st && st.kind !== "loading" ? st.data : undefined;
    add({ url: `https://github.com/${name}`, label: `${name.split("/")[1]} repository`, kind: "repository", source: "GitHub", updated: snap?.pushedAt ?? null });
    if (snap?.homepage) add({ url: snap.homepage, label: snap.homepage.replace(/^https?:\/\//, "").replace(/\/$/, ""), kind: "website", source: "GitHub", updated: null });
  }
  for (const r of manifestDocs(project.links)) add(r);
  for (const a of catalog.agents.filter((a) => a.projectId === project.id)) for (const r of manifestDocs(a.links)) add({ ...r, label: `${r.label} · ${a.name}` });
  return { projectId: project.id, name: project.name, documents: out };
}

/** Every project's documents, in catalog order. */
export function documentInventory(catalog: Catalog, repos: Record<string, RepoState | undefined>): ProjectDocuments[] {
  return catalog.projects.map((p) => projectDocuments(p, catalog, repos));
}

export function documentCount(groups: ProjectDocuments[]): number {
  return groups.reduce((n, g) => n + g.documents.length, 0);
}
