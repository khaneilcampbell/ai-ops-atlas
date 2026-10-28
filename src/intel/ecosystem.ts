import type { Catalog } from "../catalog/types";
import type { EcoContext, EcoReport, Run } from "./types";

/**
 * The catalog as the Senior Engineering Reviewer sees it: every project and agent with the
 * governance fields that matter for a review. Pure, so it can be tested; the Rust side
 * bounds and checks it again.
 */
export function ecosystemContext(catalog: Catalog): EcoContext {
  const projectName = new Map(catalog.projects.map((p) => [p.id, p.name]));
  return {
    projects: catalog.projects.map((p) => ({ id: p.id, name: p.name, repository: p.repository, status: p.status })),
    agents: catalog.agents.map((a) => {
      const g = a.registry?.governance;
      return {
        id: a.id,
        name: a.name,
        project: projectName.get(a.projectId) ?? a.projectId,
        repository: a.repository,
        kind: a.registry?.classification?.type ?? null,
        autonomy: typeof g?.autonomy === "number" ? g.autonomy : null,
        autonomy_note: g?.autonomyNote ?? null,
        trigger: a.trigger ?? null,
        permissions: a.permissions ?? [],
        // A live source Atlas can read: a GitHub workflow or its own run log.
        telemetry: !!(a.observe?.githubWorkflow || a.observe?.atlasIntel),
        status: a.status,
        approval: g?.approval ?? null,
        risk: g?.risk ?? null,
      };
    }),
  };
}

export const REVIEW_AGENT_ID = "atlas-engineering-review";
export const REVIEW_AGENT_NAME = "Senior Engineering Reviewer";

/** Repository Intelligence runs and engineering reviews share one run log. */
export const isReviewRun = (r: Pick<Run, "kind">) => r.kind === "ecosystem";

export const AREA_LABEL: Record<string, string> = {
  security: "Security",
  reliability: "Reliability and CI",
  testing: "Testing",
  dependencies: "Dependencies",
  autonomy: "Agents and autonomy",
  observability: "Observability",
  cost: "Cost",
  documentation: "Documentation",
  tooling: "Tooling",
};

export const EFFORT_LABEL = { hours: "Hours", a_day: "About a day", a_week: "About a week" } as const;
export const WHEN_LABEL = { now: "Do now", next: "Next", later: "Later" } as const;

/** Verified findings across every reviewed repository, most severe first. */
export function allFindings(r: EcoReport) {
  const order = ["critical", "high", "medium", "low", "info"];
  return r.repos
    .flatMap((e) => e.findings.map((f) => ({ ...f, repo: e.repo })))
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}
