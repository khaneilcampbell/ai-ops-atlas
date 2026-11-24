import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Swap } from "../office/models";
import { TERRACE_H } from "./scene";
import { BOH_KEY, BOH_MODEL, SUPPLIER_HUB_KEY, type BusinessHqPlan } from "./businessHqPlan";
import type { PickHandlerSet } from "./models";

/**
 * Business Operations HQ with its Vendor & Supplier Hub annex: one Blender-built GLB
 * (public/models/map/business-operations-hq.glb, about 14 meshes, one per material per building).
 * Meshes named `hq_*` select the HQ, `annex_*` (the annex and its covered walkway) the Supplier Hub.
 * No Draco or Meshopt, so the strict CSP stays as it is. Plain massing stands in while it loads or if
 * it fails.
 */
export const BOH_MODEL_URL = `${import.meta.env.BASE_URL}models/map/business-operations-hq.glb`;

const keyOf = (o: THREE.Object3D) => (o.name.startsWith("annex_") ? SUPPLIER_HUB_KEY : BOH_KEY);

function Model({ night, onPick }: { night: boolean; onPick: Handlers }) {
  const { scene } = useGLTF(BOH_MODEL_URL, false, false);
  const invalidate = useThree((t) => t.invalidate);
  const obj = useMemo(() => {
    const o = scene.clone(true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      m.userData.pickKey = keyOf(m);
      // Each clone owns its materials so the night glow below doesn't leak into the cached model.
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.userData.baseEmissive = mat.emissiveIntensity;
      m.material = mat;
    });
    return o;
  }, [scene]);
  // Offices, atrium and lobby glow warm after dark.
  useEffect(() => {
    obj.traverse((c) => {
      const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat?.emissive && mat.emissive.getHex() !== 0) mat.emissiveIntensity = (mat.userData.baseEmissive ?? 1) * (night ? 2.2 : 0.7);
    });
    invalidate();
  }, [obj, night, invalidate]);
  return <primitive object={obj} {...onPick} />;
}

/** Plain stand-in massing (HQ podium + tower, annex), same footprint as the model. */
function Massing({ onPick }: { onPick: Handlers }) {
  const { podium, tower, annex } = BOH_MODEL;
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2f6b57", roughness: 0.4 }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <group {...onPick}>
      <mesh material={mat} position={[0, podium.h / 2, 0]} userData={{ pickKey: BOH_KEY }}><boxGeometry args={[podium.w, podium.h, podium.d]} /></mesh>
      <mesh material={mat} position={[0, tower.top / 2, -tower.back]} userData={{ pickKey: BOH_KEY }}><boxGeometry args={[tower.w, tower.top, tower.d]} /></mesh>
      <mesh material={mat} position={[annex.dx, annex.h / 2, annex.dz]} userData={{ pickKey: SUPPLIER_HUB_KEY }}><boxGeometry args={[annex.w, annex.h, annex.d]} /></mesh>
    </group>
  );
}

type Handlers = { onPointerOver: (e: ThreeEvent<PointerEvent>) => void; onPointerOut: () => void; onClick: (e: ThreeEvent<MouseEvent>) => void };

export function BusinessHq({ plan, night, pick }: { plan?: BusinessHqPlan; night: boolean; pick: PickHandlerSet }) {
  const handlers = useMemo<Handlers>(() => {
    const p = pick.of([BOH_KEY, SUPPLIER_HUB_KEY]);
    const key = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.object.userData.pickKey as string | undefined) ?? BOH_KEY;
    return {
      onPointerOver: (e) => { e.stopPropagation(); p.over(key(e), e); },
      onPointerOut: () => p.out(),
      onClick: (e) => { e.stopPropagation(); p.click(key(e), e); },
    };
  }, [pick]);
  if (!plan) return null;
  return (
    <group name="business-operations-hq" position={[plan.x, TERRACE_H, plan.z]}>
      <Swap fallback={<Massing onPick={handlers} />}>
        <Model night={night} onPick={handlers} />
      </Swap>
    </group>
  );
}
