import yaml from "js-yaml";
import { STATUSES, type Agent, type Catalog, type HistoryEntry, type Link, type ManifestIssue, type Project, type Status } from "./types";

const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

type Raw = Record<string, unknown>;

class Reader {
  constructor(
    private file: string,
    private issues: ManifestIssue[],
  ) {}

  fail(path: string, message: string) {
    this.issues.push({ file: this.file, message: `${path}: ${message}` });
  }

  obj(v: unknown, path: string): Raw | null {
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Raw;
    this.fail(path, "expected a mapping");
    return null;
  }

  str(o: Raw, key: string, path: string, required = true): string | undefined {
    const v = o[key];
    if (v === undefined || v === null) {
      if (required) this.fail(`${path}.${key}`, "is required");
      return undefined;
    }
    if (typeof v !== "string" || !v.trim()) {
      this.fail(`${path}.${key}`, "must be a non-empty string");
      return undefined;
    }
    return v.trim();
  }

  id(o: Raw, path: string): string | undefined {
    const v = this.str(o, "id", path);
    if (v && !ID_RE.test(v)) this.fail(`${path}.id`, "use lowercase letters, digits and dashes");
    return v;
  }

  status(o: Raw, path: string): Status {
    const v = this.str(o, "status", path);
    if (v && (STATUSES as readonly string[]).includes(v)) return v as Status;
    if (v) this.fail(`${path}.status`, `must be one of ${STATUSES.join(", ")}`);
    return "idle";
  }

  date(o: Raw, key: string, path: string): string | null {
    const v = o[key];
    if (v === undefined || v === null) return null;
    // YAML parses bare timestamps into Date objects.
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
    this.fail(`${path}.${key}`, "must be an ISO date or null");
    return null;
  }

  list(o: Raw, key: string, path: string): unknown[] {
    const v = o[key];
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v;
    this.fail(`${path}.${key}`, "expected a list");
    return [];
  }

  links(o: Raw, path: string): Link[] {
    return this.list(o, "links", path).flatMap((l, i) => {
      const lo = this.obj(l, `${path}.links[${i}]`);
      if (!lo) return [];
      const label = this.str(lo, "label", `${path}.links[${i}]`);
      const url = this.str(lo, "url", `${path}.links[${i}]`);
      if (!label || !url) return [];
      if (!/^https:\/\//.test(url)) {
        this.fail(`${path}.links[${i}].url`, "must be an https URL");
        return [];
      }
      return [{ label, url }];
    });
  }

  strings(o: Raw, key: string, path: string): string[] {
    return this.list(o, key, path).flatMap((v, i) => {
      if (typeof v === "string" && v.trim()) return [v.trim()];
      this.fail(`${path}.${key}[${i}]`, "must be a non-empty string");
      return [];
    });
  }

  history(o: Raw, path: string): HistoryEntry[] {
    return this.list(o, "history", path).flatMap((h, i) => {
      const ho = this.obj(h, `${path}.history[${i}]`);
      if (!ho) return [];
      const at = this.date(ho, "at", `${path}.history[${i}]`);
      const event = this.str(ho, "event", `${path}.history[${i}]`);
      return at && event ? [{ at, event }] : [];
    });
  }
}

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
  if (root.schema !== "atlas/v1") r.fail("schema", 'must be "atlas/v1"');

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
    return [
      {
        id,
        name,
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
        observe: observe ? { githubWorkflow: r.str(observe, "github_workflow", `${path}.observe`, false) } : undefined,
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
