import { MODULE_TYPE_IDS, type AtlasModuleType, type ModuleAvailability, type ModuleCapability, type ModuleTypeId } from "./types";

// The platform module catalog. Every capability is "planned" unless Atlas already does it today,
// and an available one names the code that does it (checked by catalog.test.ts). Nothing here
// names a workspace or a business: Benjaire, KC's sites and the rest are instances (./instances.ts).

const on = (id: string, label: string, evidence: string): ModuleCapability => ({ id, label, state: "available", evidence });
const later = (id: string, label: string): ModuleCapability => ({ id, label, state: "planned" });

const V = "1.0.0";

const TYPES: AtlasModuleType[] = [
  // Command & Governance
  {
    id: "atlas-command-center", version: V, name: "Atlas Command Center", productDistrict: "command-governance",
    description: "Unified administration and operational visibility across the workspace.",
    capabilities: [
      on("dashboard", "System-wide dashboard", "src/views/MissionControl.tsx"),
      on("services", "Connected services overview", "src/lib/connections.ts"),
      on("inventory", "Building and module inventory", "src/modules/inventory.ts moduleInventory"),
      on("health", "Operational health", "src/lib/derive.ts attentionItems"),
      on("activity", "Recent activity", "src/views/Activity.tsx"),
      on("alerts", "Alerts and notifications", "src/alerts/alerts.ts"),
      on("search", "Global search", "src/lib/search.ts"),
      on("environment", "Environment configuration", "src/views/Settings.tsx"),
    ],
    connectors: ["github", "agent-feed", "live-feed"], views: ["overview", "activity", "map", "settings"], actions: [], permissions: [],
  },
  {
    id: "identity-governance-tower", version: V, name: "Identity & Governance Tower", productDistrict: "command-governance",
    description: "Users, roles, connector authorization and audit for a workspace.",
    capabilities: [later("users", "Users and roles"), later("connector-auth", "Connector authorization"), later("audit", "Workspace audit log"), on("entitlements", "Module entitlements", "src/modules/workspace.ts")],
    connectors: [], views: [], actions: [], permissions: [],
  },
  // AI & Automation
  {
    id: "agent-operations-center", version: V, name: "Agent Operations Center", productDistrict: "ai-automation",
    description: "Registry and observation of the workspace's AI agents.",
    capabilities: [
      on("registry", "Agent registry", "src/registry/registry.ts"),
      on("status", "Agent status and availability", "src/registry/telemetry.ts"),
      on("responsibilities", "Assigned responsibilities", "src/registry/types.ts RegistryManifest.responsibilities"),
      on("models-tools", "Connected models and tools", "src/catalog/types.ts Agent.model"),
      on("history", "Execution history", "src/registry/telemetry.ts"),
      on("kpis", "Performance indicators", "src/registry/types.ts Kpi"),
      on("tokens", "Token usage where available", "src/usage/agents.ts"),
      on("errors", "Agent-level error tracking", "src/alerts/alerts.ts"),
      on("approvals", "Human approval for sensitive actions", "src/approvals/proposals.ts"),
    ],
    connectors: ["github", "agent-feed", "atlas-intel", "usage-sync"], views: ["agents", "usage"], actions: [], permissions: [],
  },
  {
    id: "workflow-automation-plant", version: V, name: "Workflow Automation Plant", productDistrict: "ai-automation",
    description: "Read-only visibility into the workspace's automation workflows.",
    capabilities: [
      on("inventory", "Automation inventory", "src/views/Agents.tsx kind=automations"),
      on("triggers", "Trigger information", "src/registry/types.ts execution.triggerType"),
      on("status", "Workflow status", "src/registry/telemetry.ts"),
      on("history", "Execution history (GitHub Actions)", "src/registry/telemetry.ts"),
      on("failures", "Failed execution visibility", "src/alerts/alerts.ts"),
      on("related-agents", "Related agents", "src/catalog/types.ts DeclaredConnection"),
      on("n8n", "Live n8n execution data", "src/n8n/runs.ts useN8nRuns"),
      on("dependencies", "Workflow dependency map", "src/modules/inventory.ts workflowMap"),
    ],
    connectors: ["github", "n8n"], views: ["automations"], actions: [], permissions: [],
  },
  {
    id: "model-intelligence-lab", version: V, name: "Model Intelligence Lab", productDistrict: "ai-automation",
    description: "Model choice, evaluation and cost comparison.",
    capabilities: [later("models", "Model inventory"), later("evals", "Evaluations"), later("cost", "Cost per model")],
    connectors: [], views: [], actions: [], permissions: [],
  },
  // Infrastructure & Engineering
  {
    id: "infrastructure-control-tower", version: V, name: "Infrastructure Control Tower", productDistrict: "infrastructure-engineering",
    description: "Hosting, deployments and infrastructure health.",
    capabilities: [
      on("hosts", "Hosting inventory", "src/infra/hosts.ts HOSTS"),
      on("deploys", "Deployment overview", "src/infra/deploys.ts useHostDeploys"),
      later("incidents", "Infrastructure incidents"),
    ],
    connectors: ["github"], views: [], actions: [], permissions: [],
  },
  {
    id: "development-repository-hub", version: V, name: "Development & Repository Hub", productDistrict: "infrastructure-engineering",
    description: "Repositories, CI/CD and recent development activity.",
    capabilities: [
      on("inventory", "GitHub repository inventory", "src/views/Repos.tsx"),
      on("status", "Repository status", "src/lib/derive.ts verifiedState"),
      on("activity", "Recent activity", "src/lib/derive.ts activityFeed"),
      on("ci", "CI/CD status", "src/lib/derive.ts ciSummary"),
      on("deploys", "Deployment information where available", "src/properties/deploys.ts"),
      on("health", "Repository health", "src/lib/derive.ts repoHealth"),
      on("linked", "Connected agents and automations", "src/catalog/projects.ts projectRepositories"),
      on("dependencies", "Project dependency information", "src/modules/inventory.ts projectDependencies"),
    ],
    connectors: ["github"], views: ["repos", "grid"], actions: ["rerun-failed-jobs"], permissions: ["github:actions:write"],
  },
  {
    id: "security-operations-center", version: V, name: "Security Operations Center", productDistrict: "infrastructure-engineering",
    description: "Detections, security scanning and incident response.",
    capabilities: [later("detections", "Detection inventory"), on("scanning", "Security scanning results", "src/security/alerts.ts useSecurityAlerts"), later("incidents", "Security incidents")],
    connectors: ["github-security"], views: [], actions: [], permissions: [],
  },
  // Business Operations
  {
    id: "business-operations-hq", version: V, name: "Business Operations HQ", productDistrict: "business-operations",
    description: "A connected business and the digital operations behind it.",
    capabilities: [
      on("projects", "Associated projects", "src/catalog/types.ts Project"),
      on("apps", "Connected applications", "src/properties/registry.ts"),
      on("agents", "Related agents", "src/catalog/workplaces.ts projectOfficeAgents"),
      later("overview", "Business workspace overview"),
      later("assignments", "Automation assignments"),
      later("kpis", "Operational KPIs"),
      later("config", "Business-specific configuration"),
    ],
    connectors: ["github"], views: ["map"], actions: [], permissions: [],
  },
  {
    id: "finance-analytics-tower", version: V, name: "Finance & Analytics Tower", productDistrict: "business-operations",
    description: "Spend, revenue and financial reporting.",
    capabilities: [
      on("ai-spend", "AI and API spend", "src/usage/model.ts"),
      on("caps", "Spend against caps", "src/finance/caps.ts capStatus"),
      later("revenue", "Revenue reporting"),
      later("forecasts", "Budgets and forecasts"),
    ],
    connectors: ["usage-sync"], views: ["usage"], actions: [], permissions: [],
  },
  {
    id: "growth-marketing-studio", version: V, name: "Growth & Marketing Studio", productDistrict: "business-operations",
    description: "Campaigns, content and audience growth.",
    capabilities: [
      later("campaigns", "Campaigns"),
      later("content", "Content pipeline"),
      on("audience", "Site traffic", "src/growth/studio.ts siteTraffic"),
      on("research", "Product research briefs", "src/growth/studio.ts researchBriefs"),
    ],
    connectors: ["agent-feed"], views: [], actions: [], permissions: [],
  },
  {
    id: "commerce-product-marketplace", version: V, name: "Commerce & Product Marketplace", productDistrict: "business-operations",
    description: "Products, orders and the pipelines that publish them.",
    capabilities: [later("catalog", "Product catalog"), later("orders", "Orders"), later("pipeline", "Publishing pipeline status")],
    connectors: [], views: [], actions: [], permissions: [],
  },
  // Data & Intelligence
  {
    id: "data-intelligence-center", version: V, name: "Data Intelligence Center", productDistrict: "data-intelligence",
    description: "Analysis and recommendations across the workspace.",
    capabilities: [on("insights", "Insights and engineering review", "src/views/Intelligence.tsx"), on("datasets", "Dataset inventory", "src/modules/inventory.ts datasetInventory")],
    connectors: ["atlas-intel"], views: ["intel"], actions: [], permissions: [],
  },
  {
    id: "knowledge-repository", version: V, name: "Knowledge Repository", productDistrict: "data-intelligence",
    description: "Documentation and knowledge bases the workspace relies on.",
    capabilities: [later("docs", "Document inventory"), later("search", "Knowledge search")],
    connectors: [], views: [], actions: [], permissions: [],
  },
  {
    id: "observability-center", version: V, name: "Observability Center", productDistrict: "data-intelligence",
    description: "Logs, metrics and traces from connected systems.",
    capabilities: [later("metrics", "Metrics"), later("logs", "Logs"), later("traces", "Traces")],
    connectors: [], views: [], actions: [], permissions: [],
  },
  {
    id: "integration-exchange", version: V, name: "Integration Exchange", productDistrict: "data-intelligence",
    description: "Connector catalog and integration contracts.",
    capabilities: [later("catalog", "Connector catalog"), on("contracts", "Integration contracts", "src/modules/integrations.ts")],
    connectors: [], views: [], actions: [], permissions: [],
  },
];

