import {useEffect,useMemo} from "react";
import type {ThreeEvent} from "@react-three/fiber";
import * as THREE from "three";
import {TERRACE_H} from "./scene";
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from "./models";
import {focusable} from "./materials";
import {stadiumSkinTexture} from "./stadiumTextures";
import {STADIUM,STADIUM_SCALE as K,pitchLines,stadiumCentre,stadiumColumns,stadiumGeometry} from "./stadiumGeometry";
export {STADIUM_KEY,planStadium} from "./stadiumPlan";
import {STADIUM_KEY,type StadiumPlan} from "./stadiumPlan";
import type {StadiumSite} from "./stadiumSite";
import {LAND_TOP} from "./scene";

const noRaycast=()=>null;

/**
 * Atlas Stadium: six merged meshes (perforated shell skins, shell undersides, lit seams with the
 * floodlight ring, seating, concourse, glazed lobby) and four instanced sets (columns and pitch
 * lines, pitch, scoreboards, terrace). All static: no lights and no frame loop. Night lights the
 * skin's perforations, the seams, undersides, lobby glass, pitch and scoreboards, the same way the
 * other buildings light up. Trees, beds and bollards on the plaza are drawn with the city's own.
 * The grounds (pools, training pitches, car parks, plaza paving) join the plain set: no extra draws.
 */
/** `building={false}` draws only the lot, for the interior, where the bowl is drawn inside. */
export function Stadium({plan:a,site,g,m,pick,night=false,building=true}:{night?:boolean;building?:boolean;plan?:StadiumPlan;site?:StadiumSite;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick}) {
  const geo=useMemo(()=>a&&building?stadiumGeometry():undefined,[a,building]);
  useEffect(()=>()=>{if(geo)for(const v of Object.values(geo))v.dispose();},[geo]);
  const skin=useMemo(()=>stadiumSkinTexture(),[]);
  useEffect(()=>()=>{skin.map.dispose();skin.glow.dispose();},[skin]);
  const mats=useMemo(()=>({
    shell:focusable(new THREE.MeshStandardMaterial({color:"#ffffff",map:skin.map,roughness:.5,metalness:.08,emissive:"#ffffff",emissiveMap:skin.glow,emissiveIntensity:0})),
    glass:focusable(new THREE.MeshStandardMaterial({color:"#8fa9ad",roughness:.12,metalness:.45,emissive:"#ffc98a",emissiveIntensity:0})),
    under:focusable(new THREE.MeshStandardMaterial({color:"#e9e1d2",roughness:.7,emissive:"#ffc477",emissiveIntensity:0})),
    seam:focusable(new THREE.MeshStandardMaterial({color:"#c4b597",roughness:.5,emissive:"#ffcf86",emissiveIntensity:0})),
    seats:focusable(new THREE.MeshStandardMaterial({color:"#46675d",roughness:.85})),
    deck:focusable(new THREE.MeshStandardMaterial({color:"#ddd6c7",roughness:.8})),
    pitch:new THREE.MeshStandardMaterial({color:"#ffffff",emissive:"#4f9a5f",emissiveIntensity:0,roughness:.9}),
    screen:new THREE.MeshStandardMaterial({color:"#ffffff",emissive:"#9fe6cf",emissiveIntensity:0,roughness:.4}),
  }),[skin]);
  // Warm and calm at night: no real-time lights, no colour cycling (KC, 2026-10-31: buildings show lights at night).
  useEffect(()=>{
    mats.shell.emissiveIntensity=night?1.1:0;mats.glass.emissiveIntensity=night?.85:0;mats.under.emissiveIntensity=night?.7:0;mats.seam.emissiveIntensity=night?1.25:0;
    mats.pitch.emissiveIntensity=night?.75:0;mats.screen.emissiveIntensity=night?.9:0;
  },[mats,night]);
  useEffect(()=>()=>{for(const v of Object.values(mats))v.dispose();},[mats]);
  const handlers=useMemo(()=>({
    onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(STADIUM_KEY,e);},
    onPointerOut:()=>pick.out(),
    onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(STADIUM_KEY,e);},
  }),[pick]);
  const ground=useMemo(()=>(site?.boxes??[]).map((b):Inst=>{const h=b.h??.04;return {p:[b.x,LAND_TOP+h/2,b.z],s:[b.w,h,b.d],r:b.r,c:b.c};}),[site]);
  const parts=useMemo(()=>{
    if(!a)return {plain:[],pitch:[],screens:[]};
    const [cx,cz]=stadiumCentre(a),y=TERRACE_H,S=STADIUM;
    const at=(it:{p:[number,number,number];s:[number,number,number]},c:string):Inst=>({p:[cx+it.p[0]*K,y+it.p[1]*K,cz+it.p[2]*K],s:[it.s[0]*K,it.s[1]*K,it.s[2]*K],c});
    return {
      plain:[...stadiumColumns().map(c=>at(c,"#d6cfbf")),...pitchLines().map(l=>at(l,"#f3f1e6"))],
      pitch:[{p:[cx,y+.04*K,cz],s:[S.pitch.w*K,.045*K,S.pitch.d*K],c:"#356c45"}] as Inst[],
      screens:[-1,1].map(side=>({p:[cx+side*S.screens.x*K,y+S.screens.y*K,cz],s:[.08*K,S.screens.h*K,S.screens.w*K],c:"#52796a"})) as Inst[],
    };
  },[a]);
  if(!a)return null;
  const [cx,cz]=stadiumCentre(a);
  return <>
    <Instanced items={[{p:[cx,0,cz],s:[a.w+4,TERRACE_H,a.d+4]}]} geometry={g.box} material={m.terrace}/>
    {geo&&<group position={[cx,TERRACE_H,cz]} scale={K}>
      <mesh geometry={geo.shells} material={mats.shell} castShadow receiveShadow {...handlers}/>
      <mesh geometry={geo.undersides} material={mats.under} raycast={noRaycast}/>
      <mesh geometry={geo.seams} material={mats.seam} raycast={noRaycast}/>
      <mesh geometry={geo.seats} material={mats.seats} receiveShadow raycast={noRaycast}/>
      <mesh geometry={geo.deck} material={mats.deck} castShadow receiveShadow {...handlers}/>
      <mesh geometry={geo.glass} material={mats.glass} {...handlers}/>
    </group>}
    {geo&&<>
      <Instanced items={parts.pitch} geometry={g.box} material={mats.pitch}/>
      <Instanced items={parts.screens} geometry={g.box} material={mats.screen}/>
    </>}
    <Instanced items={geo?[...parts.plain,...ground]:ground} geometry={g.box} material={m.plain}/>
  </>;
}
