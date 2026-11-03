import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import * as THREE from 'three';
import {Canvas,useThree} from '@react-three/fiber';
import {Html,OrbitControls} from '@react-three/drei';
import type {OrbitControls as OrbitControlsImpl} from 'three-stdlib';
import {usePageVisible,usePowerProfile,wake} from '../../lib/power';
import {FramePacer} from '../map3d/pacer';
import {type LightMode} from '../map3d/living';
import {night as cityNight} from '../map3d/materials';
import {ribbon} from '../map3d/mallShapes';
import type {Pt} from '../map3d/roads';
import {Box,Person} from './InteriorPrimitives';
import CityOutside from './CityOutside';
import {lookHint,useInteriorTrackpad} from './useInteriorTrackpad';
import {useAtlas} from '../../state';
import {AgentOutput} from '../../components/AgentOutput';
import {marketplaceWorkspace} from './marketplaceWorkspaces';
import {leaveBuilding} from './store';
import {ESCALATOR,MALL_LIFT,MALL_IN,MALL_LEVELS,MALL_SHAPE,escalatorFor,mallInteriorFloor,mallDoorway,mallUnits,mallLandings,mallLiftEnd,mallFurniture,type MallUnit,type UnitKind} from './mallInteriorPlan';
import '../../styles/skyline.css';

const FH=MALL_IN.floor;
const ALL=99;
const ACCENT:Record<UnitKind,string>={shop:'#c9a35a',vacant:'#a9b4a0',food:'#b8735a',hall:'#294237',studio:'#4f7a52',service:'#d0ad69'};

/** A box laid along the segment a→b, its base at y. */
function Seg({a,b,y,h,t,color,opacity=1}:{a:Pt;b:Pt;y:number;h:number;t:number;color:string;opacity?:number}){
 const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
 return <mesh position={[(a[0]+b[0])/2,y+h/2,(a[1]+b[1])/2]} rotation={[0,-Math.atan2(b[1]-a[1],b[0]-a[0]),0]} castShadow={opacity===1} receiveShadow>
  <boxGeometry args={[len+.02,h,t]}/><meshStandardMaterial color={color} transparent={opacity<1} opacity={opacity} depthWrite={opacity===1} roughness={.6}/></mesh>;
}
/**
 * Floor finishes as tiny canvas textures (one per finish, shared by every floor). The ribbon's UVs are
 * in metres, so repeat sets the tile size: stone in the corridors, planks in the shops, terrazzo in
 * the food court and carpet in the demo hall.
 */
type Finish='stone'|'wood'|'terrazzo'|'carpet';
const FINISH:Record<Finish,{base:string;line:string;tile:number;planks?:boolean;speckle?:string}>={
 stone:{base:'#ece5d6',line:'#d6cbb4',tile:1.2},
 wood:{base:'#c9a77a',line:'#a9865a',tile:1.6,planks:true},
 terrazzo:{base:'#efe9df',line:'#e2d8c8',tile:.9,speckle:'#b8735a'},
 carpet:{base:'#3d5a4a',line:'#36503f',tile:2},
};
const finishes=new Map<Finish,THREE.MeshStandardMaterial>();
function finish(f:Finish){
 let m=finishes.get(f);if(m)return m;
 const d=FINISH[f],c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d')!;
 x.fillStyle=d.base;x.fillRect(0,0,128,128);x.strokeStyle=d.line;x.lineWidth=3;
 if(d.planks){for(let i=0;i<4;i++){x.strokeRect(0,i*32,128,32);x.beginPath();x.moveTo((i%2)*64+32,i*32);x.lineTo((i%2)*64+32,i*32+32);x.stroke();}}
 else x.strokeRect(0,0,128,128);
 if(d.speckle){x.fillStyle=d.speckle;for(let i=0;i<60;i++)x.fillRect((i*53)%125,(i*97)%125,3,3);}
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/d.tile,1/d.tile);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
 m=new THREE.MeshStandardMaterial({map:t,roughness:f==='stone'||f==='terrazzo'?.45:.8});finishes.set(f,m);return m;
}
const FLOOR_OF:Record<UnitKind,Finish>={shop:'wood',vacant:'stone',food:'terrazzo',hall:'carpet',studio:'wood',service:'stone'};

