// The organizational vocabulary for the catalog: infrastructure districts, agent tiers and
// automation categories. Manifests may declare any of them; otherwise Atlas works them out with
// the fixed rules in ./organization.ts, never with a model.

export const DISTRICTS = ["ai-operations", "business-operations", "ai-engineering", "security-infrastructure", "career-portfolio"] as const;
export type DistrictId = (typeof DISTRICTS)[number];

export const DISTRICT_INFO: Record<DistrictId, { label: string; description: string }> = {
  "ai-operations": { label: "AI Operations", description: "The command center that observes and operates the rest of the ecosystem." },
  "business-operations": { label: "Business Operations", description: "Revenue, customer and commerce systems." },
  "ai-engineering": { label: "AI Engineering", description: "Tools, knowledge bases and experiments for building with AI." },
  "security-infrastructure": { label: "Transport & Infrastructure", description: "Detection, IT service, security tooling and the airport side of the city." },
  "career-portfolio": { label: "Career & Commerce", description: "Public profile, portfolio, job search and the marketplace side of the city." },
};

/**
 * Where each part of the city belongs on Khaneil's compass map (2026-11-24 reference image): Atlas Command
 * Center and Atlas Commons in the middle, then one zone on each side. Zones only label things for now;
 * the map layout does not read them yet.
 */
export const ZONES = ["centre", "north", "west", "east", "south"] as const;
export type ZoneId = (typeof ZONES)[number];

export const ZONE_INFO: Record<ZoneId, { label: string; side: string }> = {
  centre: { label: "Atlas Command Center", side: "Centre" },
  north: { label: "AI Operations District", side: "North" },
  west: { label: "Transport & Infrastructure", side: "West" },
  east: { label: "Business District", side: "East" },
  south: { label: "Career & Commerce District", side: "South" },
};

/** Every district's zone. */
export const DISTRICT_ZONE: Record<DistrictId, ZoneId> = {
  "ai-operations": "north",
  "ai-engineering": "north",
  "security-infrastructure": "west",
  "business-operations": "east",
  "career-portfolio": "south",
};

/** Projects that sit somewhere other than their district's side: the Command Center is the middle. */
export const PROJECT_ZONE: Readonly<Record<string, ZoneId>> = { "ai-ops-atlas": "centre" };

export const zoneOf = (projectId: string, district: DistrictId): ZoneId => PROJECT_ZONE[projectId] ?? DISTRICT_ZONE[district];
export const zoneLabel = (z: ZoneId) => `${ZONE_INFO[z].side} · ${ZONE_INFO[z].label}`;

export const AGENT_TIERS = ["central", "coordinator", "specialized"] as const;
export type AgentTier = (typeof AGENT_TIERS)[number];

export const TIER_INFO: Record<AgentTier, { label: string; description: string }> = {
  central: { label: "Central Operations", description: "Works across the whole ecosystem from Atlas." },
  coordinator: { label: "Department Coordinator", description: "Orchestrates other agents or automations in its project." },
  specialized: { label: "Specialized Agent", description: "Does one job inside its project." },
};

export const AUTOMATION_CATEGORIES = ["ci", "security", "monitoring", "business", "intelligence", "maintenance"] as const;
export type AutomationCategory = (typeof AUTOMATION_CATEGORIES)[number];

export const AUTOMATION_INFO: Record<AutomationCategory, { label: string; description: string }> = {
  ci: { label: "Continuous Integration", description: "Tests, builds, releases and CI operations." },
  security: { label: "Security", description: "Security checks, scanning and detection." },
  monitoring: { label: "Monitoring", description: "Health checks and status reporting." },
  business: { label: "Business", description: "Commerce, customer and revenue work." },
  intelligence: { label: "Intelligence", description: "AI analysis, research and recommendations." },
  maintenance: { label: "Maintenance", description: "Backups, validation, documentation and upkeep." },
};
