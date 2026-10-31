import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import * as THREE from 'three';
import {Canvas,useThree} from '@react-three/fiber';
import {Html,OrbitControls} from '@react-three/drei';
import type {OrbitControls as OrbitControlsImpl} from 'three-stdlib';
import {usePowerProfile} from '../../lib/power';
import {FramePacer} from '../map3d/pacer';
import {type LightMode} from '../map3d/living';
import {night as cityNight} from '../map3d/materials';
import {mallFloor} from '../map3d/mallPlan';
import {ribbon} from '../map3d/mallShapes';
import type {Pt} from '../map3d/roads';
import {Box,Person} from './InteriorPrimitives';
import {leaveBuilding} from './store';
import {MALL_IN,MALL_LEVELS,MALL_SHAPE,mallUnits,type MallUnit,type UnitKind} from './mallInteriorPlan';
import '../../styles/skyline.css';

const FH=MALL_IN.floor;
const ALL=99,PARKING=-1;
const ACCENT:Record<UnitKind,string>={shop:'#c9a35a',vacant:'#a9b4a0',food:'#b8735a',hall:'#294237',studio:'#4f7a52',service:'#d0ad69'};

/** A box laid along the segment a→b, its base at y. */
function Seg({a,b,y,h,t,color,opacity=1}:{a:Pt;b:Pt;y:number;h:number;t:number;color:string;opacity?:number}){
 const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
 return <mesh position={[(a[0]+b[0])/2,y+h/2,(a[1]+b[1])/2]} rotation={[0,-Math.atan2(b[1]-a[1],b[0]-a[0]),0]} castShadow={opacity===1} receiveShadow>
  <boxGeometry args={[len+.02,h,t]}/><meshStandardMaterial color={color} transparent={opacity<1} opacity={opacity} depthWrite={opacity===1} roughness={.6}/></mesh>;
}
const mid=(pts:Pt[]):Pt=>{const p=pts[Math.floor(pts.length/2)];return p;};
const centre=(u:MallUnit):Pt=>{const f=mid(u.front),b=mid(u.back);return [(f[0]+b[0])/2,(f[1]+b[1])/2];};

/** What stands inside one unit. Plain boxes, so a floor stays a few hundred meshes. */
function Fitout({u,y}:{u:MallUnit;y:number}){
 const [x,z]=centre(u),f=mid(u.front),ang=Math.atan2(f[1]-z,f[0]-x);
 const along=(d:number,side:number):[number,number]=>[x+Math.cos(ang)*d-Math.sin(ang)*side,z+Math.sin(ang)*d+Math.cos(ang)*side];
 if(u.kind==='food')return <group>{[-1.1,1.1].flatMap(s=>[-.6,.9].map(d=>{const [px,pz]=along(d,s);return <group key={`${s}${d}`}>
  <mesh position={[px,y+.72,pz]} castShadow><cylinderGeometry args={[.42,.42,.06,16]}/><meshStandardMaterial color="#f3eadb"/></mesh>
  <Box p={[px,y+.36,pz]} s={[.08,.72,.08]} color="#294237"/>
  {[-1,1].map(k=><Box key={k} p={[px+k*.55,y+.25,pz]} s={[.32,.5,.32]} color="#b8735a"/>)}</group>;}))}</group>;
 if(u.kind==='hall'){const [sx,sz]=along(-.5,0);return <group><Box p={[sx,y+.15,sz]} s={[2,.3,.9]} color="#4f7a52"/>
  {[0,1,2].flatMap(r=>[-1,0,1].map(c=>{const [px,pz]=along(.2+r*.6,c*.7);return <Box key={`${r}${c}`} p={[px,y,pz]} s={[.45,.42,.4]} color="#c9a35a"/>;}))}</group>;}
 if(u.kind==='service'){return <group><mesh position={[x,y+.5,z]} castShadow><cylinderGeometry args={[1.1,1.1,1,24]}/><meshStandardMaterial color="#f3eadb"/></mesh><Box p={[x,y+1,z]} s={[2.3,.06,.5]} color="#c9a35a"/><Person x={x} z={z-.2} color="#344c41"/></group>;}
 if(u.kind==='vacant'){const [px,pz]=along(.8,0);return <group><Box p={[px,y,pz]} s={[.06,1.1,.06]} color="#294237"/><Box p={[px,y+1.1,pz]} s={[.7,.45,.05]} color="#f7f7f0"/></group>;}
 // Shop or studio: counter at the front, display wall at the back, one figure.
 const [cx,cz]=along(.9,0),[bx,bz]=along(-1.4,0);
 return <group><Box p={[cx,y,cz]} s={[1.6,.95,.55]} color={ACCENT[u.kind]}/><Box p={[cx,y+.95,cz]} s={[1.7,.06,.65]} color="#f3eadb"/>
  <Box p={[bx,y,bz]} s={[2,1.9,.3]} color={u.kind==="shop"?"#4f7a52":"#a9b4a0"}/><Person x={cx+.2} z={cz} color={u.kind==='shop'?'#806c9e':'#5a8067'}/></group>;
}

