import { useEffect, useRef } from "react";
import { Environment, Lightformer } from "@react-three/drei";
import { BrightnessContrast, EffectComposer, HueSaturation, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { LightMode } from "../map3d/living";

/**
 * Office lighting looks. Each one is a full lighting rig (sky fill, sun, studio environment,
 * after-dark room light) plus a finishing pass (ambient occlusion, tone mapping, grade).
 * Everything is built in code: the environment comes from Lightformers, not a downloaded HDR,
 * because the app's CSP only allows files Atlas serves itself.
 */
export type OfficeLook = "classic" | "studio" | "golden" | "gallery";
export const OFFICE_LOOKS: OfficeLook[] = ["classic", "studio", "golden", "gallery"];

interface Rig {
  hemi: [sky: string, ground: string, intensity: number];
  sun: { pos: [number, number, number]; color: string; intensity: number; radius: number };
  /** Studio softboxes reflected in every surface; 0 turns the environment off. */
  env: number;
  envTint: string;
  /** Overhead room light after dark (a single warm point) or per-desk pools (spots). */
  room: { kind: "point" | "spots"; color: string; intensity: number } | null;
}

interface Look {
  day: Rig;
  night: Rig;
  /** Surface colors; null keeps the classic material. */
  surfaces: { wall: string; floor: string; rug: string; trim: string } | null;
  finish: { ao: number; aoRadius: number; vignette: number; saturation: number; contrast: number; brightness: number } | null;
}

const LOOKS: Record<OfficeLook, Look> = {
  // Today's lighting, untouched, so the comparison has a fixed reference.
  classic: {
    day: { hemi: ["#fff6e4", "#8a9a7a", 1.2], sun: { pos: [-6, 11, 7], color: "#fff0d2", intensity: 2.1, radius: 1 }, env: 0, envTint: "#ffffff", room: null },
    night: { hemi: ["#9fb4d8", "#2a3328", 0.45], sun: { pos: [-6, 11, 7], color: "#a8b8e0", intensity: 0.35, radius: 1 }, env: 0, envTint: "#ffffff", room: { kind: "point", color: "#ffd9a0", intensity: 14 } },
    surfaces: null,
    finish: null,
  },
  // A: soft, even, neutral. Big softboxes overhead, a high sun with very soft shadows.
  studio: {
    day: { hemi: ["#f4f1ea", "#9aa58f", 0.6], sun: { pos: [-5, 13, 7], color: "#fff7ea", intensity: 2.8, radius: 4 }, env: 0.4, envTint: "#ffffff", room: null },
    night: { hemi: ["#9fb4d8", "#2a3328", 0.3], sun: { pos: [-5, 13, 7], color: "#b7c4e4", intensity: 0.35, radius: 4 }, env: 0.25, envTint: "#ffe2b8", room: { kind: "point", color: "#ffdcae", intensity: 12 } },
    surfaces: { wall: "#efeae0", floor: "#dcd6ca", rug: "#3a5242", trim: "#33483a" },
    finish: { ao: 3.5, aoRadius: 0.9, vignette: 0.25, saturation: 0.02, contrast: 0.04, brightness: 0 },
  },
  // B: low warm sun from the windows' side, long soft shadows, cool fill in the shade.
  golden: {
    day: { hemi: ["#c9d6ee", "#7e8a6c", 0.6], sun: { pos: [-11, 6.5, 3], color: "#ffc98a", intensity: 3.2, radius: 4 }, env: 0.55, envTint: "#ffd7a8", room: null },
    night: { hemi: ["#8ea3cc", "#232c25", 0.25], sun: { pos: [-11, 6.5, 3], color: "#9fb1db", intensity: 0.35, radius: 4 }, env: 0.3, envTint: "#ffc98a", room: { kind: "point", color: "#ffc98a", intensity: 15 } },
    surfaces: { wall: "#f0e3cc", floor: "#d9c9ad", rug: "#2f4535", trim: "#2f4535" },
    finish: { ao: 3.5, aoRadius: 0.9, vignette: 0.35, saturation: 0.12, contrast: 0.08, brightness: 0 },
  },
  // C: Atlas forest-green walls, dimmer room, warm light pooled over each desk.
  gallery: {
    day: { hemi: ["#e8ecdf", "#56614f", 0.55], sun: { pos: [-5, 13, 6], color: "#fff1dc", intensity: 1.6, radius: 4 }, env: 0.6, envTint: "#ffffff", room: { kind: "spots", color: "#ffe2b5", intensity: 45 } },
    night: { hemi: ["#7f93ba", "#1c241e", 0.18], sun: { pos: [-5, 13, 6], color: "#94a6cf", intensity: 0.22, radius: 4 }, env: 0.18, envTint: "#ffd39a", room: { kind: "spots", color: "#ffd39a", intensity: 60 } },
    surfaces: { wall: "#4d6b56", floor: "#b99a74", rug: "#24342a", trim: "#c9a35a" },
    finish: { ao: 3.5, aoRadius: 0.9, vignette: 0.4, saturation: 0.06, contrast: 0.1, brightness: -0.02 },
  },
};

/** The look to show: a saved choice, or classic. */
export function readOfficeLook(): OfficeLook {
  try {
    const v = JSON.parse(localStorage.getItem("atlas:officeLook") ?? "null");
    return OFFICE_LOOKS.includes(v) ? v : "classic";
  } catch {
    return "classic";
  }
}

export interface Surfaces {
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  rug: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
}

/** OfficeLighting: the lights and environment for one look, sized to the room. */
export function OfficeLighting({ look, light, size, height, desks, mats }: { look: OfficeLook; light: LightMode; size: number; height: number; desks: { x: number; z: number }[]; mats: Surfaces }) {
  const L = LOOKS[look];
  const rig = light === "night" ? L.night : L.day;
  const sun = useRef<THREE.DirectionalLight>(null);

  // Remember each material's classic color once, so switching back to classic restores it.
  useEffect(() => {
    for (const [k, m] of Object.entries(mats) as [keyof Surfaces, THREE.MeshStandardMaterial][]) {
      if (m.userData.classic == null) m.userData.classic = `#${m.color.getHexString()}`;
      m.color.set(L.surfaces ? L.surfaces[k] : m.userData.classic);
    }
  }, [L, mats]);

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

  const big = look !== "classic";
  return (
    <>
      <hemisphereLight args={rig.hemi} />
      <directionalLight
        ref={sun}
        castShadow
        position={rig.sun.pos}
        intensity={rig.sun.intensity}
        color={rig.sun.color}
        shadow-mapSize={big ? [2048, 2048] : [1024, 1024]}
        shadow-radius={rig.sun.radius}
        shadow-blurSamples={12}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
      {rig.room?.kind === "point" && <pointLight position={[0, height + 0.4, 0]} intensity={rig.room.intensity} distance={size * 1.6} decay={1.6} color={rig.room.color} />}
      {rig.room?.kind === "spots" &&
        desks.map((d, i) => <DeskSpot key={i} x={d.x} z={d.z} y={height + 1.2} color={rig.room!.color} intensity={rig.room!.intensity} />)}
      {rig.env > 0 && (
        <Environment resolution={128} frames={1} environmentIntensity={rig.env}>
          {/* Overhead softboxes, a warm key from the window side and a cool rim opposite. */}
          <Lightformer form="rect" intensity={2.2} color={rig.envTint} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 6, 1]} />
          <Lightformer form="rect" intensity={1.4} color={rig.envTint} position={[-6, 3, 0]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
          <Lightformer form="rect" intensity={0.6} color="#cfe0ff" position={[6, 2, 2]} rotation-y={-Math.PI / 2} scale={[6, 2, 1]} />
          <Lightformer form="ring" intensity={0.8} color="#ffffff" position={[0, 2, 7]} scale={2.5} />
        </Environment>
      )}
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

/** OfficeFinish: ambient occlusion, filmic tone mapping and a light grade. Classic has none. */
export function OfficeFinish({ look, phone }: { look: OfficeLook; phone: boolean }) {
  const f = LOOKS[look].finish;
  if (!f) return null;
  return (
    <EffectComposer multisampling={phone ? 0 : 4}>
      <N8AO aoRadius={f.aoRadius} intensity={f.ao} distanceFalloff={0.6} quality={phone ? "performance" : "medium"} halfRes={phone} />
      <HueSaturation saturation={f.saturation} />
      <BrightnessContrast brightness={f.brightness} contrast={f.contrast} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.3} darkness={f.vignette} />
    </EffectComposer>
  );
}
