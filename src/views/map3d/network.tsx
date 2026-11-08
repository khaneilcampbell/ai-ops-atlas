import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { ConnectionType } from "../../catalog/types";
import { wake } from "../../lib/power";
import { LINK_COLORS, type ConnectionStatus } from "../../lib/connections";
import { night } from "./materials";

/** selected: the connection in hand. strong: verified activity, or related to the selection. */
export type LinkLevel = "selected" | "strong" | "weak" | "dim";

export interface NetLink {
  id: string;
  type: ConnectionType;
  status: ConnectionStatus;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** The arc's peak stays at least this high, to clear the buildings it passes over. */
  clear: number;
  level: LinkLevel;
  /** Particles run from `from` to `to`; only for verified, directed, active links. */
  flow: boolean;
}

type Hue = keyof typeof LINK_COLORS;
/** "glow" is the soft sleeve around the selected or hovered link. */
type Shade = LinkLevel | "glow";
const OPACITY: Record<Shade, number> = { selected: 1, strong: 0.7, weak: 0.22, dim: 0.04, glow: 0.16 };
const RADIUS = 0.035;
const MAX_PARTICLES = 160;
const SPEED = 2.2; // world units per second

const hueOf = (l: NetLink): Hue => (l.status === "unhealthy" ? "unhealthy" : l.type);

/** An arc that rises with the distance it spans and clears the roofs between its ends. */
function arcOf(a: THREE.Vector3, b: THREE.Vector3, clear: number) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  // A quadratic curve peaks at a quarter of each end plus half the control point.
  mid.y = Math.max(Math.max(a.y, b.y) + 0.45 + a.distanceTo(b) * 0.24, 2 * clear - (a.y + b.y) / 2);
  return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
}

interface Built {
  link: NetLink;
  tube: THREE.TubeGeometry;
  hit: THREE.TubeGeometry;
  glow: THREE.TubeGeometry;
  pts: THREE.Vector3[];
  len: number;
}

/**
 * Connections between buildings: one thin tube per link, shared materials per color and level,
 * and every moving particle in a single instanced mesh updated in one frame callback.
 */
export function Network({ links, hover, moving, onHover, onPick }: { links: NetLink[]; hover: string | null; moving: boolean; onHover: (id: string | null, e?: ThreeEvent<PointerEvent>) => void; onPick: (id: string) => void }) {
  const { gl } = useThree();
  // Geometry depends only on where a link runs, so selection changes reuse it.
  const shapeKey = links.map((l) => `${l.id}@${l.from.toArray().join()}>${l.to.toArray().join()}^${l.clear}`).join("|");
  const built = useMemo<Built[]>(
    () =>
      links.map((link) => {
        const curve = arcOf(link.from, link.to, link.clear);
        const pts = curve.getSpacedPoints(64);
        // The pick target skips both ends so it never covers the buildings' roofs.
        const mid = new THREE.CatmullRomCurve3(pts.slice(8, 57));
        return { link, tube: new THREE.TubeGeometry(curve, 48, RADIUS, 6), glow: new THREE.TubeGeometry(curve, 48, RADIUS * 2.6, 6), hit: new THREE.TubeGeometry(mid, 20, 0.2, 5), pts, len: curve.getLength() };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the shapes change
    [shapeKey],
  );
  useEffect(
    () => () =>
      built.forEach((b) => {
        b.tube.dispose();
        b.glow.dispose();
        b.hit.dispose();
      }),
    [built],
  );
  // Levels and flags change on every selection; read them from the latest links by id.
  const current = new Map(links.map((l) => [l.id, l]));

  const mats = useMemo(() => new Map<string, THREE.MeshBasicMaterial>(), []);
  const matOf = (hue: Hue, level: Shade) => {
    const k = `${hue}:${level}`;
    let m = mats.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: LINK_COLORS[hue].day, transparent: true, opacity: OPACITY[level], depthWrite: false, toneMapped: false });
      m.userData = { hue, level };
      mats.set(k, m);
    }
    return m;
  };
  const glowOf = (hue: Hue) => matOf(hue, "glow");
  const hitMat = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), []);
  useEffect(
    () => () => {
      mats.forEach((m) => m.dispose());
      hitMat.dispose();
    },
    [mats, hitMat],
  );

  const dots = useRef<THREE.InstancedMesh>(null);
  const clock = useRef(0);
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), c: new THREE.Color(), d: new THREE.Color(), n: new THREE.Color() }), []);

  useFrame((_, delta) => {
    if (moving) clock.current += Math.min(delta, 0.1);
    const k = night.value;
    const pulse = moving ? 0.78 + 0.22 * Math.sin(clock.current * 3.2) : 1;
    for (const m of mats.values()) {
      const { hue, level } = m.userData as { hue: Hue; level: Shade };
      m.color.set(LINK_COLORS[hue].day).lerp(tmp.n.set(LINK_COLORS[hue].night), k);
      m.opacity = level === "glow" ? OPACITY.glow * pulse + 0.08 * k : OPACITY[level] * (level === "selected" ? pulse : 1) * (level === "weak" ? 1 + 0.25 * k : 1);
    }

    const mesh = dots.current;
    if (!mesh) return;
    let n = 0;
    for (const b of built) {
      const l = current.get(b.link.id);
      if (!l?.flow || l.level === "dim") continue;
      const count = l.level === "selected" ? 4 : Math.max(1, Math.min(3, Math.round(b.len / 6)));
      tmp.c.set(LINK_COLORS[hueOf(l)].day).lerp(tmp.n.set(LINK_COLORS[hueOf(l)].night), k).lerp(tmp.d.set("#ffffff"), 0.35);
      for (let i = 0; i < count && n < MAX_PARTICLES; i++) {
        const t = (((clock.current * SPEED) / b.len + i / count) % 1) * (b.pts.length - 1);
        const j = Math.floor(t);
        tmp.o.position.lerpVectors(b.pts[j], b.pts[Math.min(j + 1, b.pts.length - 1)], t - j);
        tmp.o.scale.setScalar(l.level === "selected" ? 1.25 : 1);
        tmp.o.updateMatrix();
        mesh.setMatrixAt(n, tmp.o.matrix);
        mesh.setColorAt(n, tmp.c);
        n++;
      }
    }
    mesh.count = n;
    // Particles travel fast enough that 30 frames a second would show; keep full rate while they flow.
    if (n && moving) wake(100);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const setCursor = (on: boolean) => (gl.domElement.style.cursor = on ? "pointer" : "");
  return (
    <group>
      {built.map((b) => {
        const l = current.get(b.link.id) ?? b.link;
        return (
          <group key={b.link.id}>
            <mesh geometry={b.tube} material={matOf(hueOf(l), l.level)} raycast={() => null} renderOrder={2} />
            {(l.level === "selected" || (hover === l.id && l.level !== "dim")) && <mesh geometry={b.glow} material={glowOf(hueOf(l))} raycast={() => null} renderOrder={1} />}
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
      <instancedMesh ref={dots} args={[DOT, DOT_MAT, MAX_PARTICLES]} raycast={() => null} frustumCulled={false} renderOrder={3} />
    </group>
  );
}

const DOT = new THREE.SphereGeometry(0.075, 10, 8);
const DOT_MAT = new THREE.MeshBasicMaterial({ toneMapped: false });
