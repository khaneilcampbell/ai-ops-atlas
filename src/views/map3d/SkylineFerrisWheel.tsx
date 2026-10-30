import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TERRACE_H, type Scene3D } from "./scene";

const RADIUS = 1.65;
const CABINS = 12;
const GREEN = "#294c40";
const GOLD = "#d3b36e";

/** A slow, balanced observation wheel. Cabins counter-rotate to remain upright. */
function Wheel({ x, z, reduced }: { x: number; z: number; reduced: boolean }) {
  const rotor = useRef<THREE.Group>(null);
  const cabins = useRef<(THREE.Group | null)[]>([]);
  const angle = useRef(0);
  useFrame((_, delta) => {
    if (reduced || !rotor.current) return;
    angle.current = (angle.current + Math.min(delta, 0.05) * 0.045) % (Math.PI * 2);
    rotor.current.rotation.z = angle.current;
    for (const cabin of cabins.current) if (cabin) cabin.rotation.z = -angle.current;
  });
  return <group position={[x, TERRACE_H + 0.04, z]}>
    <mesh position={[0, 0.05, 0]} receiveShadow><boxGeometry args={[4.1, 0.1, 1.5]} /><meshStandardMaterial color="#d5c9ae" roughness={0.85} /></mesh>
    {[-1, 1].map(side => <group key={side}>
      <mesh position={[side * 0.65, 1.15, 0.28]} rotation={[0, 0, side * 0.29]} castShadow><boxGeometry args={[0.13, 2.45, 0.15]} /><meshStandardMaterial color={GREEN} metalness={0.35} roughness={0.5} /></mesh>
      <mesh position={[side * 0.85, 0.14, 0.28]}><boxGeometry args={[0.65, 0.18, 0.55]} /><meshStandardMaterial color={GOLD} /></mesh>
    </group>)}
    <group position={[0, 2.35, 0]} ref={rotor}>
      {[-0.16, 0.16].map(depth => <mesh key={depth} position={[0, 0, depth]}><torusGeometry args={[RADIUS, 0.045, 6, 64]} /><meshStandardMaterial color={GOLD} metalness={0.45} roughness={0.35} /></mesh>)}
      {Array.from({ length: CABINS }, (_, i) => {
        const a = i * Math.PI * 2 / CABINS;
        return <group key={i}>
          <mesh position={[Math.cos(a) * RADIUS / 2, Math.sin(a) * RADIUS / 2, 0]} rotation={[0, 0, a]}><boxGeometry args={[RADIUS, 0.018, 0.025]} /><meshStandardMaterial color={GREEN} /></mesh>
          <group position={[Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 0]} ref={node => { cabins.current[i] = node; }}>
            <mesh position={[0, -0.11, 0]}><boxGeometry args={[0.025, 0.23, 0.025]} /><meshStandardMaterial color={GOLD} /></mesh>
            <mesh position={[0, -0.34, 0]} castShadow><boxGeometry args={[0.31, 0.24, 0.38]} /><meshStandardMaterial color="#97c5bd" transparent opacity={0.78} roughness={0.2} /></mesh>
            <mesh position={[0, -0.49, 0]}><boxGeometry args={[0.34, 0.08, 0.4]} /><meshStandardMaterial color={i % 3 === 0 ? GOLD : GREEN} /></mesh>
            <mesh position={[0, -0.2, 0]}><boxGeometry args={[0.36, 0.05, 0.42]} /><meshStandardMaterial color={GREEN} /></mesh>
            <mesh position={[0, -0.2, 0.22]}><sphereGeometry args={[0.025, 6, 4]} /><meshStandardMaterial color="#fff1cd" emissive="#fff1cd" emissiveIntensity={1.4} toneMapped={false} /></mesh>
          </group>
        </group>;
      })}
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.17, 0.17, 0.55, 16]} /><meshStandardMaterial color={GOLD} metalness={0.5} roughness={0.3} /></mesh>
    </group>
  </group>;
}

export function SkylineFerrisWheel({ parks, reduced }: { parks: Scene3D["parks"]; reduced: boolean }) {
  return <group>{parks.map(park => <Wheel key={park.id} x={park.x + park.w / 2} z={park.z + park.d / 2 - 3.5} reduced={reduced} />)}</group>;
}
