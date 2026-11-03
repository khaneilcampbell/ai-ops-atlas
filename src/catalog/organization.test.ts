import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { automationCategoryOf, districtOf, organize, tierOf } from "./organization";
import { buildCatalog } from "./parse";
import type { Agent, Project } from "./types";

const dir = join(__dirname, "../../catalog");
const files = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
);
const { catalog, issues } = buildCatalog(files);
const org = organize(catalog);

const project = (p: Partial<Project>): Project => ({ id: "demo", name: "Demo", summary: "", status: "active", repository: "me/demo", tags: [], links: [], agentIds: [], ...p });
const agent = (a: Partial<Agent>): Agent => ({ id: "a", name: "A", purpose: "", framework: "f", status: "idle", lastRun: null, history: [], links: [], projectId: "demo", repository: "me/demo", ...a });

describe("districts", () => {
  it("reads every project's district from its manifest", () => {
    expect(issues).toEqual([]);
    const by = Object.fromEntries(catalog.projects.map((p) => [p.id, org.districts.get(p.id)]));
    expect(Object.values(by).every((d) => d?.provenance === "declared")).toBe(true);
    expect(Object.fromEntries(Object.entries(by).map(([k, d]) => [k, d!.value]))).toEqual({
      "ai-ops-atlas": "ai-operations",
      "benjaire-site": "business-operations",
      "benjaire-ops": "business-operations",
      "commerce-pipeline": "business-operations",
      "intelligence-hub": "ai-engineering",
      "soc-lab": "security-infrastructure",
      "skyline": "business-operations",
      "service-desk": "security-infrastructure",
      "portfolio-site": "career-portfolio",
      "github-profile": "career-portfolio",
      "career-optimizer": "career-portfolio",
    });
  });

  it("infers the same districts when a manifest leaves the field out", () => {
    for (const p of catalog.projects) {
      const inferred = districtOf({ ...p, district: undefined }, catalog.agents);
      expect(inferred.provenance).toBe("inferred");
      expect([p.id, inferred.value]).toEqual([p.id, org.districts.get(p.id)!.value]);
    }
  });

  it("falls back to AI Engineering without any signal", () => {
    expect(districtOf(project({ tags: ["react"] }), []).value).toBe("ai-engineering");
  });

  it("rejects an unknown district", () => {
    const { issues } = buildCatalog({ "x.yaml": "schema: atlas/v2\nproject: { id: x, name: X, summary: s, status: active, repository: me/x, district: moon }\n" });
    expect(issues[0].message).toContain("project.district: must be one of");
  });
});

describe("agent tiers", () => {
  const tiers = (t: string) => [...org.records.values()].filter((r) => r.tier.value === t).map((r) => r.id).sort();

  it("puts Atlas agents that work across repositories at the center", () => {
    expect(tiers("central")).toEqual(["atlas-engineering-review", "atlas-github-steward", "atlas-merge-pr", "atlas-rerun-failed", "repo-intelligence"]);
  });

  it("makes orchestrators coordinators", () => {
    expect(tiers("coordinator")).toEqual(["commerce-loop"]);
  });

  it("keeps a declared tier", () => {
    expect(tierOf(agent({ registry: { tier: "coordinator" } }), { projects: [], agents: [] })).toMatchObject({ value: "coordinator", provenance: "declared" });
  });
});

describe("automation categories", () => {
  it("categorizes every item in the catalog", () => {
    const by: Record<string, string[]> = {};
    for (const r of org.records.values()) (by[r.category.value] ??= []).push(r.id);
    for (const ids of Object.values(by)) ids.sort();
    expect(by).toEqual({
      ci: ["atlas-ci", "atlas-merge-pr", "atlas-rerun-failed", "benjaire-ops-ci", "benjaire-site-ci", "career-ci", "commerce-tests", "github-merge-flow", "hub-ci", "site-ci", "soc-lab-ci"],
      security: ["bruteforce-detection", "security-check", "service-desk-codeql", "soc-case-notes"],
      business: [
        "benjaire-contact-worker",
        "benjaire-flow-intake",
        "benjaire-inquiry-to-client",
        "brand-strategist",
        "canva-mockups",
        "commerce-loop",
        "copy-strategist",
        "email-digest",
        "github-opportunity-scout",
        "launch-planner",
        "market-analyst",
        "niche-scout",
        "order-delivery",
        "sales-sync",
        "seo-maintainer",
        "shopify-publisher",
        "skyline-inquiry-assistant",
        "visual-director",
      ],
      monitoring: ["health-report"],
      intelligence: ["atlas-engineering-review", "atlas-performance-reviewer", "atlas-production-coordinator", "atlas-reliability-reviewer", "atlas-ui-improvement-designer", "job-analyst", "repo-intelligence", "resume-quality-review", "resume-tailor"],
      maintenance: ["atlas-github-steward", "atlas-system-improvements", "career-db-validator", "db-backup", "docs-builder", "github-design-consistency", "site-audit", "site-builder"],
    });
  });

  it("keeps a declared category", () => {
    expect(automationCategoryOf(agent({ registry: { automationCategory: "monitoring", classification: { type: "D", confidence: "verified" } } }))).toMatchObject({ value: "monitoring", provenance: "declared" });
  });
});

describe("records", () => {
  it("say where runs can be observed, and never invent a source", () => {
    expect(org.records.get("atlas-ci")?.observedVia).toEqual({ kind: "github-actions", workflow: "ci.yml" });
    expect(org.records.get("repo-intelligence")?.observedVia).toEqual({ kind: "atlas-run-log" });
    expect(org.records.get("niche-scout")?.observedVia).toEqual({ kind: "none" });
  });

  it("carry the identity fields for every agent", () => {
    for (const r of org.records.values()) {
      expect(r.id && r.name && r.role && r.projectId && r.district.value).toBeTruthy();
      expect(r.status).toBeTruthy();
    }
  });
});
