import { useEffect, useState } from "react";
import { isTauri } from "../lib/env";
import type { FixRequest } from "../lib/fixWithClaude";
import { loadTracking, type TrackingResult } from "./tracking";

/**
 * Finds the issues and pull requests that came from these recommendations. Reads once per change
 * of the recommendation set; GET only. Desktop only, like the screens that use it.
 */
export function useRecTracking(requests: FixRequest[]): TrackingResult | null {
  const sig = requests.map((r) => `${r.marker}:${r.repo}`).join(",");
  const [result, setResult] = useState<TrackingResult | null>(null);
  useEffect(() => {
    if (!isTauri() || !requests.length) return;
    let live = true;
    void loadTracking(requests).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
    // The signature covers everything the lookup depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return result;
}
