import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {INTELLIGENCE_HUB,faces,intelligenceHubHeight,planIntelligenceHub} from './intelligenceHubPlan';
import {allGeometries,intelligenceHubGeometry,windowKey} from './intelligenceHubGeometry';
import {useQualityLevel} from '../../lib/governor';

const noRaycast=()=>null;

/** White vertical fins: a soft shadow and a highlight per fin, tiled round the building in world units. */
function finTexture(){
 const c=document.createElement('canvas');c.width=32;c.height=4;const g=c.getContext('2d')!;
 const grad=g.createLinearGradient(0,0,32,0);
 grad.addColorStop(0,'#f4f3ef');grad.addColorStop(.55,'#e9e8e3');grad.addColorStop(.8,'#c9c8c2');grad.addColorStop(.9,'#fbfaf7');grad.addColorStop(1,'#f4f3ef');
 g.fillStyle=grad;g.fillRect(0,0,32,4);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/INTELLIGENCE_HUB.fin,1);t.anisotropy=4;return t;
}

/** Window glass: two or three panes with thin mullions; at night most panes glow warm. */
function paneTextures(panes:number){
 const make=(lit:boolean)=>{
  const c=document.createElement('canvas');c.width=96;c.height=96;const g=c.getContext('2d')!,w=c.width/panes;
  for(let i=0;i<panes;i++){
   if(lit){g.fillStyle=[1,0,1][i%3]?'#ffdcaa':'#2a221a';}
   else{const grad=g.createLinearGradient(0,0,c.width,c.height);grad.addColorStop(0,'#a9bac3');grad.addColorStop(.45,'#5e707b');grad.addColorStop(1,'#7d8f99');g.fillStyle=grad;}
   g.fillRect(i*w,0,w,c.height);
  }
  g.fillStyle=lit?'#000':'#1b1f22';for(let i=1;i<panes;i++)g.fillRect(i*w-1.5,0,3,c.height);g.fillRect(0,c.height*.7,c.width,2);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
 };
 return {map:make(false),glow:make(true)};
}

/** Shopfront glazing in world units: tall dark panes with slim black mullions every 0.3. */
function shopTextures(){
 const make=(lit:boolean)=>{
  const c=document.createElement('canvas');c.width=64;c.height=64;const g=c.getContext('2d')!;
  if(lit){g.fillStyle='#ffd9a3';g.fillRect(0,0,64,64);g.fillStyle='#000';}
  else{const grad=g.createLinearGradient(0,0,0,64);grad.addColorStop(0,'#3b4850');grad.addColorStop(1,'#1d262c');g.fillStyle=grad;g.fillRect(0,0,64,64);g.fillStyle='#0d1013';}
  g.fillRect(0,0,4,64);g.fillRect(0,10,64,2);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/.3,1);t.anisotropy=4;return t;
 };
 return {map:make(false),glow:make(true)};
}

