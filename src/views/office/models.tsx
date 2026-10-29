import { Component, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Runtime } from "./model";

/**
 * Office furniture and agent figures, generated with Higgsfield (Tripo and Meshy) and shipped with
 * the app under public/models/office. They are quantized glTF with WebP textures, which three.js
 * reads without a WebAssembly decoder, so the strict CSP stays as it is. Each loads lazily; the
 * box-built pieces in OfficeScene stand in until a model arrives or if one fails to load.
 */
const url = (name: string) => `${import.meta.env.BASE_URL}models/office/${name}.glb`;
export const OFFICE_MODELS = ["agent", "desk", "chair", "bookshelf", "rack", "plant"] as const;
type Name = (typeof OFFICE_MODELS)[number];

// No Draco (its decoder lives on a CDN), no Meshopt (WebAssembly).
const useModel = (name: Name) => useGLTF(url(name), false, false);

/**
 * Scale and seat an object so its bounds are `height` tall, centered on x/z, resting on y = 0.
 * With `width`, the footprint is stretched to that width along x instead of scaling with height.
 */
function fit(obj: THREE.Object3D, height: number, ry = 0, width?: number) {
  const holder = new THREE.Group();
  obj.rotation.y = ry;
  holder.add(obj);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder, true);
  const k = height / (box.max.y - box.min.y);
  const kx = width ? width / (box.max.x - box.min.x) : k;
  const c = box.getCenter(new THREE.Vector3());
  holder.scale.set(kx / k, 1, kx / k);
  obj.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  obj.scale.setScalar(k);
  return holder;
}

function shadows(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
}

/** Prop: one static model, fitted to a height and turned to face the room. */
export function Prop({ name, height, width, ry = 0, ...rest }: { name: Exclude<Name, "agent">; height: number; width?: number; ry?: number } & JSX.IntrinsicElements["group"]) {
  const { scene } = useModel(name);
  const invalidate = useThree((t) => t.invalidate);
  const obj = useMemo(() => {
    const o = scene.clone(true);
    shadows(o);
    return fit(o, height, ry, width);
  }, [scene, height, ry, width]);
  // The office draws on demand; draw once more now the model is in.
  useEffect(() => invalidate(), [obj, invalidate]);
  return <primitive object={obj} {...rest} />;
}

// Shirt tint: texels that are bright and unsaturated (the white shirt) take the agent's accent.
const TINT_FRAG = `
  #include <map_fragment>
  {
    float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    float s = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
    float m = smoothstep(0.5, 0.7, l) * (1.0 - smoothstep(0.1, 0.22, s));
    diffuseColor.rgb = mix(diffuseColor.rgb, uAccent * (0.7 + 0.3 * l), m * uTint);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l * 0.8), uGrey);
  }
`;

/** AgentModel: the seated agent figure, its shirt in the agent's color, greyed out when offline. */
export function AgentModel({ accent, state, reduced, seed }: { accent: string; state: Runtime["state"]; reduced: boolean; seed: number }) {
  const { scene, animations } = useModel("agent");
  const offline = state === "offline";
  const { obj, uniforms } = useMemo(() => {
    const o = cloneSkinned(scene);
    const uniforms = { uAccent: { value: new THREE.Color(accent) }, uTint: { value: 1 }, uGrey: { value: 0 } };
    o.traverse((c) => {
      const m = c as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniforms);
        sh.fragmentShader = `uniform vec3 uAccent;\nuniform float uTint;\nuniform float uGrey;\n${sh.fragmentShader.replace("#include <map_fragment>", TINT_FRAG)}`;
      };
      m.material = mat;
    });
    // Seated figure, facing the desk (-z in the workstation's frame).
    return { obj: fit(o, 1.7), uniforms };
  }, [scene, accent]);
  useEffect(() => {
    uniforms.uGrey.value = offline ? 1 : 0;
  }, [offline, uniforms]);

  const { actions, names } = useAnimations(animations, obj);
  useEffect(() => {
    const a = actions[names[0]];
    if (!a) return;
    a.play();
    // Spread the idle loops so two agents never breathe in step.
    a.time = seed * a.getClip().duration;
    a.paused = reduced || offline;
    a.timeScale = state === "working" ? 1.25 : 0.8;
    return () => void a.stop();
  }, [actions, names, reduced, offline, state, seed]);

  return <primitive object={obj} />;
}

for (const n of OFFICE_MODELS) useGLTF.preload(url(n), false, false);

/** Swap: the model once it has loaded, the box-built stand-in before that or if it fails. */
export function Swap({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return (
    <ModelBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ModelBoundary>
  );
}

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
