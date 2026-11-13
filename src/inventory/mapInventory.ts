import { isAiAgent } from "../catalog/roles";
import { OFF_MAP_PROJECTS } from "../catalog/projects";
import type { Agent, Catalog } from "../catalog/types";
import { MODULE_TYPES } from "../modules/catalog";
import { buildingDisplayName, buildingOrganization } from "../modules/names";
import type { ModuleTypeId } from "../modules/types";
import { LANDMARK_MODULES } from "../modules/workspace";
import { CLEARED_LOTS, RETIRED_LOT_NAMES, VACANT_LOTS, layoutMap, type Layout } from "../views/mapLayout";
import { AIRPORT_KEY, AIRPORT_PARKED_STANDS } from "../views/map3d/airport";
import { LOOP } from "../views/map3d/airportArrivals";
import { AIRPORT_BUILDINGS, airportBuildingKey } from "../views/map3d/airportBuildings";
import { planAirportCrew, planCrewTrains } from "../views/map3d/airportCrew";
import { COMMONS_KEY, COMMONS_NAME } from "../views/map3d/commonsPlan";
import { DEALERSHIP_KEY } from "../views/map3d/dealershipPlan";
import { planDistrictLife } from "../views/map3d/districtLifePlan";
import { planDistrictWalkers } from "../views/map3d/districtWalkers";
import { FINANCIAL_KEY, FINANCIAL_PARK_KEY, financialKey } from "../views/map3d/financialPlan";
import { GALLERIA_KEY, GALLERIA_NAME } from "../views/map3d/galleriaPlan";
import { planGalleriaLife } from "../views/map3d/galleriaLifePlan";
import { HILLS_KEY } from "../views/map3d/hillsPlan";
import { planAirportCommuters, planRailCommuters } from "../views/map3d/railCommuters";
import { travelPlan } from "../views/map3d/travelLoops";
import { MALL_KEY } from "../views/map3d/mallPlan";
import { AGENCY_KEY, AGENCY_NAME } from "../views/map3d/marketingAgencyPlan";
import { MAP_FLEET } from "../views/map3d/mapFleet";
import { buildScene, type Scene3D } from "../views/map3d/scene";
import { STADIUM_KEY, STADIUM_NAME } from "../views/map3d/stadiumPlan";
import { YACHT_KEY, YACHT_NAME } from "../views/map3d/yachtPlan";
import { planStreetLights } from "../views/map3d/streetLighting";
import { MAX_VEHICLES, planDealershipTraffic, planHighwayTraffic, planVehicles, type VehicleKind } from "../views/map3d/vehicles";

// Everything on the Atlas map, as plain rows for the Atlas Data Inventory agent (an n8n workflow
// that writes them to the Agent Registry sheet). Read from the same catalog and scene the map draws,
// so a row exists only when the map really has the building, agent or object. Nothing is guessed:
// an agent with no building says so, and a building with no agents lists none.

export const INVENTORY_SCHEMA = "atlas/inventory-v1";

export type BuildingKind =
  | "Project building"
  | "Landmark"
  | "Financial District building"
  | "Airport building"
  | "Train station"
  | "Public space"
  | "Tool office"
  | "Retired building";

export interface InventoryBuilding {
  /** Stable map id (selection key); never renamed. */
  id: string;
  name: string;
  kind: BuildingKind;
  area: string;
  organization: string;
  module: string;
  /** Active, idle, paused, attention (catalog buildings), Planned (drawn places), Retired or Vacant lot. */
  status: string;
  /** Catalog project whose repository the building runs on, when there is one. */
  project: string;
  agent_ids: string[];
  ai_agents: number;
  automations: number;
  source: string;
}

export interface InventoryAgent {
  id: string;
  name: string;
  kind: "AI agent" | "Automation";
  status: string;
  building_id: string;
  building_name: string;
  /** How the agent is placed: desk in its project building, a named room, or the landmark it operates. */
  placement: string;
  owned_by: string;
  project: string;
  runtime: string;
  trigger: string;
  source: string;
}

