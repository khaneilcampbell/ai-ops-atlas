import { isAiAgent } from "./roles";
import { AUTOMATION_INFO, DISTRICT_INFO, DISTRICTS, TIER_INFO, type AgentTier, type AutomationCategory, type DistrictId } from "./taxonomy";
import type { Agent, Catalog, Project, Status } from "./types";
import type { Classification, TriggerType } from "../registry/types";

// Deterministic organization of the catalog: which district a project sits in, which tier an
// agent works at and what an automation does. A value a manifest declares always wins; otherwise
// fixed rules decide, and every answer says which happened and why. No model is involved.

/** The project that is this app. Mirrors ATLAS_PROJECT in lib/connections, which this module must not import. */
const ATLAS = "ai-ops-atlas";

export interface Decided<T> {
  value: T;
  /** declared: written in the manifest. inferred: worked out by the rules below. */
  provenance: "declared" | "inferred";
  reason: string;
}

const has = (tags: string[], re: RegExp) => tags.some((t) => re.test(t));

/** The most common registry category among a project's items, leaving out CI pipelines that every project has. */
function mainCategory(agents: Agent[]) {
  const counts = new Map<string, number>();
  for (const a of agents) {
    const c = a.registry?.category;
    if (!c || a.registry?.classification?.type === "D") continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0];
}

/** Which district a project belongs to: the manifest's `district`, else a rule on its tags and items. */
export function districtOf(project: Project, agents: Agent[]): Decided<DistrictId> {
  if (project.district) return { value: project.district, provenance: "declared", reason: `project.district in ${project.file ?? "its manifest"}` };
  const own = agents.filter((a) => a.projectId === project.id);
  const cat = mainCategory(own);
  const t = project.tags;
  const inferred = (value: DistrictId, reason: string): Decided<DistrictId> => ({ value, provenance: "inferred", reason });
  if (project.id === ATLAS) return inferred("ai-operations", "Atlas is the command center");
  if (has(t, /^(career|portfolio|profile|resume)/i) || cat === "career") return inferred("career-portfolio", "career or portfolio tags or items");
  if (has(t, /^(security|soc|splunk|siem|itsm|detection)/i) || cat === "security" || cat === "infrastructure") return inferred("security-infrastructure", "security or infrastructure tags or items");
  if (has(t, /^(commerce|shopify|stripe|business|benjaire)/i) || cat === "business") return inferred("business-operations", "business tags or items");
  return inferred("ai-engineering", "no business, security or career signals");
}

/** Central: Atlas items other than its own CI. Coordinator: lists two or more items of its project as dependencies. */
export function tierOf(agent: Agent, catalog: Catalog): Decided<AgentTier> {
  const declared = agent.registry?.tier;
  if (declared) return { value: declared, provenance: "declared", reason: "registry.tier in the manifest" };
  const type = agent.registry?.classification?.type;
  if (agent.projectId === ATLAS && type !== "D") return { value: "central", provenance: "inferred", reason: "runs inside Atlas and works on other repositories" };
  const sameProject = new Set(catalog.agents.filter((a) => a.projectId === agent.projectId && a.id !== agent.id).map((a) => a.id));
  const runs = (agent.registry?.responsibilities?.dependencies ?? []).filter((d) => sameProject.has(d));
  if (runs.length >= 2) return { value: "coordinator", provenance: "inferred", reason: `lists ${runs.length} items of its project under dependencies` };
  return { value: "specialized", provenance: "inferred", reason: "does one job in its project" };
}

