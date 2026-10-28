import type { Catalog, Status } from "../catalog/types";
import type { RepoState } from "../github/types";
import type { AgentStatus } from "../intel/types";
import type { AgentRun } from "../live/apply";
import { repoData } from "../lib/derive";
import { matches } from "../lib/search";
import { documentationScore, toProfile, type AgentProfile } from "./profile";
import { operationalState, telemetryFor } from "./telemetry";
import { CATEGORY_LABEL, CLASSIFICATION_INFO, type Classification, type Operational, type Telemetry } from "./types";

/** One directory row: the hand-maintained profile plus what Atlas observed at runtime. */
export interface RegistryEntry {
  profile: AgentProfile;
  status: Status;
  telemetry: Telemetry;
  operational: Operational;
  docs: { done: number; total: number; missing: string[] };
  /** Reasons this entry needs a person's review; empty when none. */
  review: string[];
}

/** The app's own agent runs: the full status on the Mac, or only the runs the Mac reported on the
 *  website. `agentRuns` are the phase results outside pipelines sent to the live feed. */
export type IntelSource = Pick<AgentStatus, "runs"> & Partial<Pick<AgentStatus, "month_spent_usd" | "config">> & { agentRuns?: AgentRun[] | null };

export function buildRegistry(catalog: Catalog, repos: Record<string, RepoState>, intel: IntelSource | null): RegistryEntry[] {
  const spend = intel?.config && intel.month_spent_usd != null ? { month: intel.month_spent_usd, budget: intel.config.monthly_budget_usd } : null;
  return catalog.agents.map((a) => {
    const profile = toProfile(a, catalog.projects.find((p) => p.id === a.projectId));
    const telemetry = telemetryFor(a, repoData(repos[a.repository]), intel ? intel.runs : null, spend, intel?.agentRuns ?? null);
    const operational = operationalState(profile, telemetry);
    const docs = documentationScore(profile);
    return { profile, status: a.status, telemetry, operational, docs, review: reviewReasons(profile, operational, a.status) };
  });
}

function reviewReasons(p: AgentProfile, op: Operational, status: Status): string[] {
  const out: string[] = [];
  if (status === "attention") out.push("Marked as needing attention in its manifest");
  if (op === "failing") out.push("Latest observed run failed");
  if (p.classification === "unclassified") out.push("Not classified");
  else if (p.confidence && p.confidence !== "verified") out.push(`Classification is ${p.confidence}`);
  if (p.governance.autonomy !== null && p.governance.autonomy >= 3 && p.governance.permissions.length === 0) out.push("Can act on external systems but no permissions are documented");
  if (p.governance.risk === "high") out.push("High risk");
  return out;
}

export type GroupKey = "none" | "project" | "category" | "classification" | "operational" | "runtime";
export const GROUP_LABEL: Record<GroupKey, string> = {
  none: "No grouping",
  project: "Project",
  category: "Function",
  classification: "Agent type",
  operational: "Operational status",
  runtime: "Runtime",
};

export type SortKey = "title" | "project" | "category" | "classification" | "lastRun" | "risk" | "docs";
export const SORT_LABEL: Record<SortKey, string> = {
  title: "Title",
  project: "Project",
  category: "Function",
  classification: "Agent type",
  lastRun: "Last verified run",
  risk: "Risk",
  docs: "Documentation",
};

export interface RegistryFilter {
  query: string;
  project: string;
  category: string;
  classification: string;
  operational: string;
  runtime: string;
}

export const EMPTY_FILTER: RegistryFilter = { query: "", project: "", category: "", classification: "", operational: "", runtime: "" };

export function runtimeOf(e: RegistryEntry) {
  return e.profile.execution.environment ?? "Not documented";
}

export function filterEntries(entries: RegistryEntry[], f: RegistryFilter): RegistryEntry[] {
  return entries.filter((e) => {
    const p = e.profile;
    return (
      (!f.project || p.project.id === f.project) &&
      (!f.category || p.category === f.category) &&
      (!f.classification || p.classification === f.classification) &&
      (!f.operational || e.operational === f.operational) &&
      (!f.runtime || runtimeOf(e) === f.runtime) &&
      matches(
        f.query,
        p.title,
        p.originalName,
        p.id,
        p.summary,
        p.framework,
        p.model,
        p.project.name,
        p.repository,
        CATEGORY_LABEL[p.category],
        p.subcategory,
        CLASSIFICATION_INFO[p.classification].label,
        ...p.responsibilities.tasks,
        ...p.responsibilities.tools,
      )
    );
  });
}

