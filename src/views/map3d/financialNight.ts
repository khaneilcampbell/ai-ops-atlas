import * as THREE from 'three';
import type {Inst} from './models';
import {night} from './materials';

/**
 * One night palette for every Financial District tower, so the skyline reads as one place.
 * Office light is mostly warm (the same 3000K amber as Atlas HQ's windows), with some neutral
 * floors and a few cool screen-lit rooms. Brand colour lives only on the crowns and signs.
 * Everything is emissive on materials the district already draws: no real lights, no animation,
 * nothing per frame, so it costs the same at every Performance setting.
 */
export const FINANCIAL_NIGHT={
 /** Warm office light, matched to the city's window glow (materials.ts windowLights). */
 warm:'#ffd9a1',
 /** Neutral late-office light. */
 neutral:'#fff0d8',
 /** A few cool, screen-lit rooms. */
 cool:'#dfe9f2',
 /** How the lit windows split between the three: the rest are cool. */
 warmShare:.72,neutralShare:.2,
 /** Floors are busy or quiet, so towers read as lit floors rather than noise. */
 busyFloors:.62,occupancy:[.18,.94] as const,
 /** Unlit glass keeps a faint cool glow (night sky in the glass), never a muddy brown. */
 unlitGlow:'#2a3a4f',
 /** Night window glass darkens toward this share of its day colour, so lit rooms stand out. */
 glassAtNight:.3,
 /** Strength of a lit window: amber stays amber instead of washing out to white. */
 window:.88,
 /** Lobby ceilings and see-through floors (AmEx clear facade, curtain walls). */
 interior:.95,
 /** Brand accent crowns glow in their own colour. */
 crown:.75,
 /** Signs: bright enough to read across the district, under the bloom threshold. */
 sign:.6,
 /** Red aviation beacons on the tallest roofs. */
 beacon:'#ff3b2f',beaconMinHeight:11,
} as const;

/** Same as the GLSL below, so tests can check the share of lit windows. */
export function hash3(x:number,y:number,z:number){const v=Math.sin(x*12.9898+y*78.233+z*37.719)*43758.5453;return v-Math.floor(v);}
/** The window cell a seed (the pane's world centre) falls into: per floor, column and face. */
const cell=(x:number,y:number,z:number)=>[Math.round(x*4),Math.round(y*8),Math.round(z*4)] as const;
/** 0 = unlit, 1 warm, 2 neutral, 3 cool. Mirrors windowLevel() in the shader. */
export function windowKind(x:number,y:number,z:number){
 const [cx,cy,cz]=cell(x,y,z),[lo,hi]=FINANCIAL_NIGHT.occupancy;
 // Floors are shared by a whole tower: the coarse x/z cell is about one tower wide.
 const occupied=hash3(Math.floor(x/4.5),cy,Math.floor(z/4.5)+.5)<FINANCIAL_NIGHT.busyFloors?hi:lo;
 if(hash3(cx,cy,cz)>occupied)return 0;
 const t=hash3(cx+.37,cy+.71,cz+.13);
 return t<FINANCIAL_NIGHT.warmShare?1:t<FINANCIAL_NIGHT.warmShare+FINANCIAL_NIGHT.neutralShare?2:3;
}

const vec=(hex:string)=>{const c=new THREE.Color(hex);return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`;};
const f=(n:number)=>n.toFixed(4);

/**
 * Patches a window material: each pane is lit or dark by its own position, eased in with the
 * map's night value. Day colours are untouched (the patch is multiplied by night).
 */
export function financialWindows(m:THREE.MeshStandardMaterial){
 const N=FINANCIAL_NIGHT,[lo,hi]=N.occupancy;
 m.emissive.set('#ffffff');m.emissiveIntensity=1;
 m.onBeforeCompile=sh=>{
  sh.uniforms.uNight=night;
  sh.vertexShader=`varying vec3 vPane;\n${sh.vertexShader}`.replace('#include <project_vertex>',`#include <project_vertex>
   #ifdef USE_INSTANCING
    vPane=(modelMatrix*vec4(instanceMatrix[3].xyz,1.0)).xyz;
   #else
    vPane=(modelMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
   #endif`);
  sh.fragmentShader=`varying vec3 vPane;\nuniform float uNight;\nfloat paneHash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}\n${sh.fragmentShader}`
   .replace('#include <color_fragment>',`#include <color_fragment>
   diffuseColor.rgb*=mix(1.0,${f(N.glassAtNight)},uNight);`)
   .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   {
    vec3 c=vec3(floor(vPane.x*4.0+0.5),floor(vPane.y*8.0+0.5),floor(vPane.z*4.0+0.5));
    float occupied=paneHash(vec3(floor(vPane.x/4.5),c.y,floor(vPane.z/4.5)+0.5))<${f(N.busyFloors)}?${f(hi)}:${f(lo)};
    float lit=step(paneHash(c),occupied);
    float t=paneHash(c+vec3(0.37,0.71,0.13));
    vec3 tint=t<${f(N.warmShare)}?${vec(N.warm)}:(t<${f(N.warmShare+N.neutralShare)}?${vec(N.neutral)}:${vec(N.cool)});
    totalEmissiveRadiance=uNight*mix(${vec(N.unlitGlow)}*0.35,tint*${f(N.window)},lit);
   }`);
 };
 m.customProgramCacheKey=()=>'atlas-financial-windows';
 return m;
}

/** Crown accents: plain by day, glowing in their instance (brand) colour as night falls. */
export function financialCrownMaterial(){
 const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.85});
 m.onBeforeCompile=sh=>{
  sh.uniforms.uNight=night;
  sh.fragmentShader=`uniform float uNight;\n${sh.fragmentShader}`.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   #ifdef USE_COLOR
    totalEmissiveRadiance+=vColor.rgb*uNight*${f(FINANCIAL_NIGHT.crown)};
   #endif`);
 };
 m.customProgramCacheKey=()=>'atlas-financial-crown';
 return m;
}

/**
 * Splits a tower's roof-level accent pieces out of its solid parts, so they can glow.
 * Only pieces at or above the roof in the brand's accent colour count; entrance canopies stay plain.
 */
export function takeCrown(solid:Inst[],from:number,roofY:number,accent:string,crown:Inst[]){
 const keep:Inst[]=[];
 for(const p of solid.splice(from))(p.p[1]>=roofY-.01&&p.c?.toLowerCase()===accent.toLowerCase()?crown:keep).push(p);
 solid.push(...keep);
}

/** A small red beacon on the highest point of a tall tower's roof. */
export function beacon(x:number,y:number,z:number):Inst{return {p:[x,y,z],s:[.07,.07,.07],c:FINANCIAL_NIGHT.beacon};}
