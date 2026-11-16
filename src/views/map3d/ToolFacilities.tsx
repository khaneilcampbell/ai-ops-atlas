import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { FacilityStatus } from "../../catalog/toolFacilities";
import { Instanced, Kiosks, type Inst } from "./models";
import { TERRACE_H, type Kiosk, type Rect, type Scene3D } from "./scene";
import { isCommerceAnnex } from "./commerceAnnexPlan";
import { TOOL_OFFICE_HEIGHT } from "./toolBrand";
import type { FacilityPlacement } from "./toolFacilityPlan";

type G = Parameters<typeof Kiosks>[0]["g"];

/**
 * Roof light colour per facility status. Green only for a verified connection; a key that is set
 * but unchecked, or a tool Atlas can't check, stays neutral so the light is never mistaken for proof.
 */
export const FACILITY_LIGHT: Record<FacilityStatus, string> = {
  connected: "#5cc46e",
  configured: "#c8d0ca",
  degraded: "#e6a63c",
  disconnected: "#d9544f",
  unavailable: "#7d857a",
  unknown: "#a9b4a0",
};

/** A placed satellite drawn as a tool office: the same building parts, signs and materials. */
export function facilityKiosk(p: FacilityPlacement): Kiosk {
  return { key: p.facility.key, projectId: p.facility.projectId, name: p.facility.name, users: [], x: p.x, z: p.z, size: p.size, canopy: "#2f4a3a", height: p.height };
}

/** Footprints of the placed facilities, padded, for clearing trees and bushes from under them. */
export function facilityGround(placed: FacilityPlacement[], pad = 0.15): Rect[] {
  return placed.map((p) => ({ x: p.x - p.size / 2 - pad, z: p.z - p.size / 2 - pad, w: p.size + pad * 2, d: p.size + pad * 2 }));
}

/** The scene's planting with anything standing where a facility now stands taken out. */
export function clearPlanting(scene: Scene3D, ground: Rect[]): Scene3D {
  if (!ground.length) return scene;
  const free = (p: { x: number; z: number }) => !ground.some((r) => p.x >= r.x && p.x <= r.x + r.w && p.z >= r.z && p.z <= r.z + r.d);
  return { ...scene, trees: scene.trees.filter(free), bushes: scene.bushes.filter(free), rocks: scene.rocks.filter(free), bollards: scene.bollards.filter(free) };
}

/**
 * A slim status light on the roof of every tool facility, tool offices included. The buildings
 * themselves are drawn with the tool offices (Map3D passes both to one Kiosks, so they share its
 * instanced meshes). Static: the light only changes colour when a status does; nothing animates.
 */
export function FacilityLights({ placed, offices, status, g }: { placed: FacilityPlacement[]; offices: Kiosk[]; status: Readonly<Record<string, FacilityStatus>>; g: G }) {
  const lights = useMemo<Inst[]>(
    () =>
      // Commerce's teardrop annexes have their own roofs (CommerceAnnexes), so their light is left out.
      [...placed.map(facilityKiosk), ...offices.filter((k) => !isCommerceAnnex(k))].map((k) => {
        const top = TERRACE_H + 0.03 + (k.height ?? TOOL_OFFICE_HEIGHT) + 0.1;
        return { p: [k.x, top, k.z + k.size * 0.4], s: [k.size * 0.46, 0.05, 0.05], c: FACILITY_LIGHT[status[k.key] ?? "unknown"] };
      }),
    [placed, offices, status],
  );
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), []);
  useEffect(() => () => glow.dispose(), [glow]);
  return <Instanced items={lights} geometry={g.box} material={glow} shadow={false} />;
}