export interface InventoryObject {
  category: string;
  kind: string;
  count: number;
  area: string;
  moves: boolean;
  source: string;
}

export interface MapInventory {
  schema: typeof INVENTORY_SCHEMA;
  buildings: InventoryBuilding[];
  agents: InventoryAgent[];
  objects: InventoryObject[];
  /** Things the inventory knows it does not count yet, so the sheet can say so. */
  notes: string[];
}

const PLANNED = "Planned";
/** Manifests still say "KC" in places; the owner is Khaneil everywhere the inventory is read. */
const plain = (t: string) => t.replace(/\bKC\b/g, "Khaneil");
const moduleName = (id?: ModuleTypeId | null) => (id ? MODULE_TYPES[id]?.name ?? id : "");
/** Workspace landmark ids leave out the "service:" prefix of the map key. */
const landmarkKey = (id: string) => `service:${id}`;
const landmarkFor = (key: string) => LANDMARK_MODULES.find((l) => landmarkKey(l.id) === key);

/** Named workplaces in catalog manifests (agent `workplace.building`) and the building they mean. */
const WORKPLACE_KEYS: Record<string, string> = { "Atlas Marketplace": MALL_KEY, "Benjaire Marketing Agency": AGENCY_KEY };

/** Removed districts with no lot and no manifest left. */
const REMOVED_NAMES: Record<string, string> = { skyline: "Skyline" };

const VEHICLE_NAMES: Record<VehicleKind, string> = {
  sedan: "Sedan",
  van: "Van",
  service: "Service van",
  sports: "Sports car",
  delivery: "Delivery van",
  parcel: "Parcel van",
  bus: "City bus",
  taxi: "Taxi",
  pickup: "Pickup truck",
  semi: "Semi truck",
  gwagon: "SUV",
  bmw: "Atlas sedan",
  convertible: "Convertible",
};

function countBy<T>(items: readonly T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return m;
}

function areaOf(layout: Layout): Map<string, string> {
  const labels = new Map(layout.neighborhoods.map((n) => [n.key, n.label]));
  return new Map(layout.districts.map((d) => [d.project.id, labels.get(d.group) ?? d.group]));
}

