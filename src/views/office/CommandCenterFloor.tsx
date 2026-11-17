import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import CutawayWall from "./CutawayWall";
import { FLOOR4_MODEL } from "./commandCenterFloorPlan";

/**
 * The Command Center's Floor 4 from Blender (commandCenterFloorPlan.ts). Loaded the first time the
 * floor is drawn, never at start-up; until then, or if it fails, the box-built room stands in
 * (OfficeScene wraps both in Swap). The room's own pieces never take a click, so they can't come
 * between the camera and an agent's desk; the desk kit sits inside each desk's own click target.
 */
const url = () => `${import.meta.env.BASE_URL}${FLOOR4_MODEL}`;
// No Draco or Meshopt: plain glTF keeps the strict CSP as it is (models.tsx).
const useFloorModel = () => useGLTF(url(), false, false);

const noRaycast = () => null;

function prepare(node: THREE.Object3D, clickable: boolean) {
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.transparent) {
      // Glass: seen through, never hiding what is behind it, and casting no shadow.
      mat.depthWrite = false;
      m.renderOrder = 1;
      m.castShadow = false;
    } else m.castShadow = true;
    m.receiveShadow = true;
    if (!clickable) m.raycast = noRaycast;
  });
  return node;
}

function part(scene: THREE.Object3D, name: string, clickable: boolean) {
  const node = scene.getObjectByName(name);
  if (!node) throw new Error(`${FLOOR4_MODEL} has no ${name}`);
  return prepare(node.clone(true), clickable);
}

/** The room: carpet, meeting room, lounge, storage and planting, and the service core, which steps aside like a back wall when the camera goes behind it. */
export function FurnishedFloor() {
  const { scene } = useFloorModel();
  const invalidate = useThree((t) => t.invalidate);
  const room = useMemo(() => ({ fixed: part(scene, "static", false), core: part(scene, "cutaway_back", false) }), [scene]);
  useEffect(() => invalidate(), [room, invalidate]);
  return (
    <group>
      <primitive object={room.fixed} />
      <CutawayWall side="back">
        <primitive object={room.core} />
      </CutawayWall>
    </group>
  );
}

/** One desk's furniture (desk, privacy screen, chair, monitor housing), placed by the workstation it belongs to. */
export function DeskKit() {
  const { scene } = useFloorModel();
  const invalidate = useThree((t) => t.invalidate);
  const kit = useMemo(() => part(scene, "kit", true), [scene]);
  useEffect(() => invalidate(), [kit, invalidate]);
  return <primitive object={kit} />;
}