/** Glazed double doors in the middle bay of a shop front: bronze frame, two leaves, pull handles. */
function Doors({a,b,y,accent}:{a:Pt;b:Pt;y:number;accent:string}){
 const len=Math.hypot(b[0]-a[0],b[1]-a[1]),ang=-Math.atan2(b[1]-a[1],b[0]-a[0]),w=Math.min(1.8,len*.8),H=2.3;
 return <group position={[(a[0]+b[0])/2,y,(a[1]+b[1])/2]} rotation={[0,ang,0]}>
  {[-1,1].map(k=><mesh key={k} position={[k*w/2,H/2,0]}><boxGeometry args={[.08,H,.12]}/><meshStandardMaterial color="#5b4a33"/></mesh>)}
  <mesh position={[0,H+.04,0]}><boxGeometry args={[w+.08,.08,.12]}/><meshStandardMaterial color="#5b4a33"/></mesh>
  {[-1,1].map(k=><group key={`l${k}`} position={[k*w/2,0,0]} rotation={[0,k*Math.PI/2,0]}>
   <mesh position={[-k*w/4,H/2,0]}><boxGeometry args={[w/2-.06,H-.06,.03]}/><meshStandardMaterial color="#cfe6e2" transparent opacity={.4} depthWrite={false}/></mesh>
   <mesh position={[-k*(w/2-.12),1.05,.06]}><boxGeometry args={[.04,.55,.04]}/><meshStandardMaterial color={accent} metalness={.6} roughness={.3}/></mesh>
  </group>)}
  {/* Entrance mat, so the door reads from above too. */}
  <mesh position={[0,.012,.55]} receiveShadow><boxGeometry args={[w,.02,.6]}/><meshStandardMaterial color="#5b4a33" roughness={1}/></mesh>
 </group>;
}

/** A landing bridge from the floor's edge out to the escalator, with glass sides and a gold rail. */
function Bridge({level,y,single}:{level:number;y:number;single:boolean}){
 return <group>{mallLandings(level).map(landing=>{const len=Math.abs(landing.to-landing.from),cx=(landing.to+landing.from)/2,W=landing.width;return <group key={landing.side}>
  <mesh position={[cx,y-.12,landing.z]} receiveShadow castShadow material={finish('stone')}><boxGeometry args={[len,.24,W]}/></mesh>
  {[-1,1].map(k=><group key={k}><mesh position={[cx,y+.5,landing.z+k*W/2]}><boxGeometry args={[len,1,.04]}/><meshStandardMaterial color="#cfe3e0" transparent opacity={.35} depthWrite={false}/></mesh>
   <mesh position={[cx,y+1.02,landing.z+k*W/2]}><boxGeometry args={[len,.05,.08]}/><meshStandardMaterial color="#c9a35a"/></mesh></group>)}
  {single&&<><Box p={[landing.from,y+.5,landing.z]} s={[.06,1,W]} color="#294237"/><Html position={[landing.from,y+1.35,landing.z]} center><span className="skyline-room-label building-floor-label">To other floors</span></Html></>}
 </group>;})}</group>;
}

/** One escalator: a silver truss, real steps at 30°, glass balustrades with gold handrails, comb plates. */
function Escalator({level,y}:{level:number;y:number}){
 const e=escalatorFor(level),dir=Math.sign(e.to-e.from),ang=Math.atan2(e.rise,e.run),L=Math.hypot(e.run,e.rise),W=ESCALATOR.width,z=ESCALATOR.z;
 const steps=Array.from({length:e.steps},(_,i)=>{const t=(i+.5)/e.steps;return {x:e.from+(e.to-e.from)*t,y:y+e.rise*t};});
 return <group>
  {/* Truss under the steps. */}
  <mesh position={[0,y+e.rise/2-.35,z]} rotation={[0,0,dir*ang]} castShadow><boxGeometry args={[L,.45,W+.12]}/><meshStandardMaterial color="#b9c0bd" metalness={.5} roughness={.35}/></mesh>
  {steps.map((p,i)=><mesh key={i} position={[p.x,p.y-e.rise/e.steps/2+.02,z]} castShadow><boxGeometry args={[e.run/e.steps+.02,e.rise/e.steps,W-.12]}/><meshStandardMaterial color={i%2?'#4a4f4c':'#555b57'} roughness={.6}/></mesh>)}
  {[-1,1].map(k=><group key={k}>
   <mesh position={[0,y+e.rise/2+.5,z+k*W/2]} rotation={[0,0,dir*ang]}><boxGeometry args={[L,.95,.04]}/><meshStandardMaterial color="#cfe3e0" transparent opacity={.35} depthWrite={false}/></mesh>
   <mesh position={[0,y+e.rise/2+1,z+k*W/2]} rotation={[0,0,dir*ang]}><boxGeometry args={[L+.3,.07,.1]}/><meshStandardMaterial color="#c9a35a"/></mesh>
  </group>)}
  {/* Comb plates at the two landings. */}
  {[[e.from,y],[e.to,y+e.rise]].map(([x,yy],i)=><mesh key={i} position={[x+(i?dir:-dir)*.35,yy+.015,z]}><boxGeometry args={[.7,.03,W]}/><meshStandardMaterial color="#c9a35a" metalness={.6} roughness={.3}/></mesh>)}
 </group>;
}

