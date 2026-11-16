import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Instanced, useGeometries, useMaterials, type PickHandlerSet } from "./models";
import { TERRACE_H } from "./scene";
import { gatewayParts, type GatewayPlan } from "./transitGateway";

/** Lettering for one sign: dark glass-steel board with warm white capitals, shared by every sign with the same text. */
const SIGNS = new Map<string, THREE.MeshBasicMaterial>();
function signMaterial(text: string) {
  let material = SIGNS.get(text);
  if (material) return material;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 80;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#26302f";
  ctx.fillRect(0, 0, 512, 80);
  ctx.fillStyle = "#c9a35a";
  ctx.fillRect(0, 74, 512, 6);
  ctx.fillStyle = "#fff4dc";
  ctx.font = "bold 44px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 40, 490);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  material = new THREE.MeshBasicMaterial({ map: texture });
  SIGNS.set(text, material);
  return material;
}

type Shared = { g: ReturnType<typeof useGeometries>; m: ReturnType<typeof useMaterials> };
/** The gateway is part of Events Arena Station: clicking it opens the station's details. */
export const GATEWAY_PICK_KEY = "service:stadium-station";

/**
 * Transit Gateway between Events Arena Station's plaza and the harbour boardwalk (transitGateway.ts): entrance lobby,
 * stair, glass lift, enclosed footbridge over the track and the covered exit stair. Static instanced boxes on the
 * shared geometry; one glass material and the text signs are the only new materials. Clicking it opens the station.
 */
export function TransitGateway({ plan, g, m, pick, night }: { plan: GatewayPlan; pick: PickHandlerSet; night: boolean } & Shared) {
  const parts = useMemo(() => gatewayParts(plan, TERRACE_H), [plan]);
  const glass = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.4, depthWrite: false, roughness: 0.15, metalness: 0.3, emissive: night ? "#ffe2a6" : "#000000", emissiveIntensity: night ? 0.3 : 0 }),
    [night],
  );
  useEffect(() => () => glass.dispose(), [glass]);
  const picks = useMemo(() => ({ solid: pick.of(parts.solid.map(() => GATEWAY_PICK_KEY)), glass: pick.of(parts.glass.map(() => GATEWAY_PICK_KEY)) }), [pick, parts]);
  return (
    <group name="transit-gateway">
      <Instanced items={parts.solid} geometry={g.box} material={m.plain} pick={picks.solid} />
      <Instanced items={parts.glass} geometry={g.box} material={glass} pick={picks.glass} shadow={false} />
      <Instanced items={parts.lights} geometry={g.box} material={night ? m.lamp : m.plain} shadow={false} />
      <Instanced items={parts.plants} geometry={g.ball} material={m.plain} />
      {parts.signs.map((s) => (
        <mesh key={s.text} geometry={g.plane} material={signMaterial(s.text)} position={s.p} rotation={[0, s.r, 0]} scale={[s.w, s.h, 1]} raycast={() => null} />
      ))}
    </group>
  );
}