function buildingsOf(catalog: Catalog, layout: Layout, scene: Scene3D): InventoryBuilding[] {
  const area = areaOf(layout);
  const out: InventoryBuilding[] = [];
  const add = (b: Omit<InventoryBuilding, "agent_ids" | "ai_agents" | "automations" | "organization" | "module"> & { organization?: string; module?: string }) => {
    const lm = landmarkFor(b.id);
    out.push({
      ...b,
      name: plain(buildingDisplayName(b.id, b.name)),
      organization: b.organization ?? buildingOrganization(b.id) ?? "",
      module: b.module ?? moduleName(lm?.moduleType),
      project: b.project || lm?.project || "",
      agent_ids: [],
      ai_agents: 0,
      automations: 0,
    });
  };

  for (const t of scene.towers) {
    const p = catalog.projects.find((x) => x.id === t.projectId);
    add({ id: t.key, name: t.name, kind: "Project building", area: area.get(t.projectId) ?? "", organization: p?.organization ?? "", module: moduleName(p?.module), status: t.status, project: t.projectId, source: p?.file ? `catalog/${p.file}` : "catalog" });
  }
  for (const k of scene.kiosks) add({ id: k.key, name: k.name, kind: "Tool office", area: area.get(k.projectId) ?? "", status: PLANNED, project: k.projectId, source: "catalog tools (src/catalog/roles.ts servicesOf)" });
  if (scene.financial) {
    add({ id: FINANCIAL_KEY, name: "Financial District", kind: "Public space", area: "Financial District", status: PLANNED, project: "", source: "src/views/map3d/financialPlan.ts" });
    for (const b of scene.financial.buildings) add({ id: financialKey(b.id), name: b.name, kind: "Financial District building", area: "Financial District", status: PLANNED, project: "", source: "src/views/map3d/financialPlan.ts" });
    add({ id: FINANCIAL_PARK_KEY, name: "Financial Park", kind: "Public space", area: "Financial District", status: PLANNED, project: "", source: "src/views/map3d/financialPlan.ts" });
  }
  const stops = scene.communityRail?.loop?.stops ?? [];
  for (const s of stops) add({ id: s.id, name: s.name, kind: "Train station", area: "Perimeter rail loop", status: PLANNED, project: "", source: "src/views/map3d/perimeterRailPlan.ts" });
  if (scene.dealership) add({ id: DEALERSHIP_KEY, name: "Vantor Motors", kind: "Landmark", area: "Financial District", status: PLANNED, project: "", source: "src/views/map3d/dealershipPlan.ts" });
  if (scene.agency) add({ id: AGENCY_KEY, name: AGENCY_NAME, kind: "Landmark", area: "Bay", status: PLANNED, project: "", source: "src/views/map3d/marketingAgencyPlan.ts" });
  if (scene.mall) add({ id: MALL_KEY, name: "Atlas Marketplace", kind: "Landmark", area: "Marketplace", status: PLANNED, project: "", source: "src/views/map3d/mallPlan.ts" });
  if (scene.commons) add({ id: COMMONS_KEY, name: COMMONS_NAME, kind: "Public space", area: "Marketplace", status: PLANNED, project: "", source: "src/views/map3d/commonsPlan.ts" });
  if (scene.galleria) add({ id: GALLERIA_KEY, name: GALLERIA_NAME, kind: "Landmark", area: "Marketplace", status: PLANNED, project: "", source: "src/views/map3d/galleriaPlan.ts" });
  if (scene.stadium) add({ id: STADIUM_KEY, name: STADIUM_NAME, kind: "Landmark", area: "Stadium", status: PLANNED, project: "", source: "src/views/map3d/stadiumPlan.ts" });
  // The Atlas yacht is berthed at the marina whenever the map has its harbour (Map3D anchorsOf).
  add({ id: YACHT_KEY, name: YACHT_NAME, kind: "Landmark", area: "Marina", status: PLANNED, project: "", source: "src/views/map3d/yachtPlan.ts" });
  if (scene.hills) add({ id: HILLS_KEY, name: "Atlas Hills", kind: "Landmark", area: "Atlas Hills", status: PLANNED, project: "", source: "src/views/map3d/hillsPlan.ts" });
  if (scene.airport) {
    add({ id: AIRPORT_KEY, name: "Atlas Airport", kind: "Landmark", area: "Airport", status: PLANNED, project: "", source: "src/views/map3d/airport.ts" });
    for (const b of AIRPORT_BUILDINGS) add({ id: airportBuildingKey(b.id), name: b.name, kind: "Airport building", area: "Airport", status: PLANNED, project: "", source: "src/views/map3d/airportBuildings.ts" });
  }
  // Removed buildings: their lots stay so nothing else moves (src/views/mapLayout.ts).
  for (const id of OFF_MAP_PROJECTS) {
    const p = catalog.projects.find((x) => x.id === id);
    const lot = VACANT_LOTS.has(id) || CLEARED_LOTS.has(id);
    add({ id: `project:${id}`, name: p?.name ?? RETIRED_LOT_NAMES[id] ?? REMOVED_NAMES[id] ?? id, kind: "Retired building", area: lot ? area.get(id) || "Vacant lot" : "Off the map", status: lot ? "Vacant lot" : "Retired", project: id, source: "src/catalog/projects.ts OFF_MAP_PROJECTS" });
  }
  return out;
}

