import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import type { ManifestIssue } from "../catalog/types";
import { buildingPlaque } from "../views/map3d/plaques";
import { AGENCY_KEY, AGENCY_NAME } from "../views/map3d/marketingAgencyPlan";
import { MALL_KEY } from "../views/map3d/mallPlan";
import { DEALERSHIP_KEY } from "../views/map3d/dealershipPlan";
import { FINANCIAL_BUILDINGS, financialKey } from "../views/map3d/financialPlan";
import { LOOP_STATIONS } from "../views/map3d/perimeterRailPlan";
import { GALLERIA_KEY } from "../views/map3d/galleriaPlan";
import { STADIUM_KEY } from "../views/map3d/stadiumPlan";
import { AIRPORT_BUILDINGS, airportBuildingKey } from "../views/map3d/airportBuildings";
import { financialBuildingMatches, landmarkMatches } from "../lib/financialSearch";
import { BUILDING_NAMES, buildingAliases, buildingDisplayName, buildingNameIssues, buildingOrganization, currentBuildingName, parseBuildingNames } from "./names";

/** Every building id the map draws itself and can be renamed in catalog/workspace/buildings.yaml. */
const MAP_KEYS = new Set([AGENCY_KEY, MALL_KEY, DEALERSHIP_KEY, ...FINANCIAL_BUILDINGS.map((b) => financialKey(b.id)), ...LOOP_STATIONS.map((s) => s.id), GALLERIA_KEY, STADIUM_KEY, ...AIRPORT_BUILDINGS.map((b) => airportBuildingKey(b.id))]);

describe("workspace building names", () => {
  it("loads without problems and only names buildings that exist on the map", () => {
    expect(buildingNameIssues).toEqual([]);
    for (const key of Object.keys(BUILDING_NAMES)) expect(MAP_KEYS.has(key), key).toBe(true);
  });

  it("applies KC's operational names, keeping each original organization as metadata", () => {
    const want: [string, string, string][] = [
      [AGENCY_KEY, "Growth & Marketing Studio", "Benjaire"],
      [financialKey("residence"), "Data Intelligence Center", "Aldren Insights"],
      [financialKey("banks"), "Financial Operations Tower", "Bayvale Bank"],
      [financialKey("budget"), "Budget & Forecasting Center", "Ellery Budget Center"],
      [financialKey("records"), "Governance & Compliance Center", "Halden Trust"],
      [DEALERSHIP_KEY, "Infrastructure Operations Hub", "Vantor Motors"],
      [financialKey("investments"), "Integration Exchange", "Robin Exchange"],
      [MALL_KEY, "Product Marketplace", "Atlas"],
      ["service:atlas-station", "Workflow Automation Hub", "Atlas"],
      [financialKey("harbor-residence"), "Client Success Center", "Camton Hotel"],
      [financialKey("circa"), "Team Residence Towers", "Ellipse Residences"],
      [financialKey("insurance"), "Risk & Insurance Center", "Merrow Credit Union"],
      [financialKey("business-finance"), "Business Finance Center", "Corvane Capital"],
      ["service:atlas-galleria", "Vendor & Supplier Hub", "Atlas"],
      ["service:skyline-stadium", "Team Events Arena", "Atlas"],
      ["service:stadium-station", "Events Arena Station", "Atlas"],
      ["service:airport-building:terminal", "Passenger Terminal", "Atlas Airport"],
      ["service:airport-building:tower", "Air Traffic Control", "Atlas Airport"],
      ["service:airport-building:cargo", "Model Intelligence Lab", "Atlas Airport"],
      ["service:airport-building:operations", "Observability Center", "Atlas Airport"],
    ];
    for (const [key, name, org] of want) {
      expect(buildingDisplayName(key, "fallback"), key).toBe(name);
      expect(buildingOrganization(key), key).toBe(org);
    }
  });

  it("renames catalog buildings in their manifests, keeping ids, modules and the old name as an alias", () => {
    const want: [string, string, string | undefined, string][] = [
      ["ai-ops-atlas", "Atlas Command Center", "Atlas", "Atlas HQ"],
      ["benjaire-site", "Business Operations HQ", "Benjaire", "Benjaire HQ"],
      ["intelligence-hub", "Agent Operations Center", undefined, "Intelligence Hub"],
      ["commerce-pipeline", "Commerce Operations Center", undefined, "Commerce Pipeline"],
      ["soc-lab", "Security Operations Center", undefined, "SOC Lab"],
      ["portfolio-site", "Portfolio Web Studio", undefined, "Portfolio Site"],
    ];
    for (const [id, name, organization, former] of want) {
      const p = catalog.projects.find((p) => p.id === id)!;
      expect([p.name, p.organization, p.formerNames]).toEqual([name, organization, [former]]);
    }
  });

  it("leaves unconfigured buildings exactly as the map names them", () => {
    expect(buildingDisplayName("service:financial-park", "Financial Park")).toBe("Financial Park");
    expect(buildingDisplayName("service:atlas-commons", "Atlas Commons")).toBe("Atlas Commons");
    expect(buildingOrganization("service:financial-park")).toBeUndefined();
    expect(currentBuildingName("Atlas Marketplace")).toBe("Product Marketplace");
    expect(currentBuildingName("Financial District")).toBe("Financial District");
  });

  it("shows the display name on the map plaque and its title, without touching the plaque's keys", () => {
    const p = buildingPlaque({ id: AGENCY_KEY, select: AGENCY_KEY, name: AGENCY_NAME, x: 0, roof: 1, z: 0, priority: 1, mark: { kind: "unverified", label: "Planned" }, title: `${AGENCY_NAME} · Planned`, selKey: null, hover: null, onSelect: () => {} });
    expect([p.id, p.key, p.title]).toEqual([AGENCY_KEY, AGENCY_KEY, "Growth & Marketing Studio · Planned"]);
    expect(JSON.stringify(p.node)).toContain("Growth & Marketing Studio");
    expect(JSON.stringify(p.node)).not.toContain("…");
  });

  it("still finds renamed buildings by their old names and organizations in search", () => {
    expect(financialBuildingMatches("Bayvale").map((b) => b.id)).toContain("banks");
    expect(financialBuildingMatches("Financial Operations").map((b) => b.id)).toContain("banks");
    expect(landmarkMatches("Vantor").map((n) => n.key)).toEqual([DEALERSHIP_KEY]);
    expect(landmarkMatches("Central Station").map((n) => n.key)).toEqual(["service:atlas-station"]);
    expect(buildingAliases(MALL_KEY)).toEqual(["Atlas Marketplace"]);
  });

  it("reports bad entries instead of throwing, and lets another workspace bring its own names", () => {
    const issues: ManifestIssue[] = [];
    const names = parseBuildingNames("x.yaml", 'schema: atlas/buildings-v1\nbuildings:\n  "service:acme-tower":\n    display_name: Acme Ops\n  "Bad Key":\n    display_name: X\n  "service:empty": {}\n', issues);
    expect(Object.keys(names)).toEqual(["service:acme-tower"]);
    expect(buildingDisplayName("service:acme-tower", "Tower", names)).toBe("Acme Ops");
    expect(issues.map((i) => i.message)).toEqual([expect.stringMatching(/Bad Key/), expect.stringMatching(/display_name: is required/)]);
    expect(parseBuildingNames("y.yaml", "buildings: [", [])).toEqual({});
  });
});
