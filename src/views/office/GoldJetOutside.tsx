import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {Sky,Stars} from '@react-three/drei';
import * as THREE from 'three';
import {fleetPose} from '../map3d/flightSchedule';
import {GOLD_JET_SLOT,goldJetLive,type GoldJetWorld} from '../map3d/goldJetPlan';
import {mapToCabin,outsideBoxes,outsideClouds,type OutsideBox} from './goldJetOutsidePlan';

/** Before the map has drawn the city (an interior opened straight from a link), show the airfield on open land. */
const FALLBACK_WORLD:GoldJetWorld={airport:{x:0,z:0},bounds:{x0:-40,z0:-30,x1:40,z1:45},buildings:[]};

function OutsideBoxes({items,night,lit=false,glass=false}:{items:OutsideBox[];night:boolean;lit?:boolean;glass?:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null),invalidate=useThree(s=>s.invalidate);
 const mat=useMemo(()=>glass?new THREE.MeshBasicMaterial():new THREE.MeshStandardMaterial({roughness:lit?.45:1,metalness:lit?.15:0}),[lit,glass]);
 // At night the city's windows glow a little, so the towers still read against the dark.
 useEffect(()=>{if(!(mat instanceof THREE.MeshStandardMaterial))return;mat.emissive.set(lit&&night?'#b98a45':'#000000');mat.emissiveIntensity=lit&&night?.2:0;mat.needsUpdate=true;invalidate();},[mat,lit,night,invalidate]);
 useEffect(()=>()=>mat.dispose(),[mat]);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;const o=new THREE.Object3D(),c=new THREE.Color();
  items.forEach((it,i)=>{o.position.set(it.x,it.y,it.z);o.scale.set(it.w,it.h,it.d);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,c.set(it.c));});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();invalidate();
 },[items,invalidate]);
 if(!items.length)return null;
 return <instancedMesh key={items.length} ref={ref} args={[undefined,mat,items.length]}><boxGeometry/></instancedMesh>;
}

function Clouds({items,night}:{items:{x:number;y:number;z:number;s:number}[];night:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;const o=new THREE.Object3D();
  items.forEach((it,i)=>{o.position.set(it.x,it.y,it.z);o.scale.set(it.s*1.7,it.s*.45,it.s);o.rotation.set(0,it.x*.37,0);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
 },[items]);
 return <instancedMesh ref={ref} args={[undefined,undefined,items.length]}><sphereGeometry args={[1,14,8]}/><meshStandardMaterial color={night?'#4a5468':'#ffffff'} roughness={1} transparent opacity={night?.55:.9} depthWrite={false}/></instancedMesh>;
}

/**
 * The world outside the cabin, drawn in map coordinates and carried past the still cabin by the jet's live pose: the
 * airfield and terminal at the gate and on the runway, the city's towers below in the circuit, clouds at height.
 * The same airport clock as the moving map, so what you see out of the cutaway is where the map says the jet is.
 */
export function GoldJetOutside({night,reduced}:{night:boolean;reduced:boolean}){
 const world=goldJetLive.world??FALLBACK_WORLD,circuit=goldJetLive.circuit;
 const [start]=useState(()=>({clock:goldJetLive.clock,at:performance.now()}));
 const boxes=useMemo(()=>outsideBoxes(world,night),[world,night]);
 const clouds=useMemo(()=>outsideClouds(world,circuit?.altitude??10),[world,circuit]);
 const group=useRef<THREE.Group>(null);
 useFrame(()=>{
  const g=group.current;if(!g)return;
  const clock=reduced?start.clock:start.clock+(performance.now()-start.at)/1000;
  g.matrix.copy(mapToCabin(fleetPose(clock,GOLD_JET_SLOT,circuit),world.airport));
  g.matrixWorldNeedsUpdate=true;
 });
 return <group ref={group} matrixAutoUpdate={false}>
  <mesh position={[0,-1.4,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[4000,4000]}/><meshStandardMaterial color={night?'#0d1a26':'#5f8fae'} roughness={.35} metalness={.1}/></mesh>
  <OutsideBoxes items={boxes.ground} night={night}/>
  <OutsideBoxes items={boxes.buildings} night={night} lit/>
  <OutsideBoxes items={boxes.windows} night={night} glass/>
  <Clouds items={clouds} night={night}/>
 </group>;
}

/** The sky round the cabin: a daylight sky with the sun up, or a starry night. Far away, so it doesn't move. */
export function GoldJetSky({night}:{night:boolean}){
 return night
  ?<><color attach="background" args={['#0a1220']}/><fog attach="fog" args={['#0a1220',260,5200]}/><Stars radius={6000} depth={800} count={2500} factor={60} fade/></>
  :<><color attach="background" args={['#bcd6ea']}/><fog attach="fog" args={['#cfe1ee',320,7000]}/><Sky distance={9000} sunPosition={[1,.35,.6]} turbidity={5} rayleigh={1.2} mieCoefficient={.004} mieDirectionalG={.8}/></>;
}
