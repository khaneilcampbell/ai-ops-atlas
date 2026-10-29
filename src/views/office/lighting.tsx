import { useEffect, useRef } from "react";
import { Environment, Lightformer } from "@react-three/drei";
import { BrightnessContrast, EffectComposer, HueSaturation, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { LightMode } from "../map3d/living";

/**
 * The office's "Atlas green" look: forest-green walls with gold trim, a warm wood floor and a pool
 * of light over each desk, finished with ambient occlusion and filmic tone mapping. Everything is
 * built in code: the environment comes from Lightformers, not a downloaded HDR, because the app's
 * CSP only allows files Atlas serves itself.
 */
interface Rig {
  hemi: [sky: string, ground: string, intensity: number];
  sun: { pos: [number, number, number]; color: string; intensity: number };
  /** Softboxes reflected in every surface. */
  env: number;
  envTint: string;
  /** The pool of light over each desk. */
  desk: { color: string; intensity: number };
}

const DAY: Rig = { hemi: ["#e8ecdf", "#56614f", 0.55], sun: { pos: [-5, 13, 6], color: "#fff1dc", intensity: 1.6 }, env: 0.6, envTint: "#ffffff", desk: { color: "#ffe2b5", intensity: 45 } };
const NIGHT: Rig = { hemi: ["#7f93ba", "#1c241e", 0.18], sun: { pos: [-5, 13, 6], color: "#94a6cf", intensity: 0.22 }, env: 0.18, envTint: "#ffd39a", desk: { color: "#ffd39a", intensity: 60 } };

export const SURFACE_COLORS = { wall: "#4d6b56", floor: "#b99a74", rug: "#24342a", trim: "#c9a35a" };

/** OfficeLighting: sky fill, sun with soft shadows, studio environment and desk lights, sized to the room. */
export function OfficeLighting({ light, size, height, desks }: { light: LightMode; size: number; height: number; desks: { x: number; z: number }[] }) {
  const rig = light === "night" ? NIGHT : DAY;
  const sun = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    const s = sun.current;
    if (!s) return;
    const c = s.shadow.camera;
    c.left = c.bottom = -size;
    c.right = c.top = size;
    c.near = 0.5;
    c.far = 40;
    c.updateProjectionMatrix();
    s.shadow.needsUpdate = true;
  }, [size, rig]);

  return (
    <>
      <hemisphereLight args={rig.hemi} />
      <directionalLight
        ref={sun}
        castShadow
        position={rig.sun.pos}
        intensity={rig.sun.intensity}
        color={rig.sun.color}
        shadow-mapSize={[2048, 2048]}
        shadow-radius={4}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
      {desks.map((d, i) => (
        <DeskSpot key={i} x={d.x} z={d.z} y={height + 1.2} color={rig.desk.color} intensity={rig.desk.intensity} />
      ))}
      <Environment resolution={128} frames={1} environmentIntensity={rig.env}>
        {/* Overhead softboxes, a warm key from the window side and a cool rim opposite. */}
        <Lightformer form="rect" intensity={2.2} color={rig.envTint} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 6, 1]} />
        <Lightformer form="rect" intensity={1.4} color={rig.envTint} position={[-6, 3, 0]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#cfe0ff" position={[6, 2, 2]} rotation-y={-Math.PI / 2} scale={[6, 2, 1]} />
        <Lightformer form="ring" intensity={0.8} color="#ffffff" position={[0, 2, 7]} scale={2.5} />
      </Environment>
    </>
  );
}

function DeskSpot({ x, z, y, color, intensity }: { x: number; z: number; y: number; color: string; intensity: number }) {
  const ref = useRef<THREE.SpotLight>(null);
  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    s.target.position.set(x, 0, z + 0.3);
    s.target.updateMatrixWorld();
  }, [x, z]);
  return <spotLight ref={ref} position={[x, y, z + 0.3]} angle={0.62} penumbra={0.85} distance={7} decay={1.4} intensity={intensity} color={color} />;
}

/** OfficeFinish: ambient occlusion, filmic tone mapping and a light grade. Lighter on phones. */
export function OfficeFinish({ phone }: { phone: boolean }) {
  return (
    <EffectComposer multisampling={phone ? 0 : 4}>
      <N8AO aoRadius={0.9} intensity={3.5} distanceFalloff={0.6} quality={phone ? "performance" : "medium"} halfRes={phone} />
      <HueSaturation saturation={0.06} />
      <BrightnessContrast brightness={-0.02} contrast={0.1} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.3} darkness={0.4} />
    </EffectComposer>
  );
}
