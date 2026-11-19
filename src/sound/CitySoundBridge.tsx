import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { setSoundScene } from "./listener";

type Anchor = { x: number; z: number; y0: number; y1: number };

/** Lets the city sound hear from the 3D map's camera and find buildings and jets. Draws nothing. */
export function CitySoundBridge({ anchors }: { anchors: ReadonlyMap<string, Anchor> }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    setSoundScene({
      camera,
      scene,
      anchor: (key) => {
        const a = anchors.get(key);
        // Halfway up the building, where its work happens.
        return a ? { x: a.x, y: (a.y0 + a.y1) / 2, z: a.z } : null;
      },
    });
    return () => setSoundScene(null);
  }, [camera, scene, anchors]);
  return null;
}
