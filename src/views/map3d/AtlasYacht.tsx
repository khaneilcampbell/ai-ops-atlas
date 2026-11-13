import {useEffect,useMemo,useRef} from "react";
import {useFrame,type ThreeEvent} from "@react-three/fiber";
import * as THREE from "three";
import {WATER_Y} from "./scene";
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from "./models";
import {focusable} from "./materials";
import {packNormals} from "./packGeometry";
import {yachtGeometry,MAIN_Y,hullHalf} from "./yachtGeometry";
import {YACHT,YACHT_KEY,YACHT_NAME,boardingRoute,routeAt,routeLengths,type YachtBerth} from "./yachtPlan";
import type {MarinaSite} from "./marinaPlan";
import {pedestrianAllowed} from "./doorTraffic";

const noRaycast=()=>null;
/** People walking on and off by the passerelle, and how fast (the city's strolling pace). */
export const YACHT_WALKERS=6;
const PACE=.18,PAUSE=6;
const CLOTHES=["#f4f2ec","#2f4a5a","#c96f53","#4f78a8","#e0c068","#6d9b6a"];

/** The yacht's name in dark lettering, for the transom and both bows. */
function namePlate(){
 const c=document.createElement("canvas");c.width=256;c.height=64;const x=c.getContext("2d")!;
 x.clearRect(0,0,256,64);x.fillStyle="#22272b";x.font="600 44px Georgia, 'Times New Roman', serif";x.textAlign="center";x.textBaseline="middle";
 x.fillText(YACHT_NAME.toUpperCase().split("").join(" "),128,34,240);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

/**
 * Atlas at her berth: the merged hull and superstructure, the name on the transom and bows, the
 * pontoon that carries on from the marina's cross dock with bollards, fenders and lamps, the
 * passerelle up to the aft deck, and people walking on and off. Static apart from the walkers,
 * which stop when motion is off. No agents are assigned: the people are visitors and crew figures.
 */
export function AtlasYacht({berth:b,marina,g,m,pick,night=false,moving,exclusion}:{berth:YachtBerth;marina:MarinaSite;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean;moving:boolean;exclusion?:Parameters<typeof pedestrianAllowed>[0]}){
 const geo=useMemo(()=>packNormals(yachtGeometry()),[]);
 useEffect(()=>()=>{for(const v of Object.values(geo))v.dispose();},[geo]);
 const name=useMemo(()=>namePlate(),[]);
 useEffect(()=>()=>name.dispose(),[name]);
 const mats=useMemo(()=>({
  hull:focusable(new THREE.MeshStandardMaterial({color:"#a4a9ac",roughness:.32,metalness:.35})),
  boot:focusable(new THREE.MeshStandardMaterial({color:"#2c3134",roughness:.5,metalness:.2})),
  white:focusable(new THREE.MeshStandardMaterial({color:"#f3f2ee",roughness:.35,metalness:.08})),
  glass:focusable(new THREE.MeshStandardMaterial({color:"#232e36",roughness:.06,metalness:.55,emissive:"#ffcf8f",emissiveIntensity:0})),
  teak:focusable(new THREE.MeshStandardMaterial({color:"#b98c5f",roughness:.8})),
  steel:focusable(new THREE.MeshStandardMaterial({color:"#3a4044",roughness:.4,metalness:.5})),
  name:new THREE.MeshBasicMaterial({map:name,transparent:true,depthWrite:false}),
 }),[name]);
 // Lit from inside at night, like the buildings: no real-time lights.
 useEffect(()=>{mats.glass.emissiveIntensity=night?.75:0;},[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))v.dispose();},[mats]);
 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(YACHT_KEY,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(YACHT_KEY,e);},
 }),[pick]);

 // Dock: pontoon deck, piles, bollards, lamps and fenders, plus the passerelle and its handrails.
 const dock=useMemo(()=>{
  const deck:Inst[]=[],posts:Inst[]=[],lamps:Inst[]=[],top=WATER_Y+.22,p=b.pontoon,gw=b.gangway;
  deck.push({p:[(p.x0+p.x1)/2,top-.09,p.z],s:[p.x1-p.x0,.09,p.w],c:"#b89569"});
  for(let x=p.x0+.4;x<p.x1;x+=1.1){posts.push({p:[x,WATER_Y-.45,p.z+p.w/2-.03],s:[.06,.85,.06],c:"#54493f"});}
  for(let x=b.x-YACHT.length/2+.5;x<b.x+YACHT.length/2-.6;x+=1.15)posts.push({p:[x,top,p.z-p.w/2+.05],s:[.05,.05,.05],c:"#30363a"});
  for(const x of [p.x0+1.6,b.x+.4,p.x1-.25]){posts.push({p:[x,top,p.z+p.w/2-.05],s:[.025,.3,.025],c:"#335b58"});lamps.push({p:[x,top+.3,p.z+p.w/2-.05],s:[.05,.05,.05]});}
  // Fenders along the dock side, hanging between the hull and the pontoon.
  const side=b.z+YACHT.beam/2;
  for(let x=b.x-YACHT.length/2+.6;x<b.x+.9;x+=.7)posts.push({p:[x,WATER_Y+.1,side+.035],s:[.07,.14,.07],c:"#2f4a5a"});
  // Mooring lines from the bow and stern cleats down to the pontoon bollards.
  const line=(x0:number,x1:number)=>{const y0=WATER_Y+MAIN_Y,y1=top+.02,z0=b.z+hullHalf(x0-b.x)-.02,z1=p.z-p.w/2+.05,len=Math.hypot(x1-x0,z1-z0,y1-y0);posts.push({p:[(x0+x1)/2,(y0+y1)/2-.006,(z0+z1)/2],s:[len,.012,.012],r:-Math.atan2(z1-z0,x1-x0),c:"#e8e1cf"});};
  line(b.x-YACHT.length/2+.15,b.x-YACHT.length/2-.25);line(b.x+YACHT.length/2-.9,b.x+YACHT.length/2-.4);
  // Passerelle: a teak tread on a white stringer, sloping from the pontoon to the aft deck gate.
  const run=gw.z0-gw.z1,rise=gw.y1-gw.y0,len=Math.hypot(run,rise),tilt=Math.atan2(rise,run);
  const ramp:Inst={p:[gw.x,(gw.y0+gw.y1)/2-.012,(gw.z0+gw.z1)/2],s:[.15,.022,len],rx:tilt};
  const rails:Inst[]=[-1,1].map(s=>({p:[gw.x+s*.07,(gw.y0+gw.y1)/2+.1,(gw.z0+gw.z1)/2] as [number,number,number],s:[.012,.012,len],rx:tilt,c:"#cfd3d5"}));
  const stanchions:Inst[]=[-1,1].flatMap(s=>[0,.5,1].map(t=>({p:[gw.x+s*.07,gw.y0+rise*t-.01,gw.z0-run*t] as [number,number,number],s:[.01,.11,.01],c:"#cfd3d5"})));
  return {deck,posts,lamps,ramp,rails,stanchions};
 },[b]);

 // People: they come down the marina stair, walk the dock and climb the passerelle, pause on the
 // aft deck, then walk back up to the promenade. Spaced out along the route, never two together.
 const route=useMemo(()=>boardingRoute(marina,b),[marina,b]);
 const lengths=useMemo(()=>routeLengths(route),[route]);
 const bodies=useRef<THREE.InstancedMesh>(null),heads=useRef<THREE.InstancedMesh>(null),clock=useRef(0);
 const o=useMemo(()=>new THREE.Object3D(),[]);
 useEffect(()=>{const c=new THREE.Color();for(let i=0;i<YACHT_WALKERS;i++){bodies.current?.setColorAt(i,c.set(CLOTHES[i%CLOTHES.length]));heads.current?.setColorAt(i,c.set(i%3?"#e3b994":"#9c6b4a"));}
  if(bodies.current?.instanceColor)bodies.current.instanceColor.needsUpdate=true;if(heads.current?.instanceColor)heads.current.instanceColor.needsUpdate=true;},[]);
 useFrame((_,dt)=>{
  if(moving)clock.current+=Math.min(dt,.1);
  const legT=lengths.total/PACE,cycle=legT*2+PAUSE*2;
  for(let i=0;i<YACHT_WALKERS;i++){
   const ph=((clock.current+i*cycle/YACHT_WALKERS)%cycle+cycle)%cycle;
   const out=ph<legT+PAUSE,t=ph<legT?ph/legT:ph<legT+PAUSE?1:ph<legT*2+PAUSE?1-(ph-legT-PAUSE)/legT:0;
   const {p,dir}=routeAt(route,lengths.legs,t*lengths.total),off=out?-.06:.06;
   const x=p[0]-dir[1]*off,z=p[2]+dir[0]*off,show=pedestrianAllowed(exclusion,x,z)?1:0;
   o.rotation.set(0,Math.atan2(dir[0],dir[1])+(out?0:Math.PI),0);
   o.position.set(x,p[1]+.02,z);o.scale.set(.07*show,.16*show,.06*show);o.updateMatrix();bodies.current?.setMatrixAt(i,o.matrix);
   o.position.y=p[1]+.21;o.scale.setScalar(.035*show);o.updateMatrix();heads.current?.setMatrixAt(i,o.matrix);
  }
  if(bodies.current)bodies.current.instanceMatrix.needsUpdate=true;if(heads.current)heads.current.instanceMatrix.needsUpdate=true;
 });

 const sternX=-YACHT.length/2,bowX=1.05,bowZ=hullHalf(bowX)+.006,bowY=MAIN_Y-.08;
 return <>
  <group position={[b.x,WATER_Y,b.z]} rotation={[0,b.yaw,0]}>
   <mesh geometry={geo.hull} material={mats.hull} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.boot} material={mats.boot} raycast={noRaycast}/>
   <mesh geometry={geo.white} material={mats.white} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.glass} material={mats.glass} {...handlers}/>
   <mesh geometry={geo.teak} material={mats.teak} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.steel} material={mats.steel} castShadow raycast={noRaycast}/>
   <mesh position={[sternX-.008,.36,0]} rotation={[0,-Math.PI/2,0]} material={mats.name} raycast={noRaycast}><planeGeometry args={[.5,.125]}/></mesh>
   {[-1,1].map(s=><mesh key={s} position={[bowX,bowY,s*bowZ]} rotation={[0,s>0?0:Math.PI,0]} material={mats.name} raycast={noRaycast}><planeGeometry args={[.42,.105]}/></mesh>)}
  </group>
  <Instanced items={dock.deck} geometry={g.box} material={m.plain}/>
  <Instanced items={dock.posts} geometry={g.box} material={m.plain}/>
  <Instanced items={dock.lamps} geometry={g.ball} material={m.lamp}/>
  <Instanced items={[dock.ramp]} geometry={g.box} material={mats.teak}/>
  <Instanced items={[...dock.rails,...dock.stanchions]} geometry={g.box} material={m.plain}/>
  <instancedMesh ref={bodies} args={[g.cyl,m.plain,YACHT_WALKERS]} castShadow frustumCulled={false} raycast={noRaycast}/>
  <instancedMesh ref={heads} args={[g.ball,m.plain,YACHT_WALKERS]} castShadow frustumCulled={false} raycast={noRaycast}/>
 </>;
}
