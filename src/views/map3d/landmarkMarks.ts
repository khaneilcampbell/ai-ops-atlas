import { useMemo } from "react";
import { useAtlas } from "../../state";
import type { Health } from "../../lib/derive";
import type { LiveLandmark } from "../../lib/connections";
import { useStudioHealth } from "../../components/ModuleWorkspaceLists";
import { landmarkInstances } from "../../modules/instances";
import { serviceKey } from "../../modules/names";
import { aggregateHealth, buildingAssets } from "../../modules/operations";
import type { ModuleTypeId } from "../../modules/types";
import type { PlaqueMark } from "./plaques";

const KIND: Record<Exclude<Health, "unknown">, string> = { good: "passing", warn: "running", bad: "failing" };

/**
 * The status dot for landmark buildings whose module reports real telemetry, keyed by the
 * building's selection key. The same health the building's module card shows: a module that reads
 * its own live sources (MODULE_HEALTH) uses those, otherwise the CI of the building's linked
 * repositories. A landmark with nothing connected, nothing checked yet or a planned module gets no
 * entry and keeps the dashed "planned" dot; green only ever comes from data that came back.
 */
export function landmarkMark(health: Health, summary: string): PlaqueMark | undefined {
  return health === "unknown" ? undefined : { kind: KIND[health], label: summary };
}

/**
 * Landmarks whose module is live: the health a module that reads its own live sources reports
 * (MODULE_HEALTH), otherwise the CI of the building's linked repositories. Unknown is not live.
 * The status dots and the Atlas Command Center connections both come from this one list.
 */
export function liveLandmarks<T extends { id: string; name: string; enabled: boolean; moduleType: ModuleTypeId | null }>(
  instances: readonly T[],
  healthOf: (l: T, type: ModuleTypeId) => { health: Health; summary: string },
): LiveLandmark[] {
  const out: LiveLandmark[] = [];
  for (const l of instances) {
    if (!l.enabled || !l.moduleType) continue;
    const h = healthOf(l, l.moduleType);
    if (h.health !== "unknown") out.push({ id: l.id, name: l.name, health: h.health, summary: h.summary });
  }
  return out;
}

export function useLiveLandmarks(): LiveLandmark[] {
  const { catalog, repos } = useAtlas();
  // One line per module that reads its own live sources (MODULE_HEALTH in ModuleWorkspaceLists).
  const studio = useStudioHealth();
  return useMemo(() => {
    const own: Partial<Record<ModuleTypeId, { health: Health; summary: string }>> = { "growth-marketing-studio": studio };
    return liveLandmarks(landmarkInstances(), (l, type) => own[type] ?? aggregateHealth(buildingAssets(l, catalog).repositories, repos));
  }, [catalog, repos, studio]);
}

/** Status dots by selection key, for the landmarks in `live`. */
export function landmarkMarksOf(live: readonly LiveLandmark[]): Readonly<Record<string, PlaqueMark>> {
  const marks: Record<string, PlaqueMark> = {};
  for (const l of live) marks[serviceKey(l.id)] = landmarkMark(l.health, l.summary)!;
  return marks;
}