/** A box standing on y rather than centred on it. */
const Lift=({p,s,color}:{p:[number,number,number];s:[number,number,number];color:string})=><Box p={[p[0],p[1]+s[1]/2,p[2]]} s={s} color={color}/>;
const mid=(pts:Pt[]):Pt=>{const p=pts[Math.floor(pts.length/2)];return p;};
const centre=(u:MallUnit):Pt=>{const f=mid(u.front),b=mid(u.back);return [(f[0]+b[0])/2,(f[1]+b[1])/2];};

/** What stands inside one unit. Plain boxes, so a floor stays a few hundred meshes. */
function Fitout({u,y}:{u:MallUnit;y:number}){
 const [x,z]=centre(u),f=mid(u.front),ang=Math.atan2(f[1]-z,f[0]-x);
 const along=(d:number,side:number):[number,number]=>[x+Math.cos(ang)*d-Math.sin(ang)*side,z+Math.sin(ang)*d+Math.cos(ang)*side];
 const layout=mallFurniture(u);
 if(layout.depth<1.8||layout.width<1.5)return null;
 const assignment=marketplaceWorkspace(u.id);
 if(assignment){const depth=Math.hypot(mid(u.back)[0]-f[0],mid(u.back)[1]-f[1]);const [dx,dz]=along(-depth*.15,.65);
  return <group position={[dx,y,dz]} rotation={[0,-ang+Math.PI/2,0]}>
   <Lift p={[0,0,0]} s={[1.1,.76,.6]} color="#b28c56"/><Box p={[0,.94,-.12]} s={[.58,.36,.045]} color="#18372b"/>
   <Box p={[0,.8,.12]} s={[.5,.025,.16]} color="#ece5d6"/><Box p={[0,.27,.7]} s={[.45,.54,.45]} color="#294237"/>
   <Person x={0} z={.7} color="#5a8067"/>
  </group>;
 }
 if(u.kind==='food')return <group>{layout.tableOffsets.flatMap(s=>[layout.tableDepth].map(d=>{const [px,pz]=along(d,s);return <group key={`${s}${d}`}>
  <mesh position={[px,y+.72,pz]} castShadow><cylinderGeometry args={[.42,.42,.06,16]}/><meshStandardMaterial color="#f3eadb"/></mesh>
  <Lift p={[px,y+.36,pz]} s={[.08,.72,.08]} color="#294237"/>
  {[-1,1].map(k=><Box key={k} p={[px-Math.sin(ang)*k*.6,y+.25,pz+Math.cos(ang)*k*.6]} s={[.32,.5,.32]} color="#b8735a"/>)}</group>;}))}</group>;
 if(u.kind==='hall'){const [sx,sz]=along(-layout.depth*.25,0);return <group><Lift p={[sx,y+.15,sz]} s={[layout.stageWidth,.3,.6]} color="#4f7a52"/>
  {Array.from({length:layout.chairRows},(_,i)=>i).flatMap(r=>[-1,1].map(c=>{const [px,pz]=along(-.2+r*.55,c*Math.min(.6,layout.width*.18));return <Box key={`${r}${c}`} p={[px,y,pz]} s={[.45,.42,.4]} color="#c9a35a"/>;}))}</group>;}
 if(u.kind==='service'){return <group><mesh position={[x,y+.5,z]} castShadow><cylinderGeometry args={[.65,.65,1,24]}/><meshStandardMaterial color="#f3eadb"/></mesh><Lift p={[x,y+1,z]} s={[1.3,.06,.5]} color="#c9a35a"/><Person x={x} z={z-.2} color="#344c41"/></group>;}
 if(u.kind==='vacant'){const [px,pz]=along(.8,0);return <group><Lift p={[px,y,pz]} s={[.06,1.1,.06]} color="#294237"/><Lift p={[px,y+1.1,pz]} s={[.7,.45,.05]} color="#f7f7f0"/></group>;}
 // Shop or studio: counter at the front, display wall at the back, one figure.
 const [cx,cz]=along(-layout.depth*.05,.55),[bx,bz]=along(-layout.depth*.3,0);
 return <group><Lift p={[cx,y,cz]} s={[1.6,.95,.55]} color={ACCENT[u.kind]}/><Lift p={[cx,y+.95,cz]} s={[1.7,.06,.65]} color="#f3eadb"/>
  <Lift p={[bx,y,bz]} s={[2,1.9,.3]} color={u.kind==="shop"?"#4f7a52":"#a9b4a0"}/><Person x={cx+.2} z={cz} color={u.kind==='shop'?'#806c9e':'#5a8067'}/></group>;
}