function Floor({level,y,labels,onPick,cutaway}:{level:number;y:number;labels:boolean;onPick:(u:MallUnit)=>void;cutaway:boolean}){
 const {outer,inner}=useMemo(()=>mallFloor(MALL_SHAPE,level),[level]);
 const slab=useMemo(()=>ribbon(outer,inner,y-.25,.25),[outer,inner,y]);
 useEffect(()=>()=>slab.dispose(),[slab]);
 const units=useMemo(()=>mallUnits().filter(u=>u.level===level),[level]);
 // One label per name: the food court and demo hall span several bays.
 const labelled=useMemo(()=>{const by=new Map<string,MallUnit[]>();for(const u of units)by.set(u.name,[...(by.get(u.name)??[]),u]);
  return new Set([...by.values()].map(g=>g[Math.floor((g.length-1)/2)].id));},[units]);
 return <group>
  <mesh geometry={slab} receiveShadow castShadow><meshStandardMaterial color={level===2?'#efe6d2':'#e7dfcf'} roughness={.8}/></mesh>
  {/* Glass balustrade round the atrium. */}
  {inner.slice(1).map((b,i)=><group key={i}><Seg a={inner[i]} b={b} y={y} h={.95} t={.04} color="#cfe3e0" opacity={.35}/><Seg a={inner[i]} b={b} y={y+.95} h={.05} t={.08} color="#c9a35a"/></group>)}
  {units.map(u=>{
   // Walls nearest the camera stay low, like the other cutaways, so the shops read from outside.
   const near=centre(u)[1]>2&&cutaway,wall=near?.9:2.9;
   return <group key={u.id}>
    {u.back.slice(1).map((b,i)=><Seg key={i} a={u.back[i]} b={b} y={y} h={wall} t={.12} color="#f7f7f0"/>)}
    {[0,u.front.length-1].map(i=><Seg key={i} a={u.front[i]} b={u.back[i]} y={y} h={wall} t={.1} color="#dcd3bd"/>)}
    {u.kind!=='food'&&u.kind!=='hall'&&u.front.slice(1).map((b,i)=><group key={`f${i}`}><Seg a={u.front[i]} b={b} y={y} h={2.6} t={.03} color="#d4e9e6" opacity={.22}/><Seg a={u.front[i]} b={b} y={y+2.6} h={.35} t={.12} color={ACCENT[u.kind]}/></group>)}
    <Fitout u={u} y={y}/>
    {labels&&labelled.has(u.id)&&<Html position={[mid(u.front)[0],y+3.3,mid(u.front)[1]]} center><button className="skyline-room-label" onClick={()=>onPick(u)}>{u.name}<span>{u.kind==='shop'?'Planned · not selling yet':u.kind==='vacant'?'Vacant':u.kind==='food'?'Food court':u.kind==='hall'?'Demo hall':u.kind==='service'?'Information':'Studio'}</span></button></Html>}
   </group>;
  })}
 </group>;
}

