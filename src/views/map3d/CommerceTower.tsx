import {useEffect,useMemo} from 'react';
import {useThree,type ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {COMMERCE,commerceFront,commerceScale,commerceTop} from './commerceTowerPlan';
import {commerceGeometry} from './commerceTowerGeometry';
import {useQualityLevel} from '../../lib/governor';
import {packNormals} from './packGeometry';

const noRaycast=()=>null;

/**
 * A soft sky for the glass to reflect (realism pass, 2026-11-24): pale blue overhead, a bright
 * haze at the horizon and the green city below, prefiltered once per renderer. Reflection only,
 * not a light, so the rest of the map's lighting is untouched.
 */
const skies=new WeakMap<THREE.WebGLRenderer,THREE.Texture>();
function skyReflection(gl:THREE.WebGLRenderer){
 const hit=skies.get(gl);if(hit)return hit;
 const scene=new THREE.Scene(),sphere=new THREE.SphereGeometry(10,32,16);
 const mat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,vertexShader:'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:'varying vec3 vP;void main(){float h=vP.y;vec3 sky=mix(vec3(.66,.74,.78),vec3(.2,.32,.46),smoothstep(.02,.7,h));vec3 ground=mix(vec3(.34,.4,.34),vec3(.12,.17,.13),smoothstep(0.,-.4,h));vec3 c=h>0.?sky:ground;c+=vec3(1.,.93,.8)*pow(max(0.,1.-abs(h)*8.),3.)*.3;gl_FragColor=vec4(c,1.);}'});
 scene.add(new THREE.Mesh(sphere,mat));
 const pm=new THREE.PMREMGenerator(gl),tex=pm.fromScene(scene,.02).texture;
 pm.dispose();sphere.dispose();mat.dispose();skies.set(gl,tex);return tex;
}

/**
 * Curtain wall with clear, properly sized windows (Khaneil, 2026-11-24: "clear size windows"):
 * one tile is 4 bays by 4 floors, each pane one bay wide and a storey tall, framed by bright
 * aluminium mullions, a slim transom and a dark slab band. The glass is a see-through teal that
 * darkens toward its foot, with a pale ceiling line inside near its head, so each pane reads as a
 * window into a floor rather than a stripe. The emissive map lights about two thirds at night.
 */
function curtainTexture(glassTop:string,glassFoot:string,frame:string,slab:string,seed:number){
 const make=(lit:boolean,share=.34)=>{
  // The night map only needs lit or dark panes, so it is drawn at half size.
  const S=lit?256:512,c=document.createElement('canvas');c.width=S;c.height=S;const g=c.getContext('2d')!;g.scale(S/512,S/512);
  let r=seed;const rnd=()=>(r=(r*16807)%2147483647)/2147483647;
  g.fillStyle=lit?'#000':slab;g.fillRect(0,0,512,512);
  for(let fy=0;fy<4;fy++)for(let bx=0;bx<4;bx++){
   // Photo pass (2026-11-25): a chunky stone grid, thick mullions and a deep spandrel, so it reads from the map.
   const x=bx*128,y=fy*128,m=12,band=24,w=128-m*2,h=128-band-m;
   if(lit){
    // A few warm windows after dark, not a lit-up tower (photo pass, 2026-11-25).
    if(rnd()<share){const warm=200+Math.floor(rnd()*45);g.fillStyle=`rgb(255,${warm},${150+Math.floor(rnd()*60)})`;g.fillRect(x+m,y+m,w,h);g.fillStyle='rgba(255,250,235,.9)';g.fillRect(x+m,y+m,w,6);}
    continue;
   }
   const grad=g.createLinearGradient(0,y+m,0,y+m+h);grad.addColorStop(0,glassTop);grad.addColorStop(1,glassFoot);g.fillStyle=grad;g.fillRect(x+m,y+m,w,h);
   // Inside: the ceiling's light line near the head of the pane, and a faint floor edge.
   g.fillStyle='rgba(235,240,232,.32)';g.fillRect(x+m,y+m+5,w,4);g.fillStyle='rgba(0,0,0,.14)';g.fillRect(x+m,y+m+h-10,w,10);
   // A soft diagonal reflection, offset a little pane to pane (faint: the district's glass is matte, not glossy).
   g.save();g.beginPath();g.rect(x+m,y+m,w,h);g.clip();g.fillStyle='rgba(255,255,255,.06)';g.beginPath();const o=(bx*23+fy*11)%40;g.moveTo(x+o,y+m+h);g.lineTo(x+o+26,y+m+h);g.lineTo(x+o+70,y+m);g.lineTo(x+o+44,y+m);g.fill();g.restore();
   // The glass sits recessed in the stone: a shadow along the head and one side, a lit edge on the sill.
   g.fillStyle='rgba(0,0,0,.38)';g.fillRect(x+m,y+m,w,7);g.fillRect(x+m,y+m,6,h);g.fillStyle=frame;g.fillRect(x+m,y+m+h-3,w,3);
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;t.flipY=false;return t;
 };
 // The crown's night map lights more of its windows (2026-11-25).
 return {map:make(false),glow:make(true),crownGlow:make(true,.6)};
}

/** The lobby wordmark: plain warm letters, no reference signage. */
function wordmark(text:string){
 const c=document.createElement('canvas');c.width=1024;c.height=192;const g=c.getContext('2d')!;
 g.fillStyle='#f4e2b8';g.textAlign='center';g.textBaseline='middle';g.font='600 118px -apple-system, "Helvetica Neue", Arial, sans-serif';
 (g as CanvasRenderingContext2D&{letterSpacing?:string}).letterSpacing='16px';g.shadowColor='rgba(0,0,0,.3)';g.shadowBlur=6;g.fillText(text,512,100,1000);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

/**
 * Commerce Pipeline as the teardrop tower. Static merged meshes and two instanced sets (olive
 * trees), no lights and no per-frame work. The lightest quality level drops the fins; night
 * lights the curtain wall cool and the gold ribbon and lobby warm.
 */
export function CommerceTower({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const k=commerceScale(t.size),quality=useQualityLevel();
 const height=commerceTop(k,t.customHeight);
 const geo=useMemo(()=>packNormals(commerceGeometry(k,height)),[k,height]);
 useEffect(()=>()=>{for(const v of Object.values(geo))if(v instanceof THREE.BufferGeometry)v.dispose();},[geo]);
 const gl=useThree(s=>s.gl);
 const mats=useMemo(()=>{
  // Sage-green glass in place of the silver-blue, like the city artwork (2026-11-17); the gold valley stays warm.
  // Realism pass (2026-11-24): the glass and metal now reflect a soft sky, so the curved blades pick up light like real curtain wall.
  const env=skyReflection(gl);
  // Business District pass (Khaneil, 2026-11-25): dark green glass in a disciplined warm-ivory grid with stone
  // spandrels, like the district's towers; the ribbon is a restrained bronze rather than bright gold.
  const silver=curtainTexture('#4f7568','#213a31','#f4ecd9','#e2d7bf',73);
  // Vertex colours carry the crown's lift (glassTint); both glass materials share one shader program.
  const glass=(tex:{map:THREE.Texture;glow:THREE.Texture},emissive:string,metal:number,shine:number,rough=.12)=>focusable(new THREE.MeshStandardMaterial({map:tex.map,emissiveMap:tex.glow,emissive,emissiveIntensity:0,roughness:rough,metalness:metal,envMap:env,envMapIntensity:shine,vertexColors:true}));
  return {
   textures:[silver.map,silver.glow,silver.crownGlow],
   glass:glass(silver,'#ffd9a0',.25,.25),
   // The crown: smoother, more reflective glass that catches the sky, with more windows lit after dark.
   crown:glass({map:silver.map,glow:silver.crownGlow},'#ffd9a0',.3,.6,.05),
   // Mullions and ledges in warm ivory stone; the ribbon's edges in bronze (same shader program as the fins).
   fin:focusable(new THREE.MeshStandardMaterial({color:'#e7dfcc',roughness:.6,metalness:.05,envMap:env,envMapIntensity:.2,side:THREE.DoubleSide})),
   // The crown's ledges and roof rim: the same stone a shade brighter, washed warm after dark (emissive only).
   crownFin:focusable(new THREE.MeshStandardMaterial({color:'#fbf6ea',roughness:.55,metalness:.05,envMap:env,envMapIntensity:.3,side:THREE.DoubleSide,emissive:'#ffe1b0',emissiveIntensity:0})),
   bronze:focusable(new THREE.MeshStandardMaterial({color:'#b07e45',roughness:.38,metalness:.6,envMap:env,envMapIntensity:.35,side:THREE.DoubleSide})),
   white:focusable(new THREE.MeshStandardMaterial({color:'#ece4d2',roughness:.7,metalness:.05})),
   rail:focusable(new THREE.MeshStandardMaterial({color:'#cfe3ec',roughness:.1,metalness:.2,transparent:true,opacity:.45,depthWrite:false})),
   canopy:focusable(new THREE.MeshStandardMaterial({color:'#efe8d8',roughness:.5,metalness:.15,emissive:'#ffe2a8',emissiveIntensity:0})),
   // The lobby's clear glass: you see the stone floor, desk and lit core through it.
   // No sky reflection, so it reuses the balcony rail's shader program (the map's budget is 80 programs).
   clear:focusable(new THREE.MeshStandardMaterial({color:'#f1e4c8',roughness:.05,metalness:.3,transparent:true,opacity:.3,depthWrite:false,emissive:'#ffd59a',emissiveIntensity:.25})),
   // Double-sided like the forecourt paving, so the two share one shader program.
   interior:focusable(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.05,emissive:'#ffd59a',emissiveIntensity:0,side:THREE.DoubleSide})),
   site:focusable(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1})),
   pool:focusable(new THREE.MeshStandardMaterial({color:'#5fb3cc',roughness:.1,metalness:.1,emissive:'#3b84a0',emissiveIntensity:0})),
  };
 },[gl]);
 useEffect(()=>{
  mats.glass.emissiveIntensity=night?.55:0;mats.clear.emissiveIntensity=night?.9:.25;
  mats.canopy.emissiveIntensity=night?.55:0;mats.interior.emissiveIntensity=night?.8:0;mats.pool.emissiveIntensity=night?.65:0;
  // The reflected sky is a daytime one: after dark it dims, so the lit windows read.
  mats.glass.envMapIntensity=night?.1:.3;mats.crown.envMapIntensity=night?.12:.6;mats.crown.emissiveIntensity=night?.75:0;mats.crownFin.emissiveIntensity=night?.35:0;mats.crownFin.envMapIntensity=night?.08:.3;mats.fin.envMapIntensity=night?.08:.2;mats.bronze.envMapIntensity=night?.1:.35;
 },[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);
 const signs=useMemo(()=>{
  const word=wordmark('COMMERCE'),badge=signTexture(t.identity,t.name);
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  // Same "Project workers" badge the other headquarters carry when agents or automations work there.
  const worker=t.agents+t.automations>0?mat(signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'),.55):null;
  return {word,wordMat:mat(word,.6),badge:mat(badge,.5),worker};
 },[t.identity,t.name,t.agents,t.automations]);
 useEffect(()=>()=>{signs.word.dispose();signs.wordMat.dispose();signs.badge.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const trunks:Inst[]=[],crowns:Inst[]=[];
  geo.trees.forEach((tr,i)=>{
   trunks.push({p:[t.x+tr.x,base+tr.y,t.z+tr.z],s:[.025*k,.13*k,.025*k],c:'#6d5a45'});
   crowns.push({p:[t.x+tr.x,base+tr.y+.18*k,t.z+tr.z],s:[.09*k,.065*k,.085*k],r:i,c:i%2?'#7f9471':'#8fa37f'});
  });
  // The roof garden on the tower's sloped top.
  geo.crownTrees.forEach((tr,i)=>{
   trunks.push({p:[t.x+tr.x,base+tr.y,t.z+tr.z],s:[.02*k,.1*k,.02*k],c:'#6d5a45'});
   crowns.push({p:[t.x+tr.x,base+tr.y+.13*k,t.z+tr.z],s:[.075*k,.06*k,.07*k],r:i+3,c:i%2?'#6f8a5c':'#86a06f'});
  });
  // Shrubs and small trees on the podium's planted ledges.
  geo.ledgeTrees.forEach((tr,i)=>{
   if(tr.big)trunks.push({p:[t.x+tr.x,base+tr.y,t.z+tr.z],s:[.018*k,.09*k,.018*k],c:'#6d5a45'});
   crowns.push({p:[t.x+tr.x,base+tr.y+(tr.big?.12:.03)*k,t.z+tr.z],s:tr.big?[.07*k,.06*k,.065*k]:[.045*k,.035*k,.045*k],r:i+11,c:i%2?'#6f8a5c':'#5f7d4e'});
  });
  // Street trees on the corner lawns round the forecourt, bigger than the roof's olives.
  geo.siteTrees.forEach((tr,i)=>{
   trunks.push({p:[t.x+tr.x,base,t.z+tr.z],s:[.03*k,.2*k,.03*k],c:'#6d5a45'});
   crowns.push({p:[t.x+tr.x,base+.27*k,t.z+tr.z],s:[.13*k,.1*k,.12*k],r:i+7,c:i%3?'#6f8a5c':'#86a06f'});
  });
  return {trunks,crowns};
 },[geo,t.x,t.z,base,k]);
 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);
 const front=commerceFront(k),signY=(COMMERCE.canopy.y+.06)*k-.02*k;
 const finsOn=quality<3;
 return <group name="commerce-tower">
  <group position={[t.x,base,t.z]}>
   <mesh geometry={geo.glass} material={mats.glass} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.crown} material={mats.crown} castShadow receiveShadow {...handlers}/>
   {/* Tower fins and the podium's ribs, one mesh. */}
   {finsOn&&<mesh geometry={geo.fins} material={mats.fin} castShadow={quality<2} raycast={noRaycast}/>}
   <mesh geometry={geo.rods} material={mats.bronze} castShadow raycast={noRaycast}/>
   {/* The roof is a garden. */}
   <mesh geometry={geo.roof} material={m.lawn} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.bands} material={mats.fin} raycast={noRaycast}/>
   <mesh geometry={geo.crownBands} material={mats.crownFin} raycast={noRaycast}/>
   <mesh geometry={geo.interior} material={mats.interior} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.lobby} material={mats.clear} {...handlers}/>
   <mesh geometry={geo.slabs} material={mats.white} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.lawn} material={m.lawn} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.pool} material={mats.pool} raycast={noRaycast}/>
   <mesh geometry={geo.site} material={mats.site} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.canopy} material={mats.canopy} castShadow receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.rail} material={mats.rail} raycast={noRaycast}/>
   {/* The wordmark sits on the canopy's front edge, with the badge and workers sign either side. */}
   <mesh geometry={g.plane} material={signs.wordMat} position={[front.x,signY,front.z]} scale={[.9*k,.9/(1024/192)*k,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.badge} position={[front.x-.5*k,.26*k,front.wall-.1*k]} scale={[.17*k,.17*k,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[front.x+.5*k,.26*k,front.wall-.1*k]} scale={[.17*k,.17*k,1]} raycast={noRaycast}/>}
  </group>
  <Instanced items={parts.trunks} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage}/>
 </group>;
}