const CLASS_ORDER: Classification[] = ["A", "B", "C", "D", "E", "F", "unclassified"];
const RISK_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function sortEntries(entries: RegistryEntry[], key: SortKey, desc = false): RegistryEntry[] {
  const val = (e: RegistryEntry): string | number => {
    const p = e.profile;
    switch (key) {
      case "title":
        return p.title.toLowerCase();
      case "project":
        return p.project.name.toLowerCase();
      case "category":
        return CATEGORY_LABEL[p.category];
      case "classification":
        return CLASS_ORDER.indexOf(p.classification);
      case "lastRun":
        // Never run sorts after everything else ascending.
        return e.telemetry.lastVerifiedRun ? -Date.parse(e.telemetry.lastVerifiedRun.at) : Number.MAX_SAFE_INTEGER;
      case "risk":
        return p.governance.risk ? RISK_ORDER[p.governance.risk] : 3;
      case "docs":
        return e.docs.done / e.docs.total;
    }
  };
  const out = [...entries].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c || a.profile.title.localeCompare(b.profile.title);
  });
  return desc ? out.reverse() : out;
}

export function groupEntries(entries: RegistryEntry[], key: GroupKey): { key: string; label: string; entries: RegistryEntry[] }[] {
  if (key === "none") return [{ key: "all", label: "All agents", entries }];
  const label = (e: RegistryEntry): [string, string] => {
    const p = e.profile;
    switch (key) {
      case "project":
        return [p.project.id, p.project.name];
      case "category":
        return [p.category, CATEGORY_LABEL[p.category]];
      case "classification":
        return [p.classification, `${p.classification === "unclassified" ? "" : `Type ${p.classification} · `}${CLASSIFICATION_INFO[p.classification].label}`];
      case "operational":
        return [e.operational, e.operational];
      case "runtime":
        return [runtimeOf(e), runtimeOf(e)];
    }
  };
  const groups = new Map<string, { key: string; label: string; entries: RegistryEntry[] }>();
  for (const e of entries) {
    const [k, l] = label(e);
    if (!groups.has(k)) groups.set(k, { key: k, label: l, entries: [] });
    groups.get(k)!.entries.push(e);
  }
  const order = key === "classification" ? (k: string) => CLASS_ORDER.indexOf(k as Classification) : null;
  return [...groups.values()].sort((a, b) => (order ? order(a.key) - order(b.key) : a.label.localeCompare(b.label)));
}

export interface PortfolioSummary {
  total: number;
  byClass: Record<Classification, number>;
  byCategory: Record<string, number>;
  operational: Record<Operational, number>;
  /** Entries with a declared live source; the rest cannot be verified by Atlas yet. */
  observable: number;
  missingDocs: RegistryEntry[];
  needsReview: RegistryEntry[];
  withKpis: number;
  withObservedKpis: number;
}

export function summarize(entries: RegistryEntry[]): PortfolioSummary {
  const byClass = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<Classification, number>;
  const byCategory: Record<string, number> = {};
  const operational: Record<Operational, number> = { verified: 0, failing: 0, configured: 0, planned: 0 };
  for (const e of entries) {
    byClass[e.profile.classification]++;
    byCategory[e.profile.category] = (byCategory[e.profile.category] ?? 0) + 1;
    operational[e.operational]++;
  }
  return {
    total: entries.length,
    byClass,
    byCategory,
    operational,
    observable: entries.filter((e) => e.telemetry.source).length,
    // Half the profile undocumented is the bar for "missing documentation".
    missingDocs: entries.filter((e) => e.docs.done / e.docs.total < 0.5),
    needsReview: entries.filter((e) => e.review.length > 0),
    withKpis: entries.filter((e) => e.profile.goals.kpis.length > 0).length,
    withObservedKpis: entries.filter((e) => e.profile.goals.kpis.some((k) => k.measure) && e.telemetry.source).length,
  };
}