/** The funnel "tree" over the atrium: a white lattice stem flaring into a translucent canopy. */
function Atrium({top,night,escalators}:{top:number;night:boolean;escalators:number[]}){
 const geo=useMemo(()=>new THREE.LatheGeometry(Array.from({length:16},(_,i)=>{const t=i/15;return new THREE.Vector2(.35+3.9*t**2.3,t*top);}),28),[top]);
 useEffect(()=>()=>geo.dispose(),[geo]);
 return <group>
  <mesh geometry={geo}><meshStandardMaterial color="#f3f1ea" transparent opacity={.55} side={THREE.DoubleSide} depthWrite={false}/></mesh>
  <mesh geometry={geo}><meshBasicMaterial color="#b9c3b0" wireframe/></mesh>
  <mesh position={[0,top,0]}><cylinderGeometry args={[4.5,4.5,.08,40]}/><meshStandardMaterial color="#dce2d5" transparent opacity={.6} emissive="#d0ad69" emissiveIntensity={night?.8:0} depthWrite={false}/></mesh>
  {/* Escalators cross the void between floors, alternating direction like the section drawing. */}
  {escalators.map(l=>{const dir=l%2?1:-1,run=5.6,rise=FH;return <group key={l} position={[dir*1.2,l*FH,1.6]} rotation={[0,dir*.35,0]}>
   <mesh position={[0,rise/2,0]} rotation={[0,0,dir*Math.atan2(rise,run)]} castShadow><boxGeometry args={[Math.hypot(run,rise),.18,1]}/><meshStandardMaterial color="#c2cbb9"/></mesh>
   {[-.52,.52].map(s=><mesh key={s} position={[0,rise/2+.5,s]} rotation={[0,0,dir*Math.atan2(rise,run)]}><boxGeometry args={[Math.hypot(run,rise),.9,.04]}/><meshStandardMaterial color="#cfe3e0" transparent opacity={.35} depthWrite={false}/></mesh>)}
  </group>;})}
 </group>;
}

/** The white fin skin on the far half, so the cutaway still reads as the mall from the map. */
function Fins({levels,stacked}:{levels:number[];stacked:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null);
 const items=useMemo(()=>levels.flatMap(level=>{const {outer}=mallFloor(MALL_SHAPE,level),y=stacked?level*FH:0;
  return outer.slice(1).flatMap((b,i)=>{const a=outer[i];if((a[1]+b[1])/2>1.5)return [];return Array.from({length:4},(_,k)=>{const t=k/4,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,h=FH*(.65+.3*Math.sin(i*.9+k*.4+level*1.7));return {x,z,y:y+FH-h,h,r:-Math.atan2(b[1]-a[1],b[0]-a[0])};});});}),[levels,stacked]);
 useLayoutEffect(()=>{const m=ref.current;if(!m)return;const o=new THREE.Object3D();items.forEach((f,i)=>{o.position.set(f.x,f.y+f.h/2,f.z);o.rotation.set(0,f.r,0);o.scale.set(.06,f.h,.3);o.updateMatrix();m.setMatrixAt(i,o.matrix);});m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();},[items]);
 return <instancedMesh key={items.length} ref={ref} args={[undefined,undefined,items.length]} castShadow><boxGeometry/><meshStandardMaterial color="#f7f7f0" roughness={.5}/></instancedMesh>;
}

function Parking({y}:{y:number}){
 return <group><Box p={[0,y-.25,-1]} s={[20,.25,16]} color="#9aa39a"/>
  {[-6,-2,2,6].flatMap(x=>[-6,-3.5,2.5].map(z=><Box key={`${x}${z}`} p={[x,y,z]} s={[1.6,.7,.9]} color={['#2163ad','#e7e9e6','#a5abb0','#202b35'][(x+z+20)%4|0]}/>))}
  {[-8,8].map(x=><Box key={x} p={[x,y,-1]} s={[.4,FH,.4]} color="#c2cbb9"/>)}</group>;
}

function MallCamera({mode}:{mode:number}){
 const controls=useRef<OrbitControlsImpl>(null);const {camera,invalidate,size}=useThree();
 // Phones are tall and narrow: stand further back so the whole ring fits across.
 const far=size.width<size.height?1.7:1;
 useLayoutEffect(()=>{
  const all=mode===ALL;camera.position.set(...((all?[26,24,30]:[16,18,22]).map(v=>v*far)) as [number,number,number]);
  const t=controls.current?.target;if(t){t.set(0,all?5:0,-1);camera.lookAt(t);controls.current?.update();}invalidate();
 },[mode,camera,invalidate,far]);
 return <OrbitControls ref={controls} makeDefault minDistance={8} maxDistance={70} maxPolarAngle={Math.PI/2.2}/>;
}