/** Schematic accessible lift; static doors, no invented passenger travel. */
function LiftLanding({y,level}:{y:number;level:number}){
 const l=MALL_LIFT,back=l.z-l.depth/2,end=mallLiftEnd(level),len=back-end;
 return <group>
  <Box p={[l.x,y+l.height/2,l.z]} s={[l.width,l.height,l.depth]} color="#b3beb8"/>
  <Box p={[l.x,y+1.15,back-.012]} s={[l.opening,2.3,.035]} color="#294237"/>
  {[-1,1].map(k=><Box key={k} p={[l.x+k*.31,y+1.12,back-.04]} s={[.59,2.2,.025]} color="#c4d7d2"/>)}
  <Box p={[l.x,y+2.5,back-.05]} s={[.65,.12,.04]} color="#c9a35a"/>
  <Box p={[l.x,y-.12,(back+end)/2]} s={[2,.24,len]} color="#ece5d6"/>
  {[-1,1].map(k=><Box key={k} p={[k,y+.5,(back+end)/2]} s={[.06,1,len]} color="#294237"/>)}
 </group>;
}

function Floor({level,y,labels,onPick,cutaway,night,single}:{level:number;y:number;labels:boolean;onPick:(u:MallUnit)=>void;cutaway:boolean;night:boolean;single:boolean}){
 const {outer,inner}=useMemo(()=>mallInteriorFloor(MALL_SHAPE,level),[level]);
 const slab=useMemo(()=>ribbon(outer,inner,y-.25,.25),[outer,inner,y]);
 useEffect(()=>()=>slab.dispose(),[slab]);
 const units=useMemo(()=>mallUnits().filter(u=>u.level===level),[level]);
 // Each unit gets its own finish, laid just above the corridor stone.
 const unitFloors=useMemo(()=>units.map(u=>({id:u.id,finish:FLOOR_OF[u.kind],geo:ribbon(u.back,u.front,y,.015)})),[units,y]);
 useEffect(()=>()=>{for(const f of unitFloors)f.geo.dispose();},[unitFloors]);
 const landings=mallLandings(level);
 const atBridge=(a:Pt,b:Pt)=>landings.some(l=>Math.sign(a[0]+b[0])===l.side&&Math.min(a[1],b[1])<l.z+l.width/2&&Math.max(a[1],b[1])>l.z-l.width/2);
 // One label per name: the food court and demo hall span several bays.
 const labelled=useMemo(()=>{const by=new Map<string,MallUnit[]>();for(const u of units)by.set(u.name,[...(by.get(u.name)??[]),u]);
  return new Set([...by.values()].map(g=>g[Math.floor((g.length-1)/2)].id));},[units]);
 return <group>
  <mesh geometry={slab} receiveShadow castShadow material={finish('stone')}/>
  {unitFloors.map(f=><mesh key={f.id} geometry={f.geo} material={finish(f.finish)} receiveShadow/>)}
  <Bridge level={level} y={y} single={single}/>
  <LiftLanding y={y} level={level}/>
  {[-1,1].map(side=><group key={`light${side}`}>
   <pointLight position={[side*12,y+2.7,-2]} color="#ffe5b4" intensity={night?30:2} distance={25} decay={2}/>
   <mesh position={[side*12,y+3.05,-2]}><boxGeometry args={[3,.035,.15]}/><meshStandardMaterial color="#fff4dc" emissive="#ffe5b4" emissiveIntensity={night?1.3:.15}/></mesh>
  </group>)}
  {/* Glass balustrade round the atrium, open where the escalator bridge leaves. */}
  {inner.slice(1).map((b,i)=>(atBridge(inner[i],b)||(Math.abs((inner[i][0]+b[0])/2)<1.1&&(inner[i][1]+b[1])/2<-5))?null:<group key={i}><Seg a={inner[i]} b={b} y={y} h={.95} t={.04} color="#cfe3e0" opacity={.35}/><Seg a={inner[i]} b={b} y={y+.95} h={.05} t={.08} color="#c9a35a"/></group>)}
  {units.map(u=>{
   // Walls nearest the camera stay low, like the other cutaways, so the shops read from outside.
   const near=centre(u)[1]>2&&cutaway,wall=near?.9:2.9;
   return <group key={u.id}>
    {u.back.slice(1).map((b,i)=><Seg key={i} a={u.back[i]} b={b} y={y} h={wall} t={.12} color="#f7f7f0"/>)}
    {u.kind!=='food'&&u.kind!=='hall'&&[0,u.front.length-1].map(i=><Seg key={i} a={u.front[i]} b={u.back[i]} y={y} h={wall} t={.1} color="#dcd3bd"/>)}
    {u.kind!=='food'&&u.kind!=='hall'&&u.front.slice(1).map((b,i)=>{const {middle,a:doorA,b:doorB}=mallDoorway(u),door=i===middle;
     if(Math.abs(i-middle)===1)return null;
     return <group key={`f${i}`}>{door?<Doors a={doorA} b={doorB} y={y} accent={ACCENT[u.kind]}/>:<Seg a={u.front[i]} b={b} y={y} h={2.6} t={.03} color="#d4e9e6" opacity={.22}/>}
      {door&&<Seg a={doorA} b={doorB} y={y+2.38} h={.22} t={.03} color="#d4e9e6" opacity={.22}/>}<Seg a={u.front[i]} b={b} y={y+2.6} h={.35} t={.12} color={ACCENT[u.kind]}/></group>;})}
    <Fitout u={u} y={y}/>
    {labels&&labelled.has(u.id)&&<Html position={[mid(u.front)[0],y+3.3+(u.index%2)*.65,mid(u.front)[1]]} center><button className="skyline-room-label" title={u.name} onClick={()=>onPick(u)}>{u.name}<span>{marketplaceWorkspace(u.id)?'Proposed workspace':u.kind==='shop'?'Planned · not selling yet':u.kind==='vacant'?'Vacant':u.kind==='food'?'Food court':u.kind==='hall'?'Demo hall':u.kind==='service'?'Information':'Studio'}</span></button></Html>}
   </group>;
  })}
 </group>;
}