function agentsOf(catalog: Catalog, buildings: InventoryBuilding[]): InventoryAgent[] {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const operators = new Map<string, string>();
  for (const l of LANDMARK_MODULES) for (const a of l.agents ?? []) operators.set(a, landmarkKey(l.id));
  const place = (a: Agent): { id: string; placement: string } => {
    if (a.workplace) {
      const key = WORKPLACE_KEYS[a.workplace.building];
      return { id: key ?? "", placement: `Room ${a.workplace.room}, floor ${a.workplace.floor}${key ? "" : ` in ${a.workplace.building}`}` };
    }
    const op = operators.get(a.id);
    if (op) return { id: op, placement: "Operates this building" };
    return { id: `project:${a.projectId}`, placement: isAiAgent(a) ? "Desk in its project building" : "Runs from its project building" };
  };
  return catalog.agents.map((a) => {
    const at = place(a);
    const b = byId.get(at.id);
    return {
      id: a.id,
      name: plain(a.name),
      kind: isAiAgent(a) ? "AI agent" : "Automation",
      status: a.status,
      building_id: b ? b.id : "",
      building_name: b ? b.name : "No building",
      placement: b ? at.placement : "Not placed on the map",
      owned_by: a.ownedBy ?? "",
      project: a.projectId,
      runtime: a.runtime ?? a.framework ?? "",
      trigger: plain(a.trigger ?? ""),
      source: a.source ?? "",
    };
  });
}

