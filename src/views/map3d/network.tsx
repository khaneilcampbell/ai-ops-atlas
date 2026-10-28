import { useEffect, useMemo } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { ConnectionType } from "../../catalog/types";
import { LINK_COLORS, type ConnectionStatus } from "../../lib/connections";
import { night } from "./materials";

/** selected: the connection in hand. strong: verified activity, or related to the selection. */
export type LinkLevel = "selected" | "strong" | "weak" | "dim";

export interface NetLink {
  id: string;
  type: ConnectionType;
  status: ConnectionStatus;
  /** The route along the map's paths, from source to target, just above the pavement. */
  path: THREE.Vector3[];
  level: LinkLevel;
  /** Light pulses run from source to target; only for verified, directed, active links. */
  flow: boolean;
}

const ALPHA: Record<LinkLevel, number> = { selected: 1, strong: 0.95, weak: 0.6, dim: 0.08 };
/** Half the ribbon's width; the bright hairline is its middle fifth, the rest is glow. */
const HALF = 0.11;
const SPEED = 1.3; // world units per second
const SPACING = 1.6;

const VERT = /* glsl */ `
attribute float aDist;
attribute float aSide;
varying float vDist;
varying float vSide;
void main() {
  vDist = aDist;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uGlow;
uniform float uCore;
uniform float uFlow;
uniform float uLen;
uniform float uTime;
varying float vDist;
varying float vSide;
void main() {
  float s = abs(vSide);
  float core = 1.0 - smoothstep(uCore, uCore + 0.16, s);
  float halo = (1.0 - s) * (1.0 - s) * uGlow;
  // A comet of light every few units, its head leading toward the target.
  float d = fract((vDist - uTime * ${SPEED.toFixed(2)}) / ${SPACING.toFixed(2)});
  float pulse = uFlow * pow(d, 14.0);
  // Fade in and out at the buildings so the ribbon does not end in a hard edge.
  float ends = smoothstep(0.0, 0.3, vDist) * smoothstep(0.0, 0.3, uLen - vDist);
  vec3 col = mix(uColor, vec3(1.0), pulse * 0.75);
  float a = core * (0.9 + 0.1 * pulse) + halo * (0.32 + 0.6 * pulse);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAlpha * ends);
}`;

interface Built {
  link: NetLink;
  ribbon: THREE.BufferGeometry;
  hit: THREE.TubeGeometry;
  mat: THREE.ShaderMaterial;
}

/** A flat strip along the route, with distance along it and side across it for the shader. */
function ribbonOf(path: THREE.Vector3[]) {
  const pts = path.filter((p, i) => i === 0 || p.distanceToSquared(path[i - 1]) > 1e-8);
  const pos: number[] = [];
  const dist: number[] = [];
  const side: number[] = [];
  const idx: number[] = [];
  let run = 0;
  let nx = 0;
  let nz = 1;
  pts.forEach((p, i) => {
    if (i) run += p.distanceTo(pts[i - 1]);
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const o = pts[Math.max(i - 1, 0)];
    const tx = q.x - o.x;
    const tz = q.z - o.z;
    const n = Math.hypot(tx, tz);
    // Straight up a step there is no direction across; keep the last one.
    if (n > 1e-6) {
      nx = -tz / n;
      nz = tx / n;
    }
    for (const sd of [-1, 1]) {
      pos.push(p.x + nx * HALF * sd, p.y, p.z + nz * HALF * sd);
      dist.push(run);
      side.push(sd);
    }
    if (i) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1));
  g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { g, len: run, pts };
}

/**
 * Connections between buildings: a thin lit inlay along the walkways, colored by health, with
 * light pulses for verified activity. One small shader per link, all driven by one clock.
 */
export function Network({ links, hover, moving, onHover, onPick }: { links: NetLink[]; hover: string | null; moving: boolean; onHover: (id: string | null, e?: ThreeEvent<PointerEvent>) => void; onPick: (id: string) => void }) {
  const { gl } = useThree();
  const time = useMemo(() => ({ value: 0 }), []);
  // Geometry depends only on where a link runs, so selection changes reuse it.
  const shapeKey = links.map((l) => `${l.id}@${l.path.length}:${l.path[0]?.toArray().join()}>${l.path[l.path.length - 1]?.toArray().join()}`).join("|");
  const built = useMemo<Built[]>(
    () =>
      links.map((link) => {
        const { g, len, pts } = ribbonOf(link.path);
        // The pick target skips both ends so it never covers the buildings' doors.
        const cut = Math.min(Math.floor(pts.length / 3), Math.max(1, Math.round(pts.length * Math.min(0.2, 0.4 / Math.max(len, 0.1)))));
        const mid = pts.length > 2 * cut + 1 ? pts.slice(cut, pts.length - cut) : pts;
        const curve = new THREE.CatmullRomCurve3(mid.length > 1 ? mid : [pts[0], pts[0].clone().add(new THREE.Vector3(0.01, 0, 0))], false, "centripetal");
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uGlow: { value: 0.4 }, uCore: { value: 0.14 }, uFlow: { value: 0 }, uLen: { value: len }, uTime: time },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          toneMapped: false,
        });
        return { link, ribbon: g, hit: new THREE.TubeGeometry(curve, Math.max(8, mid.length * 2), 0.16, 5), mat };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the shapes change
    [shapeKey],
  );
  useEffect(
    () => () =>
      built.forEach((b) => {
        b.ribbon.dispose();
        b.hit.dispose();
        b.mat.dispose();
      }),
    [built],
  );
  // Levels and flags change on every selection; read them from the latest links by id.
  const current = new Map(links.map((l) => [l.id, l]));
  const hitMat = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), []);
  useEffect(() => () => hitMat.dispose(), [hitMat]);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    // Frozen, not hidden, when motion is off: the pulses stay where they are.
    if (moving) time.value += Math.min(delta, 0.1);
    const k = night.value;
    for (const b of built) {
      const l = current.get(b.link.id) ?? b.link;
      const u = b.mat.uniforms;
      const lit = l.level === "selected" || (hover === l.id && l.level !== "dim");
      u.uColor.value.set(LINK_COLORS[l.status].day).lerp(tmp.set(LINK_COLORS[l.status].night), k);
      u.uAlpha.value = lit ? 1 : ALPHA[l.level] * (l.level === "weak" ? 1 + 0.3 * k : 1);
      // A soft glow at night, like the path lights; the link in hand glows at any hour.
      u.uGlow.value = lit ? 1 : l.level === "dim" ? 0 : 0.45 + 0.4 * k;
      // The link in hand is drawn a little wider.
      u.uCore.value = lit ? 0.3 : 0.14;
      u.uFlow.value = l.flow && l.level !== "dim" ? 1 : 0;
    }
  });

  const setCursor = (on: boolean) => (gl.domElement.style.cursor = on ? "pointer" : "");
  return (
    <group>
      {built.map((b) => {
        const l = current.get(b.link.id) ?? b.link;
        return (
          <group key={b.link.id}>
            <mesh geometry={b.ribbon} material={b.mat} raycast={() => null} renderOrder={l.level === "selected" || hover === l.id ? 3 : 2} />
            {l.level !== "dim" && (
              <mesh
                geometry={b.hit}
                material={hitMat}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setCursor(true);
                  onHover(b.link.id, e);
                }}
                onPointerOut={() => {
                  setCursor(false);
                  onHover(null);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.delta > 4) return;
                  onPick(b.link.id);
                }}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}