function wordmark(text:string){
 const c=document.createElement('canvas');c.width=1024;c.height=128;const g=c.getContext('2d')!;
 g.fillStyle='#22262a';g.textAlign='center';g.textBaseline='middle';g.font='500 76px "Helvetica Neue", Arial, sans-serif';
 g.fillText(text.toUpperCase().split('').join(String.fromCharCode(8202)),512,68,1000);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

/**
 * The Intelligence Hub as a ribbed white corner building (see intelligenceHubPlan). Eight merged
 * meshes plus instanced planting, no lights. Lighter quality levels drop the planting's shadows,
 * then the tree trunks.
 */
export function IntelligenceHub({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const quality=useQualityLevel();
 const height=t.customHeight??intelligenceHubHeight(t.height);
 const plan=useMemo(()=>planIntelligenceHub(t.size,height),[t.size,height]);
 const geo=useMemo(()=>intelligenceHubGeometry(plan),[plan]);
 useEffect(()=>()=>{for(const v of allGeometries(geo))v.dispose();},[geo]);
 const mats=useMemo(()=>{
  const fins=finTexture(),panes=paneTextures(3),shop=shopTextures();
  return {
   textures:[fins,panes.map,panes.glow,shop.map,shop.glow],
   cladding:focusable(new THREE.MeshStandardMaterial({map:fins,roughness:.7,metalness:0})),
   bands:focusable(new THREE.MeshStandardMaterial({color:'#17191b',roughness:.45,metalness:.3,emissive:'#ffc77a',emissiveIntensity:0})),
   stone:focusable(new THREE.MeshStandardMaterial({color:'#d9d8d3',roughness:.8,metalness:0})),
   shopfront:focusable(new THREE.MeshStandardMaterial({map:shop.map,emissiveMap:shop.glow,emissive:'#ffffff',emissiveIntensity:0,roughness:.12,metalness:.45})),
   frames:focusable(new THREE.MeshStandardMaterial({color:'#141618',roughness:.4,metalness:.4})),
   glass:focusable(new THREE.MeshStandardMaterial({map:panes.map,emissiveMap:panes.glow,emissive:'#ffffff',emissiveIntensity:0,roughness:.1,metalness:.45})),
   recess:focusable(new THREE.MeshStandardMaterial({color:'#55514b',roughness:.8,emissive:'#ffcf96',emissiveIntensity:0})),
  };
 },[]);
 useEffect(()=>{
  mats.bands.emissiveIntensity=night?.55:0;mats.shopfront.emissiveIntensity=night?.8:0;mats.glass.emissiveIntensity=night?.85:0;mats.recess.emissiveIntensity=night?.35:0;
 },[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);
 const signs=useMemo(()=>{
  const word=wordmark(t.name),badge=signTexture(t.identity,t.name);
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  const worker=t.agents+t.automations>0?signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'):null;
  return {textures:[word,badge,worker].filter((x):x is THREE.CanvasTexture=>!!x),word:mat(word,.15),badge:mat(badge,.55),worker:worker?mat(worker,.55):null};
 },[t.identity,t.name,t.agents,t.automations]);
 useEffect(()=>()=>{for(const x of signs.textures)x.dispose();signs.word.dispose();signs.badge.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const trunks:Inst[]=[],crowns:Inst[]=[],trailing:Inst[]=[],shrubs:Inst[]=[];
  const w=(x:number,y:number,z:number):[number,number,number]=>[t.x+x,base+y,t.z+z];
  const greens=['#5f8f4a','#6f9c50','#557f43','#7aa35a'];
  const k=plan.k,I=INTELLIGENCE_HUB,B=I.bay;
  // The parts that repeat every floor, as instances of one shared geometry each.
  const one:[number,number,number]=[1,1,1];
  const bandsFull:Inst[]=[],bandsFront:Inst[]=[],bayRings:Inst[]=[],recess:Inst[]=[],planters:Inst[]=[],glass:Inst[]=[];
  const rings:Record<string,Inst[]>={};
  for(let i=1;i<=plan.storeys;i++)(i<=plan.storeys-I.rear.drop?bandsFull:bandsFront).push({p:w(0,plan.lines[i],0),s:one});
  // Out along a face's normal (angle) by d.
  const off=(x:number,z:number,angle:number,d:number):[number,number]=>[x+Math.sin(angle)*d,z+Math.cos(angle)*d];
  const bt=B.frame*k*.6,bd=B.depth*k;
  for(const b of plan.bays){
   const bh=b.y1-b.y0,my=(b.y0+b.y1)/2,[rx,rz]=off(b.x,b.z,b.angle,.004),[px,pz]=off(b.x,b.z,b.angle,bd*.45);
   bayRings.push({p:w(b.x,my,b.z),s:one,r:b.angle});
   recess.push({p:w(rx,my,rz),s:[b.w-bt*1.5,bh-bt*1.5,1],r:b.angle});
   planters.push({p:w(px,b.y0+bt,pz),s:[b.w-bt*2.4,.06,bd*.55],r:b.angle});
  }
  const W=I.windows;
  for(const win of plan.windows){
   const wh=win.y1-win.y0,my=(win.y0+win.y1)/2,[fx,fz]=off(win.x,win.z,win.angle,W.depth),[gx,gz]=off(win.x,win.z,win.angle,.003);
   (rings[windowKey(win)]??=[]).push({p:w(fx,my,fz),s:one,r:win.angle});
   glass.push({p:w(gx,my,gz),s:[win.w-W.frame*1.6,wh-W.frame*1.6,1],r:win.angle});
  }
  // Each loggia's planter: a row of shrubs on top and greenery trailing over the front.
  for(const [i,b] of plan.bays.entries()){
   const sin=Math.sin(b.angle),cos=Math.cos(b.angle),bt=B.frame*k*.6,depth=B.depth*k*.45,top=b.y0+bt+.07;
   const n=7;
   for(let j=0;j<n;j++){
    const u=(j/(n-1)-.5)*(b.w-bt*3);
    const at=(d:number):[number,number]=>[b.x+u*cos+d*sin,b.z-u*sin+d*cos];
    const [sx,sz]=at(depth),[fx,fz]=at(B.depth*k*.74);
    shrubs.push({p:w(sx,top+.01,sz),s:[.065,.05,.06],r:j,c:greens[(i+j)%4]});
    if(j%2===0||quality<2)trailing.push({p:w(fx,top-.07,fz),s:[.06,.1,.03],c:greens[(i+j+1)%4]});
   }
  }
  // The main roof: trees in the garden behind the parapet.
  const roof=plan.roof+.03;
  for(const [i,[fx,fz]] of [[-.3,-.05],[.05,.2],[-.1,.32],[.28,.02]].entries()){
   const x=fx*k,z=fz*k;trunks.push({p:w(x,roof,z),s:[.018,.18,.018],c:'#6b5a48'});
   crowns.push({p:w(x,roof+.25,z),s:[.11,.14,.11],c:greens[i%4]});
  }
  // The rear wing's planted roof: trees, and greenery hanging over its parapet.
  const rear=plan.lines[plan.storeys-INTELLIGENCE_HUB.rear.drop]+.07;
  for(const [i,[fx,fz]] of [[-.32,-.35],[0,-.4],[.3,-.33],[-.15,-.22],[.2,-.2]].entries()){
   const x=fx*k,z=fz*k,tall=i<3?.2:.14;trunks.push({p:w(x,rear,z),s:[.018,tall,.018],c:'#6b5a48'});
   crowns.push({p:w(x,rear+tall+.07,z),s:[.1,.13,.1],c:greens[(i+2)%4]});
  }
  for(let x=-.45;x<=.45;x+=.15){shrubs.push({p:w(x*k,plan.rearTop+.02,-.49*k),s:[.05,.04,.05],c:greens[Math.round(x*10+5)%4]});trailing.push({p:w(x*k,plan.rearTop-.05,-.52*k),s:[.04,.08,.025],c:greens[Math.round(x*10+6)%4]});}
  for(const z of [-.42,-.28]){shrubs.push({p:w(.49*k,plan.rearTop+.02,z*k),s:[.05,.04,.05],c:greens[1]});trailing.push({p:w(.52*k,plan.rearTop-.05,z*k),s:[.025,.08,.04],c:greens[2]});}
  // Street planting: low hedges along the shopfronts on the two faces the map looks at.
  const hedge=faces(plan.outline);
  for(const f of [hedge[1],hedge[3]])for(let s=.12;s<.9;s+=.13){
   const x=f.a[0]+(f.b[0]-f.a[0])*s+f.n[0]*.04*k,z=f.a[1]+(f.b[1]-f.a[1])*s+f.n[1]*.04*k;
   shrubs.push({p:w(x,.04,z),s:[.05,.035,.05],c:greens[Math.round(s*20)%4]});
  }
  return {trunks,crowns,trailing,shrubs,bandsFull,bandsFront,bayRings,recess,planters,glass,rings};
 },[plan,t.x,t.z,base,quality]);
 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);
 const detailShadow=quality<2;
 // Every instance of every repeated part picks the building.
 const every=useMemo(()=>({...pick,keys:new Array(plan.windows.length+plan.storeys+8).fill(t.key)}),[pick,t.key,plan]);
 const k=plan.k,I=INTELLIGENCE_HUB,soffitY=plan.ground-I.soffit.h/2,front=.5*k+I.soffit.out*k+.003,side=front,badge=.13*k;
 return <group>
  <group name="intelligence-hub" position={[t.x,base,t.z]}>
   <mesh geometry={geo.cladding} material={mats.cladding} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.stone} material={mats.stone} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.trim} material={mats.bands} receiveShadow {...handlers}/>
   <mesh geometry={geo.shopfront} material={mats.shopfront} receiveShadow {...handlers}/>
   <mesh geometry={geo.garden} material={m.lawn} receiveShadow raycast={noRaycast}/>
   {/* The name in thin capitals along the soffit on the front, the badge and workers sign on the side. */}
   <mesh geometry={g.plane} material={signs.word} position={[-.12*k,soffitY,front]} scale={[.62*k,.062*k,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.badge} position={[side,soffitY,-.05*k]} rotation={[0,Math.PI/2,0]} scale={[badge*.75,badge*.75,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[side,soffitY,-.25*k]} rotation={[0,Math.PI/2,0]} scale={[badge*.6,badge*.6,1]} raycast={noRaycast}/>}
  </group>
  <Instanced items={parts.bandsFull} geometry={geo.bandFull} material={mats.bands} pick={every} shadow={false}/>
  <Instanced items={parts.bandsFront} geometry={geo.bandFront} material={mats.bands} pick={every} shadow={false}/>
  <Instanced items={parts.bayRings} geometry={geo.bayRing} material={mats.stone} pick={every} shadow={detailShadow}/>
  <Instanced items={parts.recess} geometry={g.plane} material={mats.recess} pick={every} shadow={false}/>
  <Instanced items={parts.planters} geometry={g.box} material={mats.stone} pick={every} shadow={false}/>
  <Instanced items={parts.glass} geometry={g.plane} material={mats.glass} pick={every} shadow={false}/>
  {Object.entries(parts.rings).map(([key,items])=><Instanced key={key} items={items} geometry={geo.windowRings[key]} material={mats.frames} pick={every} shadow={false}/>)}
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage} shadow={detailShadow}/>
  <Instanced items={parts.shrubs} geometry={g.rock} material={m.foliage} shadow={false}/>
  <Instanced items={parts.trailing} geometry={g.box} material={m.foliage} shadow={false}/>
  {quality<3&&<Instanced items={parts.trunks} geometry={g.trunk} material={m.plain} shadow={false}/>}
 </group>;
}