/** What an item does, from its classification, category and subcategory, in a fixed order of rules. */
export function automationCategoryOf(agent: Agent, district?: DistrictId): Decided<AutomationCategory> {
  const declared = agent.registry?.automationCategory;
  if (declared) return { value: declared, provenance: "declared", reason: "registry.automation_category in the manifest" };
  const reg = agent.registry;
  const type = reg?.classification?.type;
  const sub = reg?.subcategory ?? "";
  const inferred = (value: AutomationCategory, reason: string): Decided<AutomationCategory> => ({ value, provenance: "inferred", reason });
  if (type === "D") return reg?.category === "security" ? inferred("security", "security CI pipeline") : inferred("ci", "CI/CD pipeline");
  if (reg?.category === "security") return inferred("security", "security category");
  if (/ci\/cd|release/i.test(sub)) return inferred("ci", `subcategory "${sub}"`);
  if (reg?.category === "business") return inferred("business", "business category");
  if (/health|monitor|alert|status/i.test(sub)) return inferred("monitoring", `subcategory "${sub}"`);
  if (/backup|maintenance|validation|code quality|documentation/i.test(sub)) return inferred("maintenance", `subcategory "${sub}"`);
  if (isAiAgent(agent) || reg?.category === "data") return inferred("intelligence", "uses an AI model or works on data");
  if (district === "business-operations") return inferred("business", "runs in the Business Operations district");
  if (district === "security-infrastructure") return inferred("security", "runs in the Security & Infrastructure district");
  return inferred("maintenance", "no more specific rule matched");
}

/**
 * The standard record for one registered item, the shape future discovery (n8n, local runners,
 * other CI) can produce too. Every field comes from the manifest or the rules above; runtime
 * observations stay in the GitHub snapshot and run logs and are joined in where they are shown.
 */
export interface OrgRecord {
  id: string;
  name: string;
  /** "ai-agent" for classifications A, B and F; "automation" for everything else. */
  kind: "ai-agent" | "automation";
  classification: Classification;
  /** Registry subcategory, else the classification label. */
  role: string;
  projectId: string;
  repository: string;
  district: Decided<DistrictId>;
  tier: Decided<AgentTier>;
  category: Decided<AutomationCategory>;
  responsibilities: string[];
  /** Declared in the manifest, not observed. */
  status: Status;
  trigger: string | null;
  triggerType: TriggerType | null;
  source: string | null;
  /** Where Atlas can observe runs: a GitHub Actions workflow file, the app's own run log, or nowhere yet. */
  observedVia: { kind: "github-actions"; workflow: string } | { kind: "atlas-run-log" } | { kind: "none" };
}

export interface Organization {
  districts: Map<string, Decided<DistrictId>>;
  records: Map<string, OrgRecord>;
}

export function organize(catalog: Catalog): Organization {
  const districts = new Map(catalog.projects.map((p) => [p.id, districtOf(p, catalog.agents)]));
  const records = new Map<string, OrgRecord>();
  for (const a of catalog.agents) {
    // Every agent comes from a project manifest, so its district is always known.
    const district = districts.get(a.projectId) ?? { value: "ai-engineering", provenance: "inferred", reason: "project not in the catalog" };
    const wf = a.observe?.githubWorkflow;
    records.set(a.id, {
      id: a.id,
      name: a.name,
      kind: isAiAgent(a) ? "ai-agent" : "automation",
      classification: a.registry?.classification?.type ?? "unclassified",
      role: a.registry?.subcategory ?? a.framework,
      projectId: a.projectId,
      repository: a.repository,
      district,
      tier: tierOf(a, catalog),
      category: automationCategoryOf(a, district.value),
      responsibilities: a.registry?.responsibilities?.tasks ?? a.capabilities ?? [],
      status: a.status,
      trigger: a.trigger ?? null,
      triggerType: a.registry?.execution?.triggerType ?? null,
      source: a.source ?? null,
      observedVia: wf ? { kind: "github-actions", workflow: wf } : a.observe?.atlasIntel ? { kind: "atlas-run-log" } : { kind: "none" },
    });
  }
  return { districts, records };
}

export const districtLabel = (d: DistrictId) => DISTRICT_INFO[d].label;
export const tierLabel = (t: AgentTier) => TIER_INFO[t].label;
export const categoryLabel = (c: AutomationCategory) => AUTOMATION_INFO[c].label;
/** Fixed district order for layout and lists. */
export const districtRank = (d: DistrictId) => DISTRICTS.indexOf(d);