function objectsOf(scene: Scene3D): { objects: InventoryObject[]; notes: string[] } {
  const objects: InventoryObject[] = [];
  const notes: string[] = [];
  const add = (o: InventoryObject) => {
    if (o.count > 0) objects.push(o);
  };
  const vehicles = (plans: { kind: VehicleKind }[], area: string, source: string) => {
    for (const [kind, count] of countBy(plans, (p) => p.kind)) add({ category: "Road vehicles", kind: VEHICLE_NAMES[kind as VehicleKind] ?? kind, count, area, moves: true, source });
  };
  // Three of the city cars run the travel loops' shuttle rounds instead of a street loop (living.tsx Vehicles).
  const shuttles = travelPlan(scene)?.shuttles.map((s) => s.plan) ?? [];
  vehicles(planVehicles(scene).slice(0, MAX_VEHICLES - shuttles.length), "City streets", "src/views/map3d/vehicles.ts planVehicles");
  vehicles(shuttles, "Travel loop shuttles", "src/views/map3d/travelLoops.ts planShuttle");
  vehicles(planHighwayTraffic(scene), "Highway", "src/views/map3d/vehicles.ts planHighwayTraffic");
  vehicles(planDealershipTraffic(scene), "Infrastructure Operations Hub", "src/views/map3d/vehicles.ts planDealershipTraffic");
  if (scene.freight) add({ category: "Road vehicles", kind: "Freight truck", count: 1, area: "Freight route to the airport", moves: true, source: "src/views/map3d/freight.ts planFreight" });
  const galleria = planGalleriaLife(scene);
  if (galleria) {
    add({ category: "Road vehicles", kind: "Car with a driver", count: galleria.drivers.length, area: "Atlas Galleria", moves: true, source: "src/views/map3d/galleriaLifePlan.ts" });
    add({ category: "Road vehicles", kind: "Parked car", count: galleria.court?.cars.length ?? 0, area: "Atlas Galleria court", moves: false, source: "src/views/map3d/galleriaLifePlan.ts" });
    add({ category: "People", kind: "Shopper", count: galleria.walkers.length, area: "Atlas Galleria", moves: true, source: "src/views/map3d/galleriaLifePlan.ts" });
    notes.push("Cars parked in the Atlas Galleria car park are drawn as scenery and are not counted yet.");
  }

  if (scene.airport) {
    add({ category: "Aircraft", kind: "Airliner on the flight loop", count: LOOP.count, area: "Airport", moves: true, source: "src/views/map3d/airportArrivals.ts LOOP" });
    add({ category: "Aircraft", kind: "Parked airliner", count: AIRPORT_PARKED_STANDS.length, area: "Airport", moves: false, source: "src/views/map3d/LogisticsAirport.tsx" });
    add({ category: "Aircraft", kind: "Executive jet on the flight loop", count: MAP_FLEET.executiveJets, area: "Airport", moves: true, source: "src/views/map3d/LogisticsAirport.tsx ExecutiveJet" });
    const crew = planAirportCrew();
    for (const [role, count] of countBy(crew, (c) => c.role)) add({ category: "People", kind: `Ground crew (${role})`, count, area: "Airport", moves: true, source: "src/views/map3d/airportCrew.ts" });
    add({ category: "Airport vehicles", kind: "Baggage train", count: planCrewTrains().length, area: "Airport", moves: true, source: "src/views/map3d/airportCrew.ts planCrewTrains" });
  }
  add({ category: "Aircraft", kind: "Atlas airship", count: MAP_FLEET.airships, area: "Sky", moves: true, source: "src/views/map3d/SkyBalloons.tsx" });
  const travel = travelPlan(scene);
  add({ category: "Boats", kind: travel?.yacht ? "Atlas yacht (cruises out to sea and back in under 3 minutes)" : "Atlas yacht (berthed)", count: 1, area: "Marina", moves: !!travel?.yacht, source: travel?.yacht ? "src/views/map3d/travelLoops.ts" : "src/views/map3d/yachtPlan.ts" });
  add({ category: "Boats", kind: "Boat", count: MAP_FLEET.boats, area: "Bay", moves: true, source: "src/views/map3d/living.tsx" });

  const rail = scene.communityRail;
  if (rail) add({ category: "Trains", kind: "Passenger train (3 cars)", count: 1, area: rail.loop ? "Perimeter rail loop" : "Atlas Hills line", moves: true, source: "src/views/map3d/HillsCommunity.tsx" });
  if (rail?.loop) add({ category: "People", kind: "Traveller (train, shuttle car and yacht loops)", count: travel?.travellers.length ?? 0, area: "Perimeter rail loop", moves: true, source: "src/views/map3d/travelLoops.ts" });
  else {
    const commuters = planRailCommuters(scene.community, scene.financial, rail);
    add({ category: "People", kind: "Rail commuter", count: commuters?.commuters.length ?? 0, area: "Atlas Hills line", moves: true, source: "src/views/map3d/railCommuters.ts" });
    add({ category: "People", kind: "Airport rail commuter", count: planAirportCommuters(commuters, rail)?.commuters.length ?? 0, area: "Airport line", moves: true, source: "src/views/map3d/railCommuters.ts" });
  }
  add({ category: "People", kind: "Office walker", count: planDistrictWalkers(scene.financial).length, area: "Financial District", moves: true, source: "src/views/map3d/districtWalkers.ts" });
  add({ category: "People", kind: "District visitor", count: planDistrictLife(scene).visitors.length, area: "Financial District", moves: true, source: "src/views/map3d/districtLifePlan.ts" });

  add({ category: "Homes", kind: "Hills community building", count: scene.community?.buildings.length ?? 0, area: "Atlas Hills", moves: false, source: "src/views/map3d/hillsCommunityPlan.ts" });
  add({ category: "Street furniture", kind: "Street lamp", count: planStreetLights(scene).length, area: "City streets", moves: false, source: "src/views/map3d/streetLighting.ts" });
  add({ category: "Water features", kind: "Fountain", count: scene.fountains.length, area: "City", moves: false, source: "src/views/map3d/scene.ts" });
  add({ category: "Bridges", kind: "Road bridge", count: scene.carBridges.length, area: "City", moves: false, source: "src/views/map3d/roads.ts" });
  add({ category: "Parks", kind: "Park", count: scene.parks.length, area: "City", moves: false, source: "src/views/map3d/scene.ts" });
  notes.push("Trees, benches and paving are scenery and are left out on purpose.");
  notes.push("Agents walking to work only appear in the app when live job data is loaded, so they are not counted here.");
  return { objects, notes };
}

/** The whole map inventory, from a catalog: the same layout and scene the map draws by default. */
export function mapInventory(catalog: Catalog): MapInventory {
  const layout = layoutMap(catalog, [], "district");
  const scene = buildScene(layout);
  const buildings = buildingsOf(catalog, layout, scene);
  const agents = agentsOf(catalog, buildings);
  const byId = new Map(buildings.map((b) => [b.id, b]));
  for (const a of agents) {
    const b = byId.get(a.building_id);
    if (!b) continue;
    b.agent_ids.push(a.id);
    if (a.kind === "AI agent") b.ai_agents++;
    else b.automations++;
  }
  const { objects, notes } = objectsOf(scene);
  return { schema: INVENTORY_SCHEMA, buildings, agents, objects, notes };
}