/** Every module type by id. A missing or duplicate id fails catalog.test.ts. */
export const MODULE_TYPES: Readonly<Record<ModuleTypeId, AtlasModuleType>> = Object.fromEntries(TYPES.map((t) => [t.id, t])) as Record<ModuleTypeId, AtlasModuleType>;
export const MODULE_TYPE_LIST: readonly AtlasModuleType[] = MODULE_TYPE_IDS.map((id) => MODULE_TYPES[id]);

/** The five foundational modules that get operational workspaces first (Phase 2). */
export const CORE_MODULES: readonly ModuleTypeId[] = ["atlas-command-center", "agent-operations-center", "workflow-automation-plant", "development-repository-hub", "business-operations-hq"];

export function isModuleType(id: unknown): id is ModuleTypeId {
  return typeof id === "string" && (MODULE_TYPE_IDS as readonly string[]).includes(id);
}

export function moduleType(id: ModuleTypeId | null | undefined): AtlasModuleType | undefined {
  return id ? MODULE_TYPES[id] : undefined;
}

export function moduleAvailability(t: Pick<AtlasModuleType, "capabilities">): ModuleAvailability {
  const n = t.capabilities.filter((c) => c.state === "available").length;
  return n === 0 ? "planned" : n === t.capabilities.length ? "available" : "partial";
}

/** For tests: the raw list, to catch duplicate ids the record would hide. */
export const MODULE_TYPE_SOURCE: readonly AtlasModuleType[] = TYPES;
