import type { AgentPlaces, Place } from "../../catalog/agentPlaces";
import type { OfficeRow } from "../office/officeRows";
import { RUNTIME_LABEL } from "../office/model";
import { STATE_COLOR } from "../office/textures";

/**
 * The card over an agent walking on the map: who it is, its live state from the same verified
 * sources as its desk, and where it lives and works. Being outside never means a run is happening:
 * the state line comes only from telemetry (runtimeFor), the place lines only from placement.
 */
export interface AgentTagInfo {
  agentId: string;
  name: string;
  role: string | null;
  stateLabel: string;
  stateColor: string;
  home: Place;
  work: Place;
}

export function buildAgentTag(agentId: string, row: OfficeRow | undefined, places: AgentPlaces | undefined, role: string | null): AgentTagInfo | null {
  if (!row || !places) return null;
  return {
    agentId,
    name: row.entry.profile.title,
    role,
    stateLabel: RUNTIME_LABEL[row.runtime.state],
    stateColor: STATE_COLOR[row.runtime.state],
    home: places.home,
    work: places.work,
  };
}
