import {Component,Suspense,useEffect,useMemo,type ReactNode} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import {useGLTF} from '@react-three/drei';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {HQ} from './atlasHqPlan';
import {HQ_PALETTE as P} from './atlasHqPalette';
import {ccGlassTexture,ccLobbyTexture,ccNameplate} from './commandCenterTextures';
import {CC,ccBay,ccEntrance,ccGrounds,ccRoof,type CcBox} from './commandCenterPlan';

const noRaycast=()=>null;

/**
 * The building itself: a Blender model (assets/command-center/build_command_center.py), one mesh
 * per material. Plain glTF, no Draco or Meshopt, so the strict CSP stays as it is.
 */
export const CC_MODEL_URL=`${import.meta.env.BASE_URL}models/map/command-center.glb`;
useGLTF.preload(CC_MODEL_URL,false,false);
/** The model's meshes, by name. */
export const CC_PARTS=['cc_glass','cc_lobby','cc_stone','cc_roof','cc_frame','cc_brass','cc_hedge','cc_lawn'] as const;
type Part=(typeof CC_PARTS)[number];
/** The parts a click or hover on selects the building; the rest let the ray through. */
const PICKED:ReadonlySet<Part>=new Set(['cc_glass','cc_lobby','cc_stone']);

type Handlers={onPointerOver:(e:ThreeEvent<PointerEvent>)=>void;onPointerOut:()=>void;onClick:(e:ThreeEvent<MouseEvent>)=>void};

/**
 * Atlas Command Center (Khaneil, 2026-11-17, after his concept image): the lobby and four office
 * floors you enter. Green-framed glass with warm-lit offices between thick cream stone slabs, a
 * glass wing turning the front corner in a wide curve, a stone entrance bay with the gold Atlas
 * mark and name, a gold-lit lobby under a brass canopy and planting round the roof.
 * Eight model meshes plus a few instanced sets: about a dozen draw calls and no lights of its
 * own. Night lights the windows the way the other buildings light theirs.
 */
export function AtlasHq({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const k=t.size/HQ.refSize;
 const mats=useMemo(()=>{
  const office=ccGlassTexture(),warm=ccLobbyTexture();
  const std=(o:THREE.MeshStandardMaterialParameters)=>focusable(new THREE.MeshStandardMaterial(o));
  const byPart:Record<Part,THREE.MeshStandardMaterial>={
   cc_glass:std({map:office.map,emissiveMap:office.glow,emissive:P.towerGlow,emissiveIntensity:.45,roughness:.3,metalness:.1}),
   cc_lobby:std({map:warm.map,emissiveMap:warm.glow,emissive:P.wingGlow,emissiveIntensity:.55,roughness:.35,metalness:.1}),
   // Honed stone: rough and not metallic, so it reads cream in daylight.
   cc_stone:std({color:P.stone,roughness:.78,metalness:0}),
   cc_roof:std({color:P.stoneShade,roughness:.9}),
   cc_frame:std({color:P.frame,roughness:.5,metalness:.2}),
   cc_brass:std({color:P.brass,roughness:.36,metalness:.65}),
   cc_hedge:std({color:P.hedge,roughness:.9,flatShading:true}),
   cc_lawn:std({color:P.lawn,roughness:.95}),
  };
  return {byPart,textures:[office.map,office.glow,warm.map,warm.glow]};
 },[]);
 useEffect(()=>{mats.byPart.cc_glass.emissiveIntensity=night?1.1:.45;mats.byPart.cc_lobby.emissiveIntensity=night?1.4:.55;},[mats,night]);
 useEffect(()=>()=>{for(const x of Object.values(mats.byPart))x.dispose();for(const x of mats.textures)x.dispose();},[mats]);

 const signs=useMemo(()=>{
  const name=ccNameplate();
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  // Same "Project workers" badge the other headquarters carry when agents or automations work there.
  const worker=t.agents+t.automations>0?mat(signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'),.55):null;
  return {name,nameMat:mat(name,.12),worker};
 },[t.agents,t.automations]);
 useEffect(()=>()=>{signs.name.dispose();signs.nameMat.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const place=([x,y,z,w,h,d,c]:CcBox):Inst=>({p:[t.x+x,base+y,t.z+z],s:[w,h,d],c});
  const door=ccEntrance(k),grounds=ccGrounds(k);
  return {door:[...door.boxes,...grounds.boxes].map(place),lamps:door.lamps.map(place),
   blobs:grounds.blobs.map((b,i)=>({...place(b),r:i})),trunks:grounds.trunks.map(place)};
 },[t.x,t.z,base,k]);

 const handlers=useMemo<Handlers>(()=>({
  onPointerOver:(e)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);

 // The gold mark and name fill the stone bay's face, above the brass canopy.
 const bay=ccBay(k),face=bay.front+.004*k;
 // Until the model has loaded (or if it cannot), a plain stone block of the same size keeps the building pickable.
 const block=<mesh geometry={g.box} material={mats.byPart.cc_stone} position={[0,ccRoof(k)/2,CC.cz*k]} scale={[2*CC.a*k,ccRoof(k),2*CC.b*k]} {...handlers}/>;
 return <group>
  <group position={[t.x,base,t.z]}>
   <ModelBoundary fallback={block}><Suspense fallback={block}><Model k={k} mats={mats.byPart} handlers={handlers}/></Suspense></ModelBoundary>
   <mesh geometry={g.plane} material={signs.nameMat} position={[0,(CC.lobby+3.1*CC.storey)*k,face]} scale={[.44*k,.55*k,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[.55*k,.4*k,(CC.cz+CC.b+CC.slab)*k+.03*k]} scale={[.16*k,.16*k,1]} raycast={noRaycast}/>}
  </group>
  <Instanced items={parts.door} geometry={g.box} material={m.plain}/>
  <Instanced items={parts.lamps} geometry={g.box} material={night?m.lamp:m.plain} shadow={false}/>
  <Instanced items={parts.trunks} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.blobs} geometry={g.blob} material={m.foliage}/>
 </group>;
}

/** The model's meshes, each drawn with the map's own material for its name. */
function Model({k,mats,handlers}:{k:number;mats:Record<Part,THREE.MeshStandardMaterial>;handlers:Handlers}){
 const {scene}=useGLTF(CC_MODEL_URL,false,false);
 const meshes=useMemo(()=>{
  const out:{name:Part;geometry:THREE.BufferGeometry}[]=[];
  scene.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh.isMesh&&(CC_PARTS as readonly string[]).includes(mesh.name))out.push({name:mesh.name as Part,geometry:mesh.geometry});});
  return out;
 },[scene]);
 return <group scale={k}>
  {meshes.map(({name,geometry})=>PICKED.has(name)
   ?<mesh key={name} geometry={geometry} material={mats[name]} castShadow receiveShadow {...handlers}/>
   :<mesh key={name} geometry={geometry} material={mats[name]} castShadow={name!=='cc_lawn'} receiveShadow raycast={noRaycast}/>)}
 </group>;
}

class ModelBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?this.props.fallback:this.props.children;}
}
