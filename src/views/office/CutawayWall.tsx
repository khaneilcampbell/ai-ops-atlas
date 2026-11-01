import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { quarterOf } from "../map3d/trackpad";

/**
 * A full-height wall of the cutaway, shown only while the camera is on the room's side of it.
 * The room is drawn around the origin, so the back wall (z < 0) steps aside once the camera
 * moves behind the middle, and the left wall (x < 0) once it moves left of it. Checked each
 * drawn frame, which on an on-demand canvas is only while the view moves.
 */
export default function CutawayWall({ side, always = false, children }: { side: "back" | "left"; always?: boolean; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g) return;
    const q = quarterOf(camera.position);
    g.visible = always || (side === "back" ? q.z > 0 : q.x > 0);
  });
  return <group ref={ref}>{children}</group>;
}
