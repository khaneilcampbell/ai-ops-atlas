import yaml from "js-yaml";
import { parseRegistry } from "../registry/manifest";
import { REPO_RE, Reader } from "./reader";
import { SCHEMAS, type Agent, type Catalog, type ManifestIssue, type Project } from "./types";

/** Parses one manifest file. Problems are reported in `issues`, never thrown. */
export function parseManifest(file: string, text: string, issues: ManifestIssue[]): Catalog {
  const r = new Reader(file, issues);
  let doc: unknown;
  try {
    doc = yaml.load(text, { schema: yaml.DEFAULT_SCHEMA });
  } catch (e) {
    r.fail("file", `invalid YAML (${(e as Error).message.split("\n")[0]})`);
    return { projects: [], agents: [] };
  }
  const root = r.obj(doc, "file");
  if (!root) return { projects: [], agents: [] };
  const schema = (SCHEMAS as readonly unknown[]).includes(root.schema) ? (root.schema as (typeof SCHEMAS)[number]) : null;
  if (!schema) r.fail("schema", `must be one of ${SCHEMAS.map((v) => `"${v}"`).join(", ")}`);

  const p = r.obj(root.project, "project");
  if (!p) return { projects: [], agents: [] };
  const projectId = r.id(p, "project");
  const repository = r.str(p, "repository", "project");
  if (repository && !REPO_RE.test(repository)) r.fail("project.repository", 'must look like "owner/name"');
  if (!projectId || !repository) return { projects: [], agents: [] };

  const agents: Agent[] = r.list(root, "agents", "file").flatMap((a, i) => {
    const path = `agents[${i}]`;
    const ao = r.obj(a, path);
    if (!ao) return [];
    const id = r.id(ao, path);
    const name = r.str(ao, "name", path);
    const purpose = r.str(ao, "purpose", path);
    const framework = r.str(ao, "framework", path);
    if (!id || !name || !purpose || !framework) return [];
    const observe = ao.observe ? r.obj(ao.observe, `${path}.observe`) : null;
    const agentRepo = r.str(ao, "repository", path, false) ?? repository;
    let registry = undefined;
    if (ao.registry !== undefined && ao.registry !== null) {
      if (schema === "atlas/v1") r.fail(`${path}.registry`, 'needs schema "atlas/v2"');
      else registry = parseRegistry(r, ao.registry, `${path}.registry`);
    }
    // A registry title is a display name only: the id, source paths and workflow names stay as they are.
    const title = registry?.title;
    return [
      {
        id,
        name: title ?? name,
        originalName: title && title !== name ? name : undefined,
        registry,
        purpose,
        framework,
        model: r.str(ao, "model", path, false),
        runtime: r.str(ao, "runtime", path, false),
        status: r.status(ao, path),
        trigger: r.str(ao, "trigger", path, false),
        source: r.str(ao, "source", path, false),
        lastRun: r.date(ao, "last_run", path),
        capabilities: r.strings(ao, "capabilities", path),
        permissions: r.strings(ao, "permissions", path),
        history: r.history(ao, path),
        links: r.links(ao, path),
        observe: observe
          ? { githubWorkflow: r.str(observe, "github_workflow", `${path}.observe`, false), atlasIntel: r.bool(observe, "atlas_intel", `${path}.observe`) }
          : undefined,
        projectId,
        repository: agentRepo,
      },
    ];
  });

  const project: Project = {
    id: projectId,
    name: r.str(p, "name", "project") ?? projectId,
    summary: r.str(p, "summary", "project") ?? "",
    status: r.status(p, "project"),
    repository,
    tags: r.list(p, "tags", "project").filter((t): t is string => typeof t === "string"),
    links: r.links(p, "project"),
    agentIds: agents.map((a) => a.id),
  };
  return { projects: [project], agents };
}

/** Merges manifests and reports duplicate ids across files. */
export function buildCatalog(files: Record<string, string>): { catalog: Catalog; issues: ManifestIssue[] } {
  const issues: ManifestIssue[] = [];
  const catalog: Catalog = { projects: [], agents: [] };
  const seenProjects = new Set<string>();
  const seenAgents = new Set<string>();
  for (const [file, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const part = parseManifest(file, text, issues);
    for (const p of part.projects) {
      if (seenProjects.has(p.id)) {
        issues.push({ file, message: `project.id "${p.id}" is already used by another manifest` });
        continue;
      }
      seenProjects.add(p.id);
      catalog.projects.push(p);
    }
    for (const a of part.agents) {
      if (seenAgents.has(a.id)) {
        issues.push({ file, message: `agent id "${a.id}" is already used` });
        continue;
      }
      seenAgents.add(a.id);
      catalog.agents.push(a);
    }
  }
  return { catalog, issues };
}
