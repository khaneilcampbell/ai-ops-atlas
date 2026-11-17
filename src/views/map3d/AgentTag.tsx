import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { AgentTagInfo } from "./agentTagInfo";

/**
 * Follows one instanced walker (by its index in the people meshes) and holds the agent's card
 * above its head, so Khaneil can tell who an agent is wherever it walks. Hidden while the figure is.
 */
export function AgentTag({ mesh, index, info }: { mesh: React.RefObject<THREE.InstancedMesh>; index: number; info: AgentTagInfo }) {
  const group = useRef<THREE.Group>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }), []);
  useFrame(() => {
    const g = group.current, im = mesh.current;
    if (!g || !im || index >= im.count) return;
    im.getMatrixAt(index, tmp.m);
    tmp.m.decompose(tmp.p, tmp.q, tmp.s);
    g.visible = tmp.s.x > 0.001;
    g.position.copy(tmp.p);
  });
  return (
    <group ref={group}>
      <Html position={[0, 0.42, 0]} zIndexRange={[40, 30]} style={{ pointerEvents: "none" }}>
        <div className="m3-agent-tag" role="status" aria-label={`${info.name}, ${info.stateLabel}`}>
          <div className="n">{info.name}</div>
          {info.role && <div className="r">{info.role}</div>}
          <div className="st">
            <i style={{ background: info.stateColor }} />
            {info.stateLabel}
            <span> · away from its desk</span>
          </div>
          <dl>
            <dt>Home</dt>
            <dd>
              {info.home.label}
              {info.home.source === "assigned" && <em> · assigned by Atlas</em>}
            </dd>
            <dt>Work</dt>
            <dd>
              {info.work.label}
              {info.work.source === "assigned" && <em> · assigned by Atlas</em>}
            </dd>
          </dl>
        </div>
      </Html>
    </group>
  );
}