/** Atlas Marketplace inside: the shop ring of each floor round the funnel-tree atrium. */
export default function MallInterior({light}:{light:LightMode}){
 const [mode,setMode]=useState(ALL);
 const [picked,setPicked]=useState<MallUnit|null>(null);
 const power=usePowerProfile();const isNight=light==='night';
 useEffect(()=>{cityNight.value=isNight?1:0;},[isNight]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 const levels=mode===ALL?[0,1,2,3]:mode===PARKING?[]:[mode];
 const info=MALL_LEVELS.find(l=>l.level===mode);
 const title=mode===ALL?'All floors · Open cutaway':mode===PARKING?'Basement · Car park':info!.title;
 return <section className={`skyline-interior mall-interior ${isNight?"night":"day"}`} aria-label="Atlas Marketplace interior">
  <Canvas style={{position:'absolute',inset:0,zIndex:0}} frameloop="demand" dpr={[1,power.maxDpr]} shadows camera={{position:[26,24,30],fov:42}}>
   <FramePacer profile={power} running={false}/>
   <color attach="background" args={[isNight?'#101b2c':'#dbe2d8']}/>
   <hemisphereLight args={[isNight?'#91abd0':'#f4f7ee',isNight?'#1a2a22':'#8a9a82',isNight?.55:1.2]}/>
   <directionalLight position={[-14,30,18]} intensity={isNight?.5:1.6} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20}/>
   <MallCamera mode={mode}/>
   {(mode===ALL||mode===PARKING)&&<Parking y={mode===ALL?-FH:0}/>}
   {levels.map(l=><group key={l} position={[0,mode===ALL?l*FH:0,0]}><Floor level={l} y={0} labels={mode!==ALL} onPick={setPicked} cutaway/></group>)}
   {mode!==PARKING&&<group><Atrium top={(mode===ALL?MALL_IN.levels:1)*FH+.6} night={isNight} escalators={mode===ALL?[0,1,2]:mode<MALL_IN.levels-1?[0]:[]}/><Fins levels={levels} stacked={mode===ALL}/></group>}
   {mode===ALL&&<group>
    {/* Courtyard paving inside the horseshoe, so the car park below stays below. */}
    <mesh position={[0,-.27,0]} scale={[6.4,1,5.4]} receiveShadow><cylinderGeometry args={[1,1,.04,40]}/><meshStandardMaterial color="#e6d6b4" roughness={.9}/></mesh>
    <Box p={[0,-.29,6]} s={[10,.04,8]} color="#e6d6b4"/>
   </group>}
   {(mode===ALL||mode===0)&&<group>
    {/* Plaza and fountain outside the open end of the horseshoe. */}
    <Box p={[0,-.27,9.6]} s={[12,.04,4]} color="#dcd3bd"/>
    <mesh position={[0,0,10]} castShadow><cylinderGeometry args={[1.3,1.4,.4,32]}/><meshStandardMaterial color="#f7f7f0"/></mesh>
    <mesh position={[0,.21,10]}><cylinderGeometry args={[1.1,1.1,.02,32]}/><meshStandardMaterial color="#5aaac0" emissive="#3d7f99" emissiveIntensity={isNight?.8:0}/></mesh>
   </group>}
  </Canvas>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label="Exit Atlas Marketplace and return to city">← Exit building</button><div><small>ATLAS MARKETPLACE · CLIENT SERVICES</small><h2>{title}</h2></div></header>
  <nav className="skyline-floor-picker" aria-label="Choose Atlas Marketplace floor"><strong>Floor navigation</strong>
   {[ALL,3,2,1,0,PARKING].map(n=><button key={n} aria-pressed={mode===n} onClick={()=>{setMode(n);setPicked(null);}}>{n===ALL?'All floors':n===PARKING?'Car park':n===0?'Ground':`Floor ${n}`}</button>)}</nav>
  <aside className="skyline-interior-note">{picked?<>{picked.name}<span>{picked.note}</span></>:mode===ALL?<>Four floors round a funnel-tree atrium · Drag to orbit · Scroll to zoom<span>Shops are planned services; none are selling yet.</span></>:mode===PARKING?<>Basement car park<span>Ramp from the boulevard side.</span></>:<>{info!.summary}<span>Select a unit to see what it is.</span></>}</aside>
 </section>;
}
