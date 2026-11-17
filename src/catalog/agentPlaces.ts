import { AGENT_RESIDENCE, agentJobs, type AgentJob } from "./agentJobs";
import { buildingDisplayName } from "../modules/names";
import { WORKSPACE } from "../modules/workspace";
import type { Catalog } from "./types";

/**
 * Where every catalog agent lives and works, for the hover card that names an agent wherever it
 * is drawn (at its desk, walking, or away from its building). This is identity and placement only:
 * a home or a workplace never means a run started, finished or succeeded.
 *
 * AI agents keep the home and workplace their job card already gives them (agentJobs.ts, which a
 * saved presence schedule can override: pass those jobs in). Automations have no job card, so
 * Atlas assigns them a default home by the same residence rule, in the East tower so no agent's
 * apartment ever moves, and labels it as an assigned default.
 */

/** Where a value came from: written in the catalog or workspace, or assigned by an Atlas rule. */
export type PlaceSource = "declared" | "assigned";
export interface Place {
  label: string;
  source: PlaceSource;
}
export interface AgentPlaces {
  home: Place;
  work: Place;
}

/** Automations' apartments: Ellipse Residences East, four units a floor from the top floor down. */
export function automationHomes(ids: string[]): Map<string, string> {
  const R = AGENT_RESIDENCE;
  const top = R.firstFloor + R.floors - 1;
  const residence = buildingDisplayName("service:financial:circa", R.name);
  const out = new Map<string, string>();
  [...ids].sort().forEach((id, i) => {
    const k = i % (R.floors * R.unitsPerFloor);
    const unit = `${top - Math.floor(k / R.unitsPerFloor)}${"ABCD"[k % R.unitsPerFloor]}`;
    out.set(id, `${residence} East, apartment ${unit}`);
  });
  return out;
}

/** Each landmark-operating agent's building, from workspace.yaml (`agents` on a landmark). */
function landmarkWork(): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of WORKSPACE.landmarks) for (const id of l.agents ?? []) out.set(id, buildingDisplayName(`service:${l.id}`, l.name));
  return out;
}

export function agentPlaces(catalog: Catalog, jobs: AgentJob[] = agentJobs(catalog)): Map<string, AgentPlaces> {
  const byJob = new Map(jobs.map((j) => [j.agentId, j]));
  const autos = automationHomes(catalog.agents.filter((a) => !byJob.has(a.id)).map((a) => a.id));
  const landmarks = landmarkWork();
  const out = new Map<string, AgentPlaces>();
  for (const a of catalog.agents) {
    const job = byJob.get(a.id);
    const project = catalog.projects.find((p) => p.id === a.projectId);
    // A saved presence schedule (draft #456) is Khaneil's own choice, so it counts as declared.
    const saved = !!(job && (job as AgentJob & { presence?: unknown }).presence);
    const home: Place = job ? { label: job.home.label, source: saved ? "declared" : "assigned" } : { label: autos.get(a.id)!, source: "assigned" };
    const landmark = landmarks.get(a.id);
    const work: Place = a.workplace
      ? { label: `${a.workplace.building}, floor ${a.workplace.floor}, ${/^\d+$/.test(a.workplace.room) ? "suite" : "room"} ${a.workplace.room}`, source: "declared" }
      : saved && job
        ? { label: job.work.label, source: "declared" }
        : landmark
          ? { label: landmark, source: "declared" }
          : { label: `${project?.name ?? a.projectId}${a.officeFloor ? `, floor ${a.officeFloor}` : ""}`, source: "declared" };
    out.set(a.id, { home, work });
  }
  return out;
}

/** "Home · Ellipse Residences West, apartment 12A (assigned by Atlas)" style suffix. */
export const placeNote = (p: Place) => (p.source === "assigned" ? "assigned by Atlas" : null);
