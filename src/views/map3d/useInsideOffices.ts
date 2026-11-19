import { useMemo } from "react";
import { buildingsOf, type BuildingDefinition } from "../../buildings/buildingDefinition";
import { deskScreen } from "../../buildings/deskScreen";
import { catalog as fullCatalog } from "../../catalog";
import { useRoutineOps } from "../../routine/useRoutineOps";
import { accentFor } from "../office/model";
import type { InsideOffice } from "./InsideView";
import type { Tower } from "./scene";

/**
 * Every headquarters' office for the Inside view, from the shared building definitions
 * (buildings/buildingDefinition.ts): the desks on their own floors, and each desk's screen from the
 * same operational state the agent's card shows (routine/useRoutineOps.ts: n8n, GitHub runs and the
 * Task Center). Nothing is computed while Inside is off.
 */
export function useInsideOffices(on: boolean, towers: readonly Tower[]): Map<string, InsideOffice> {
  const defs = useMemo(() => buildingsOf(towers, fullCatalog.projects, fullCatalog.agents), [towers]);
  const ids = useMemo(() => (on ? [...defs.values()].flatMap((d) => d.desks.map((x) => x.agentId)).sort() : []), [on, defs]);
  const { ops } = useRoutineOps(ids);
  return useMemo(() => {
    const out = new Map<string, InsideOffice>();
    if (!on) return out;
    for (const def of defs.values()) out.set(def.projectId, officeOf(def, (id) => deskScreen(ops.get(id))));
    return out;
  }, [on, defs, ops]);
}

export function officeOf(def: BuildingDefinition, screen: (agentId: string) => ReturnType<typeof deskScreen>): InsideOffice {
  return { def, desks: def.desks.map((desk, i) => ({ desk, state: screen(desk.agentId), accent: accentFor(i, def.projectId) })) };
}
