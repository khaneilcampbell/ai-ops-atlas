import { useEffect, useMemo, useRef } from "react";
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
  /** Particles run from source to target; only for verified, directed, active links. */
  flow: boolean;
}

type Hue = keyof typeof LINK_COLORS;
/** "glow" is the soft sleeve around the selected or hovered link. */
type Shade = LinkLevel | "glow";
const OPACITY: Record<Shade, number> = { selected: 1, strong: 0.95, weak: 0.55, dim: 0.06, glow: 0.16 };
const RADIUS = 0.055;
const MAX_PARTICLES = 160;
const SPEED = 1.6; // world units per second

const hueOf = (l: NetLink): Hue => (l.status === "unhealthy" ? "unhealthy" : l.type);

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
  const shapeKey = links.map((l) => `${l.id}@${l.path.length}:${l.path[0]?.toArray().join()}>${l.path[l.path.length - 1]?.toArray().join()}`).join("|");
  const built = useMemo<Built[]>(
    () =>
      links.map((link) => {
        const curve = new THREE.CatmullRomCurve3(link.path, false, "centripetal");
        const len = curve.getLength();
        const segs = Math.max(16, Math.min(400, Math.round(len * 12)));
        const pts = curve.getSpacedPoints(segs);
        // The pick target skips both ends so it never covers the buildings' doors.
        const cut = Math.round(segs * Math.min(0.2, 0.4 / Math.max(len, 0.1)));
        const mid = new THREE.CatmullRomCurve3(pts.slice(cut, segs + 1 - cut).length > 1 ? pts.slice(cut, segs + 1 - cut) : pts);
        return {
          link,
          tube: new THREE.TubeGeometry(curve, segs, RADIUS, 6),
          glow: new THREE.TubeGeometry(curve, segs, RADIUS * 2.6, 6),
          hit: new THREE.TubeGeometry(mid, Math.max(8, Math.round(segs / 3)), 0.16, 5),
          pts,
          len,
        };
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
