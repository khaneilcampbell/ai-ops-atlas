import {useEffect,useMemo} from "react";
import type {ThreeEvent} from "@react-three/fiber";
import * as THREE from "three";
import {TERRACE_H} from "./scene";
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from "./models";
import {focusable} from "./materials";
import {stadiumRoofTexture} from "./stadiumTextures";
import {STADIUM_SCALE as K,stadiumCentre,stadiumGeometry} from "./stadiumGeometry";
export {STADIUM_KEY,planStadium} from "./stadiumPlan";
import {STADIUM_KEY,type StadiumPlan} from "./stadiumPlan";
import type {StadiumSite} from "./stadiumSite";
import {LAND_TOP} from "./scene";
import {palmBoxes} from "./palms";
import {packNormals} from "./packGeometry";

const noRaycast=()=>null;

/**
 * Atlas Stadium: five merged meshes (roof sheeting, soffits, white steel, glass, white concrete)
 * and two instanced sets (the terrace, and the grounds: the pool ring and the palms, drawn with
 * the city's plain material). All static: no lights and no frame loop. At night the glass and the
 * roof soffits glow warm, the same way the other buildings light up. Trees, beds and bollards on
 * the plaza are drawn with the city's own.
 */
/** `building={false}` draws only the lot, for the interior, where the bowl is drawn inside. */
export function Stadium({plan:a,site,g,m,pick,night=false,building=true}:{night?:boolean;building?:boolean;plan?:StadiumPlan;site?:StadiumSite;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick}) {
  const geo=useMemo(()=>a&&building?packNormals(stadiumGeometry()):undefined,[a,building]);
  useEffect(()=>()=>{if(geo)for(const v of Object.values(geo))v.dispose();},[geo]);
  const sheet=useMemo(()=>stadiumRoofTexture(),[]);
  useEffect(()=>()=>sheet.dispose(),[sheet]);
  const mats=useMemo(()=>({
    roof:focusable(new THREE.MeshStandardMaterial({color:"#ffffff",map:sheet,roughness:.42,metalness:.3,side:THREE.DoubleSide})),
    soffit:focusable(new THREE.MeshStandardMaterial({color:"#dfe2e3",roughness:.6,metalness:.1,emissive:"#ffd29a",emissiveIntensity:0,side:THREE.DoubleSide})),
    steel:focusable(new THREE.MeshStandardMaterial({color:"#f2f2ef",roughness:.38,metalness:.3})),
    glass:focusable(new THREE.MeshStandardMaterial({color:"#b4c8d3",roughness:.1,metalness:.3,emissive:"#ffcf8f",emissiveIntensity:0})),
    podium:focusable(new THREE.MeshStandardMaterial({color:"#d9d9d4",roughness:.82})),
  }),[sheet]);
  // Warm and calm at night: no real-time lights, no colour cycling (Khaneil, 2026-10-31: buildings show lights at night).
  useEffect(()=>{mats.glass.emissiveIntensity=night?.9:0;mats.soffit.emissiveIntensity=night?.45:0;},[mats,night]);
  useEffect(()=>()=>{for(const v of Object.values(mats))v.dispose();},[mats]);
  const handlers=useMemo(()=>({
    onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(STADIUM_KEY,e);},
    onPointerOut:()=>pick.out(),
    onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(STADIUM_KEY,e);},
  }),[pick]);
  const ground=useMemo(()=>[...(site?.boxes??[]).map((b):Inst=>{const h=b.h??.04;return {p:[b.x,LAND_TOP+h/2,b.z],s:[b.w,h,b.d],r:b.r,c:b.c};}),
    ...(site?.palms??[]).flatMap(([x,z],i)=>palmBoxes(x,LAND_TOP,z,i,.85))],[site]);
  if(!a)return null;
  const [cx,cz]=stadiumCentre(a);
  return <>
    <Instanced items={[{p:[cx,0,cz],s:[a.w+4,TERRACE_H,a.d+4]}]} geometry={g.box} material={m.terrace}/>
    {geo&&<group position={[cx,TERRACE_H,cz]} scale={K}>
      <mesh geometry={geo.roof} material={mats.roof} castShadow receiveShadow {...handlers}/>
      <mesh geometry={geo.soffit} material={mats.soffit} raycast={noRaycast}/>
      <mesh geometry={geo.steel} material={mats.steel} castShadow raycast={noRaycast}/>
      <mesh geometry={geo.glass} material={mats.glass} {...handlers}/>
      <mesh geometry={geo.podium} material={mats.podium} castShadow receiveShadow {...handlers}/>
    </group>}
    <Instanced items={ground} geometry={g.box} material={m.plain}/>
  </>;
}