/** The funnel "tree" over the atrium: a white lattice stem flaring into a translucent canopy. */
function Atrium({top,night,escalators}:{top:number;night:boolean;escalators:{level:number;y:number}[]}){
 const geo=useMemo(()=>new THREE.LatheGeometry(Array.from({length:16},(_,i)=>{const t=i/15;return new THREE.Vector2(.35+3.9*t**2.3,t*top);}),28),[top]);
 useEffect(()=>()=>geo.dispose(),[geo]);
 return <group>
  <mesh geometry={geo}><meshStandardMaterial color="#f3f1ea" transparent opacity={.55} side={THREE.DoubleSide} depthWrite={false}/></mesh>
  <mesh geometry={geo}><meshBasicMaterial color="#b9c3b0" wireframe/></mesh>
  <mesh position={[0,top,0]}><cylinderGeometry args={[4.5,4.5,.08,40]}/><meshStandardMaterial color="#dce2d5" transparent opacity={.6} emissive="#d0ad69" emissiveIntensity={night?.8:0} depthWrite={false}/></mesh>
  {escalators.map(e=><Escalator key={e.level} level={e.level} y={e.y}/>)}
 </group>;
}

/** The white fin skin on the far half, so the cutaway still reads as the mall from the map. */
function Fins({levels,stacked}:{levels:number[];stacked:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null);
 const items=useMemo(()=>levels.flatMap(level=>{const {outer}=mallInteriorFloor(MALL_SHAPE,level),y=stacked?level*FH:0;
  return outer.slice(1).flatMap((b,i)=>{const a=outer[i];if((a[1]+b[1])/2>1.5)return [];return Array.from({length:4},(_,k)=>{const t=k/4,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,h=FH*(.65+.3*Math.sin(i*.9+k*.4+level*1.7));return {x,z,y:y+FH-h,h,r:-Math.atan2(b[1]-a[1],b[0]-a[0])};});});}),[levels,stacked]);
 useLayoutEffect(()=>{const m=ref.current;if(!m)return;const o=new THREE.Object3D();items.forEach((f,i)=>{o.position.set(f.x,f.y+f.h/2,f.z);o.rotation.set(0,f.r,0);o.scale.set(.06,f.h,.3);o.updateMatrix();m.setMatrixAt(i,o.matrix);});m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();},[items]);
 return <instancedMesh key={items.length} ref={ref} args={[undefined,undefined,items.length]} castShadow><boxGeometry/><meshStandardMaterial color="#f7f7f0" roughness={.5}/></instancedMesh>;
}

