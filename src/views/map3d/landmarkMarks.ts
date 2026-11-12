import { useMemo } from "react";
import { useAtlas } from "../../state";
import type { Health } from "../../lib/derive";
import { useStudioHealth } from "../../components/ModuleWorkspaceLists";
import { useSharedWatches } from "../../alerts/state";
import { feedHealth } from "../../modules/feedHealth";
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

export function useLandmarkMarks(): Readonly<Record<string, PlaqueMark>> {
  const { catalog, repos } = useAtlas();
  // One line per module that reads its own live sources (MODULE_HEALTH in ModuleWorkspaceLists).
  const studio = useStudioHealth();
  const watches = useSharedWatches();
  return useMemo(() => {
    const own: Partial<Record<ModuleTypeId, { health: Health; summary: string }>> = { "growth-marketing-studio": studio };
    const marks: Record<string, PlaqueMark> = {};
    for (const l of landmarkInstances()) {
      if (!l.enabled || !l.moduleType) continue;
      const assets = buildingAssets(l, catalog);
      // The operating agents' live reports come first: CI alone never turns a building green here.
      const h = feedHealth([...assets.agents, ...assets.automations].map((a) => a.id), watches) ?? own[l.moduleType] ?? aggregateHealth(assets.repositories, repos);
      const mark = landmarkMark(h.health, h.summary);
      if (mark) marks[serviceKey(l.id)] = mark;
    }
    return marks;
  }, [catalog, repos, studio, watches]);
}
