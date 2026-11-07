import {useEffect,useMemo} from "react";
import type {ThreeEvent} from "@react-three/fiber";
import * as THREE from "three";
import {TERRACE_H} from "./scene";
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from "./models";
import {focusable} from "./materials";
import {STADIUM,pitchLines,stadiumCentre,stadiumColumns,stadiumGeometry} from "./stadiumGeometry";
export {STADIUM_KEY,planStadium} from "./stadiumPlan";
import {STADIUM_KEY,type StadiumPlan} from "./stadiumPlan";

const noRaycast=()=>null;

/**
 * Atlas Stadium: five merged meshes (shell skins, shell undersides, lit seams, seating, concourse)
 * and four instanced sets (columns and pitch lines, pitch, scoreboards, terrace). All static: no
 * lights and no frame loop. Night raises the emissive glow on the seams, undersides, pitch and
 * scoreboards, the same way the other buildings light up.
 */
export function Stadium({plan:a,g,m,pick,night=false}:{night?:boolean;plan?:StadiumPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick}) {
  const geo=useMemo(()=>a?stadiumGeometry():undefined,[a]);
  useEffect(()=>()=>{if(geo)for(const v of Object.values(geo))v.dispose();},[geo]);
  const mats=useMemo(()=>({
    shell:focusable(new THREE.MeshStandardMaterial({color:"#f3eee4",roughness:.55,metalness:.05,emissive:"#ffd9a0",emissiveIntensity:0})),
    under:focusable(new THREE.MeshStandardMaterial({color:"#e9e1d2",roughness:.7,emissive:"#ffc477",emissiveIntensity:0})),
    seam:focusable(new THREE.MeshStandardMaterial({color:"#c4b597",roughness:.5,emissive:"#ffcf86",emissiveIntensity:0})),
    seats:focusable(new THREE.MeshStandardMaterial({color:"#46675d",roughness:.85})),
    deck:focusable(new THREE.MeshStandardMaterial({color:"#ddd6c7",roughness:.8})),
    pitch:new THREE.MeshStandardMaterial({color:"#ffffff",emissive:"#4f9a5f",emissiveIntensity:0,roughness:.9}),
    screen:new THREE.MeshStandardMaterial({color:"#ffffff",emissive:"#9fe6cf",emissiveIntensity:0,roughness:.4}),
  }),[]);
  // Warm and calm at night: no real-time lights, no colour cycling (KC, 2026-10-31: buildings show lights at night).
  useEffect(()=>{
    mats.shell.emissiveIntensity=night?.12:0;mats.under.emissiveIntensity=night?.7:0;mats.seam.emissiveIntensity=night?1.25:0;
    mats.pitch.emissiveIntensity=night?.5:0;mats.screen.emissiveIntensity=night?.9:0;
  },[mats,night]);
  useEffect(()=>()=>{for(const v of Object.values(mats))v.dispose();},[mats]);
  const handlers=useMemo(()=>({
    onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(STADIUM_KEY,e);},
    onPointerOut:()=>pick.out(),
    onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(STADIUM_KEY,e);},
  }),[pick]);
  const parts=useMemo(()=>{
    if(!a)return {plain:[],pitch:[],screens:[]};
    const [cx,cz]=stadiumCentre(a),y=TERRACE_H,S=STADIUM;
    const at=(it:{p:[number,number,number];s:[number,number,number]},c:string):Inst=>({p:[cx+it.p[0],y+it.p[1],cz+it.p[2]],s:it.s,c});
    return {
      plain:[...stadiumColumns().map(c=>at(c,"#d6cfbf")),...pitchLines().map(l=>at(l,"#f3f1e6"))],
      pitch:[{p:[cx,y+.04,cz],s:[S.pitch.w,.045,S.pitch.d],c:"#356c45"}] as Inst[],
      screens:[-1,1].map(side=>({p:[cx+side*S.screens.x,y+S.screens.y,cz],s:[.08,S.screens.h,S.screens.w],c:"#52796a"})) as Inst[],
    };
  },[a]);
  if(!a||!geo)return null;
  const [cx,cz]=stadiumCentre(a);
  return <>
    <Instanced items={[{p:[cx,0,cz],s:[a.w+4,TERRACE_H,a.d+4]}]} geometry={g.box} material={m.terrace}/>
    <group position={[cx,TERRACE_H,cz]}>
      <mesh geometry={geo.shells} material={mats.shell} castShadow receiveShadow {...handlers}/>
      <mesh geometry={geo.undersides} material={mats.under} raycast={noRaycast}/>
      <mesh geometry={geo.seams} material={mats.seam} raycast={noRaycast}/>
      <mesh geometry={geo.seats} material={mats.seats} receiveShadow raycast={noRaycast}/>
      <mesh geometry={geo.deck} material={mats.deck} castShadow receiveShadow {...handlers}/>
    </group>
    <Instanced items={parts.pitch} geometry={g.box} material={mats.pitch}/>
    <Instanced items={parts.screens} geometry={g.box} material={mats.screen}/>
    <Instanced items={parts.plain} geometry={g.box} material={m.plain}/>
  </>;
}