function MallCamera({mode}:{mode:number}){
 const controls=useRef<OrbitControlsImpl>(null);const {camera,invalidate,size}=useThree();
 // Phones are tall and narrow: stand further back so the whole ring fits across.
 const far=size.width<size.height?1.7:1;
 useLayoutEffect(()=>{
  wake(1000);
  const all=mode===ALL;camera.position.set(...((all?[44,36,48]:[32,32,38]).map(v=>v*far)) as [number,number,number]);
  const t=controls.current?.target;if(t){t.set(0,all?5:0,-1);camera.lookAt(t);controls.current?.update();}invalidate();
 },[mode,camera,invalidate,far]);
 useInteriorTrackpad(()=>controls.current,{x:MALL_IN.rx,z:MALL_IN.rz});
 return <OrbitControls ref={controls} makeDefault minDistance={8} maxDistance={90} maxPolarAngle={Math.PI/2.2}/>;
}

/** Ground paving follows the actual atrium edge instead of a fixed-size ellipse. */
function Courtyard(){
 const geometry=useMemo(()=>{const {inner}=mallInteriorFloor(MALL_SHAPE,0),shape=new THREE.Shape();
  shape.moveTo(inner[0][0],-inner[0][1]);for(const [x,z] of inner.slice(1))shape.lineTo(x,-z);shape.closePath();
  const geo=new THREE.ShapeGeometry(shape);geo.rotateX(-Math.PI/2);geo.translate(0,-.005,0);return geo;
 },[]);
 useEffect(()=>()=>geometry.dispose(),[geometry]);
 return <mesh geometry={geometry} receiveShadow><meshStandardMaterial color="#e6d6b4" roughness={.9}/></mesh>;
}

/** Atlas Marketplace inside: the shop ring of each floor round the funnel-tree atrium. */
export default function MallInterior({light}:{light:LightMode}){
 const [mode,setMode]=useState(ALL);
 const [picked,setPicked]=useState<MallUnit|null>(null);
 const [output,setOutput]=useState(false);
 const {catalog}=useAtlas();
 const workspace=picked?marketplaceWorkspace(picked.id):undefined;
 const worker=catalog.agents.find(a=>a.id===workspace?.agentId);
 const power=usePowerProfile(),visible=usePageVisible();const isNight=light==='night';
 useEffect(()=>{cityNight.value=isNight?1:0;},[isNight]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 const levels=mode===ALL?[0,1,2,3]:[mode];
 const info=MALL_LEVELS.find(l=>l.level===mode);
 const title=mode===ALL?'All floors · Open cutaway':info!.title;
 return <section className={`skyline-interior mall-interior ${isNight?"night":"day"}`} aria-label="Atlas Marketplace interior">
  <Canvas style={{position:'absolute',inset:0,zIndex:0}} frameloop={visible ? "demand" : "never"} dpr={[1,power.maxDpr]} shadows camera={{position:[26,24,30],fov:42}}>
   <FramePacer profile={power} running={false}/>
   <color attach="background" args={[isNight?'#101b2c':'#dbe2d8']}/>
   <hemisphereLight args={[isNight?'#91abd0':'#f4f7ee',isNight?'#1a2a22':'#8a9a82',isNight?.85:1.2]}/>
   <directionalLight position={[-14,30,18]} intensity={isNight?.5:1.6} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30}/>
   <MallCamera mode={mode}/>
   {/* The real city round the lot, at the interior's scale, reusing the map's own scene. */}
   <CityOutside building="Atlas Marketplace" span={MALL_IN.rx*2} allFloors={mode===ALL} elevation={mode>0&&mode!==ALL?mode*FH:0}/>
      {levels.map(l=><group key={l} position={[0,mode===ALL?l*FH:0,0]}><Floor level={l} y={0} labels={mode!==ALL} onPick={u=>{setPicked(u);setOutput(false);}} cutaway night={isNight} single={mode!==ALL}/>{mode===ALL&&<Html position={[-MALL_IN.rx,0.3,0]} center><span className="skyline-room-label building-floor-label">{l===0?'Lobby':`Floor ${l}`}</span></Html>}</group>)}
   {<group><Atrium top={(mode===ALL?MALL_IN.levels:1)*FH+.6} night={isNight} escalators={mode===ALL?[0,1,2].map(l=>({level:l,y:l*FH})):[]}/><Fins levels={levels} stacked={mode===ALL}/></group>}
   {(mode===ALL||mode===0)&&<group>
    {/* Lobby paving is present in both all-floor and single-floor ground views. */}
    <Courtyard/>
    <Box p={[0,-.02,8]} s={[14,.04,12]} color="#e6d6b4"/>
   </group>}
   {(mode===ALL||mode===0)&&<group>
    {/* Plaza and fountain outside the open end of the horseshoe. */}
    <Box p={[0,-.02,12.5]} s={[17,.04,4]} color="#dcd3bd"/>
    <mesh position={[0,0,13]} castShadow><cylinderGeometry args={[1.3,1.4,.4,32]}/><meshStandardMaterial color="#f7f7f0"/></mesh>
    <mesh position={[0,.21,13]}><cylinderGeometry args={[1.1,1.1,.02,32]}/><meshStandardMaterial color="#5aaac0" emissive="#3d7f99" emissiveIntensity={isNight?.8:0}/></mesh>
   </group>}
  </Canvas>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label="Exit Atlas Marketplace and return to city">← Exit building</button><div><small>ATLAS MARKETPLACE · BENJAIRE PRODUCT WORKSPACES</small><h2>{title}</h2></div></header>
  <nav className="skyline-floor-picker" aria-label="Choose Atlas Marketplace floor"><strong>Floor navigation</strong>
   {[ALL,3,2,1,0].map(n=><button key={n} aria-pressed={mode===n} onClick={()=>{setMode(n);setPicked(null);setOutput(false);}}>{n===ALL?'All floors':n===0?'Lobby':`Floor ${n}`}</button>)}</nav>
  {workspace&&worker&&<aside className="mall-workspace-panel panel-body selectable" aria-label="Marketplace workspace">
   <button className="text-btn" onClick={()=>setPicked(null)} aria-label="Close workspace">Close ×</button>
   <h3>{workspace.role}</h3><p className="small">Planned · Not connected</p>
   <div role="group" aria-label="Workspace information"><button onClick={()=>setOutput(false)} aria-pressed={!output}>Workspace</button><button onClick={()=>setOutput(true)} aria-pressed={output}>Output</button></div>
   {output?<AgentOutput agent={worker}/>:<><p>{workspace.deliverable}</p><dl className="kv"><dt>Existing worker</dt><dd>{worker.name}</dd><dt>Owning project</dt><dd>{worker.projectId}</dd><dt>Execution source</dt><dd>{worker.repository}</dd><dt>Proposed workplace</dt><dd>Atlas Marketplace · Floor 1 · {workspace.unitId}</dd></dl><p className="small">This is a proposed workspace link, not a new agent or runtime reassignment. Output shows the existing worker’s recorded evidence, not Marketplace execution.</p><p className="small">Manual drafts only. Publishing requires approval. No model calls are made here; a $1 cap is not implemented or claimed.</p></>}
  </aside>}
  <aside className="skyline-interior-note">{picked?<>{picked.name}<span>{picked.note}</span></>:mode===ALL?<>Four floors round a funnel-tree atrium · {lookHint()}<span>Proposed workspaces · No agents started · No publishing connected.</span></>:<>{info!.summary}<span>Select a unit to see what it is.</span></>}</aside>
 </section>;
}
