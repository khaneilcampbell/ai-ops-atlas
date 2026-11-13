import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Canvas,useThree} from '@react-three/fiber';
import {Html,OrbitControls} from '@react-three/drei';
import type {OrbitControls as OrbitControlsImpl} from 'three-stdlib';
import * as THREE from 'three';
import {usePageVisible,usePowerProfile} from '../../lib/power';
import {useReducedMotion} from '../../lib/motion';
import {FramePacer} from '../map3d/pacer';
import {night as cityNight} from '../map3d/materials';
import type {LightMode} from '../map3d/living';
import {YACHT,YACHT_KEY} from '../map3d/yachtPlan';
import {buildingDisplayName} from '../../modules/names';
import {Person,SeatedPerson} from './InteriorPrimitives';
import {lookHint,useInteriorTrackpad} from './useInteriorTrackpad';
import {leaveBuilding} from './store';
import {DECKS,DECK_INSET,DECK_SPAN,K,ROOMS,harbourAround,STATUS,YACHT_INTERIOR as I,halfBeam,peopleOnBoard,roomCentre,type Deck,type Room} from './yachtInteriorPlan';
import '../../styles/skyline.css';

/** Height of the harbour water for a view: below the lowest deck shown. */
const waterY=(view:number)=>(view<=0?0:-I.deckH*view)-1.8;
const shown=()=>buildingDisplayName(YACHT_KEY,'Atlas Yacht');
type Item={p:[number,number,number];s:[number,number,number];c:string;r?:number};
const WHITE='#f1f0ec',HULL='#a4a9ac',BOOT='#2c3134',GLASS='#8fa9b6',INK='#2b2a28',FABRIC='#ece6d8',WOOD='#8a6a4c';
const CLOTHES=['#f4f2ec','#2f4a5a','#c96f53','#4f78a8','#e0c068','#6d9b6a'];

function Boxes({items}:{items:Item[]}){
 const ref=useRef<THREE.InstancedMesh>(null),invalidate=useThree(s=>s.invalidate);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;invalidate();const o=new THREE.Object3D(),c=new THREE.Color();
  items.forEach((it,i)=>{o.position.set(...it.p);o.rotation.set(0,it.r??0,0);o.scale.set(...it.s);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,c.set(it.c));});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
 },[items,invalidate]);
 if(!items.length)return null;
 return <instancedMesh key={items.length} ref={ref} args={[undefined,undefined,items.length]} castShadow receiveShadow><boxGeometry/><meshStandardMaterial roughness={.6}/></instancedMesh>;
}

/** Furniture for one room, standing on the floor at y. */
function furniture(r:Room,y:number):Item[]{
 const [cx,cz]=roomCentre(r),w=r.x1-r.x0,d=r.z1-r.z0,out:Item[]=[],b=(x:number,h0:number,z:number,sx:number,h:number,sz:number,c:string)=>out.push({p:[x,y+h0+h/2,z],s:[sx,h,sz],c});
 switch(r.kind){
  case 'lounge':b(cx-w*.25,0,cz,.9,.45,d*.6,FABRIC);b(cx-w*.25-.4,.45,cz,.2,.5,d*.6,FABRIC);b(cx,0,cz,1.2,.38,1.6,WOOD);for(const s of [-1,1])b(cx+w*.1,0,cz+s*d*.3,1.8,.45,.85,FABRIC);break;
  case 'dining':{b(cx+w*.15,0,cz,Math.min(6,w*.4),.75,1.3,WOOD);for(let k=0;k<6;k++)for(const s of [-1,1])b(cx+w*.15-Math.min(6,w*.4)/2+.5+k*Math.min(6,w*.4)/6,0,cz+s*1,.45,.5,.45,FABRIC);
   b(cx-w*.3,0,cz-d*.3,2.4,.45,.9,FABRIC);b(cx-w*.3,0,cz+d*.3,2.4,.45,.9,FABRIC);b(cx-w*.3,0,cz,1.1,.4,1.1,WOOD);break;}
  case 'bed':b(cx+w*.1,0,cz,2.1,.55,1.9,'#f6f4ef');b(cx+w*.1+1.1,0,cz,.15,1.1,2.1,WOOD);b(cx-w*.3,0,cz+d*.3,.9,.75,.9,'#c4cdd2');b(cx-w*.3,0,cz-d*.35,1.4,.9,.5,WOOD);break;
  case 'twin':for(const s of [-1,1]){b(cx-w*.15,0,cz+s*d*.25,2,.5,.9,'#f6f4ef');b(cx+w*.25,0,cz+s*d*.25,1.2,.8,.8,'#c4cdd2');}break;
  case 'bar':b(cx,0,cz,1,1.1,d*.55,WOOD);b(cx,1.1,cz,1.15,.06,d*.58,WHITE);for(let k=0;k<4;k++)b(cx+1,0,cz-d*.22+k*d*.15,.4,.75,.4,INK);b(cx-w*.3,0,cz-d*.3,1.4,2.3,1.4,WHITE);break;
  case 'engine':for(const s of [-1,1]){b(cx-w*.1,0,cz+s*1.6,w*.45,1.5,1.3,'#d0d4d6');b(cx-w*.1,1.5,cz+s*1.6,w*.4,.2,.9,'#b04a3a');b(cx+w*.32,0,cz+s*2.6,1.4,1.2,1,'#d0d4d6');}b(cx+w*.3,0,cz,.8,1.8,2.4,'#6f777b');break;
  case 'stair':for(let k=0;k<10;k++){const a=k/10*Math.PI*1.6;out.push({p:[cx+Math.cos(a)*.9,y+.15+k*.3,cz+Math.sin(a)*.9],s:[1,.12,.5],c:'#d8c39a',r:-a});}b(cx,0,cz,.18,3,.18,'#c9b48a');break;
  case 'helm':b(cx+w*.25,0,cz,1,1,d*.7,INK);b(cx+w*.25,1,cz,.9,.04,d*.65,'#3b5f73');b(cx-w*.05,0,cz-1,.6,1.1,.6,FABRIC);b(cx-w*.05,0,cz+1,.6,1.1,.6,FABRIC);b(cx-w*.35,0,cz,1.6,.45,2.6,FABRIC);break;
  case 'galley':b(cx,0,cz-d*.35,w*.8,.92,.7,'#d8dcdc');b(cx,0,cz+d*.35,w*.8,.92,.7,'#d8dcdc');b(cx,0,cz,1.6,.92,1.2,'#b9bfc1');b(cx+w*.4,0,cz+d*.1,.9,2,.9,'#e5c84a');break;
  case 'jacuzzi':b(cx-w*.05,0,cz,3.6,.7,3.2,WHITE);b(cx-w*.05,.7,cz,3,.04,2.6,'#3aa0c0');for(const s of [-1,1])b(cx+w*.32,0,cz+s*1.6,2.4,.45,.9,FABRIC);b(cx+w*.42,0,cz,.9,.45,3.4,FABRIC);break;
  case 'sunbeds':for(let k=0;k<4;k++)for(const s of [-1,1])b(cx-w*.35+k*1.5,0,cz+s*d*.3,1.1,.35,2,FABRIC);for(const s of [-1,1])b(cx+w*.3,0,cz+s*1.2,1.6,.5,1.6,FABRIC);break;
  case 'desk':b(cx,0,cz,1.6,.75,.8,WOOD);b(cx-.7,0,cz,.6,1,.6,INK);break;
  case 'storage':for(const s of [-1,1])b(cx,0,cz+s*d*.25,w*.6,1.2,.6,'#b3b6b4');break;
  case 'tender':b(cx+w*.25,0,cz,3.4,.8,1.6,'#2f5a7a');b(cx+w*.25,.8,cz,2,.4,1.2,WHITE);for(const s of [-1,1])b(cx-w*.2,0,cz+s*1.5,2.2,.45,.9,FABRIC);b(cx-w*.2,0,cz,1,.38,1,WOOD);break;
  case 'sauna':b(cx,0,cz,w*.7,1.2,d*.6,'#a77b52');break;
  case 'bath':b(cx,0,cz,1.2,.9,.6,WHITE);break;
 }
 if(r.id==='beach-club'){b(r.x0+.6,0,cz,.9,.25,d*.85,'#b98c5f');b(r.x1-1.5,0,r.z0+.8,2.4,1,.7,WOOD);}
 return out;
}

/** A deck's edge in plan: the hull's lines between the deck's ends, inset for side decks. */
function deckOutline(deck:Deck):[number,number][]{
 const [x0,x1]=DECK_SPAN[deck],n=24,xs=Array.from({length:n+1},(_,i)=>x0+(x1-x0)*i/n),half=(x:number)=>Math.max(.3,halfBeam(x)-DECK_INSET[deck]);
 return [...xs.map((x):[number,number]=>[x,-half(x)]),...xs.reverse().map((x):[number,number]=>[x,half(x)])];
}
/** The deck plate, one smooth slab on the hull's lines. */
function DeckPlate({deck,y}:{deck:Deck;y:number}){
 const geo=useMemo(()=>{const g=new THREE.ExtrudeGeometry(new THREE.Shape(deckOutline(deck).map(([x,z])=>new THREE.Vector2(x,z))),{depth:.3,bevelEnabled:false});g.rotateX(Math.PI/2);g.translate(0,y,0);return g;},[deck,y]);
 useEffect(()=>()=>geo.dispose(),[geo]);
 return <mesh geometry={geo} receiveShadow castShadow><meshStandardMaterial color={deck===0?'#d8d6cf':WHITE} roughness={.6}/></mesh>;
}

/** One deck at height y: the deck plate on the hull's lines, room floors, walls, rails and furniture. */
function deckItems(deck:Deck,y:number,single:boolean):Item[]{
 const items:Item[]=[],wallH=single?I.wall:I.lowWall;
 // Walls and rails follow the deck edge, one straight piece per segment of the hull's lines.
 const edge=deckOutline(deck);
 for(let i=0;i<edge.length;i++){
  const [ax,az]=edge[i],[bx,bz]=edge[(i+1)%edge.length],len=Math.hypot(bx-ax,bz-az),mx=(ax+bx)/2,mz=(az+bz)/2,r=-Math.atan2(bz-az,bx-ax);
  if(len<.01)continue;
  if(deck===0){
   // The hull round the lower deck: full height on the far (port) side, cut low on the camera side.
   const hh=mz<0?I.deckH+.2:.9;items.push({p:[mx,y-.3+hh/2,mz],s:[len+.05,hh+.3,.16],c:HULL,r},{p:[mx,y-1.2,mz],s:[len+.05,1.2,.16],c:BOOT,r});
  }else if(ROOMS.some(o=>o.deck===deck&&o.open&&mx>=o.x0-.5&&mx<=o.x1+.5))items.push({p:[mx,y+.5,mz],s:[len+.02,1,.05],c:GLASS,r});
 }
 for(const r of ROOMS.filter(r=>r.deck===deck)){
  const [cx,cz]=roomCentre(r),w=r.x1-r.x0,d=r.z1-r.z0;
  items.push({p:[cx,y+.02,cz],s:[w-.08,.04,d-.08],c:r.floor});
  if(!r.open){
   // Far and end walls at full height, the near (starboard, camera-side) wall cut low.
   items.push({p:[cx,y+wallH/2,r.z0],s:[w,wallH,.14],c:deck===0?'#efece4':WHITE});
   items.push({p:[cx,y+.5,r.z1],s:[w,1,.14],c:deck===0?'#efece4':WHITE});
   for(const x of [r.x0,r.x1])items.push({p:[x,y+wallH/2,cz],s:[.14,wallH,d],c:'#f4f2ec'});
   // Saloons, wheelhouse and suite: a dark glazing band on the far wall, as on the outside.
   if(deck>0&&single)items.push({p:[cx,y+wallH*.55,r.z0+.08],s:[w-.3,wallH*.6,.04],c:'#2a343b'});
  }
  items.push(...furniture(r,y+.04));
 }
 return items;
}

const VIEW_EYES:{[k:number]:[number,number,number]}={[-1]:[34,40,58],0:[18,26,32],1:[18,30,32],2:[16,32,30],3:[14,34,28]};
function Camera({view}:{view:number}){
 const controls=useRef<OrbitControlsImpl>(null);const {camera,invalidate,size}=useThree();
 const far=size.width<size.height?Math.min(2.4,1.2/(size.width/size.height)**.75):1;
 useLayoutEffect(()=>{
  const ty=view<0?I.explode*1.5:0,eye=VIEW_EYES[view];
  camera.position.set(eye[0]*far,eye[1]*far+ty,eye[2]*far);
  const t=controls.current?.target;if(t){t.set(view<0?-2:0,ty,0);camera.lookAt(t);controls.current?.update();}
  invalidate();
 },[view,camera,invalidate,far]);
 useInteriorTrackpad(()=>controls.current,{x:I.length/2,z:6});
 return <OrbitControls ref={controls} makeDefault minDistance={8} maxDistance={160} maxPolarAngle={Math.PI/2.1}/>;
}

/**
 * Inside Atlas: all four decks as an open cutaway (the decks lifted apart so every room shows), or
 * one deck at a time. The pontoon and passerelle sit off the port side at the main deck, the
 * way on and off. People are visitors and crew figures: no agents are assigned to the yacht.
 */
export default function YachtInterior({light}:{light:LightMode}){
 const [view,setView]=useState(-1);const [picked,setPicked]=useState<string|null>(null);
 const power=usePowerProfile(),visible=usePageVisible(),reduced=useReducedMotion(),isNight=light==='night',all=view===-1;
 useEffect(()=>{cityNight.value=isNight?1:0;},[isNight]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 const decks=(all?[0,1,2,3]:[view]) as Deck[];
 const baseY=(d:Deck)=>all?d*I.explode:0;
 const items=useMemo(()=>decks.flatMap(d=>deckItems(d,baseY(d),!all)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- decks and baseY follow view
  [view]);
 const people=useMemo(()=>peopleOnBoard().filter(p=>decks.includes(p.deck)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- decks follows view
  [view]);
 // Dock connector, on the port side as on the map: the pontoon alongside, and the passerelle up to the aft deck gate (main deck).
 const dock=useMemo(()=>{
  if(!decks.includes(1))return [] as Item[];
  const y=baseY(1),side=halfBeam(-20)+3.5,gateX=(YACHT.main.aftDeck+YACHT.platform.x1)/2*K+.25*K,len=side-halfBeam(gateX)-1.4;
  const out:Item[]=[{p:[0,y-1.9,-(side+1.4)],s:[64,.4,2.8],c:'#b89569'}];
  for(let x=-28;x<=28;x+=8)out.push({p:[x,y-3.2,-(side+2.6)],s:[.4,3,.4],c:'#54493f'});
  for(let k=0;k<=8;k++){const t=k/8;out.push({p:[gateX,y-1.7+1.7*t,-(side-t*len)],s:[1.4,.08,len/8+.05],c:'#b98c5f'});}
  for(const s of [-1,1])out.push({p:[gateX+s*.7,y-.8,-(side-len/2)],s:[.06,.9,len],c:'#cfd3d5'});
  // The marina, stair and shore round her, lined up on the pontoon deck, down to the water.
  return out.concat(harbourAround(y-1.7,waterY(view)));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- decks and baseY follow view
 },[view]);
 const title=all?'All decks · Open cutaway':DECKS[view];
 return <section className={`skyline-interior ${isNight?'night':'day'}`} aria-label={`${shown()} interior`}>
  <Canvas style={{position:'absolute',inset:0,zIndex:0}} frameloop={visible?"demand":"never"} dpr={[1,power.maxDpr]} shadows camera={{position:VIEW_EYES[-1],fov:40}}>
   <FramePacer profile={power} running={!reduced}/>
   <color attach="background" args={[isNight?'#101b2c':'#dbe4e8']}/>
   <ambientLight color={isNight?'#c1cfed':'#ffffff'} intensity={isNight?.32:.75}/>
   <hemisphereLight args={[isNight?'#91abdc':'#eef6ff',isNight?'#22343c':'#5f7f8a',isNight?.45:1.2]}/>
   <directionalLight color={isNight?'#99b8ed':'#fff4da'} position={[18,40,24]} intensity={isNight?.35:1.9} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-36} shadow-camera-right={36} shadow-camera-top={36} shadow-camera-bottom={-36}/>
   <Camera view={view}/>
   {/* The harbour round the hull. */}
   <mesh position={[0,waterY(view),0]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[200,200]}/><meshStandardMaterial color={isNight?'#16303f':'#4f8aa0'} roughness={.25} metalness={.1} transparent opacity={.92}/></mesh>
   {decks.map(d=><DeckPlate key={d} deck={d} y={baseY(d)}/>)}
   <Boxes items={items}/><Boxes items={dock}/>
   {people.map((p,i)=><group key={i} position={[p.x,baseY(p.deck)+.04,p.z]} scale={1.35}>{p.seated?<SeatedPerson x={0} z={0} color={CLOTHES[i%CLOTHES.length]}/>:<Person x={0} z={0} color={CLOTHES[i%CLOTHES.length]}/>}</group>)}
   {all&&decks.map(d=><Html key={d} position={[DECK_SPAN[d][0]-2.5,baseY(d)+.4,halfBeam(DECK_SPAN[d][0])]} center zIndexRange={[6,0]}><button className="skyline-room-label building-floor-label" data-floor-label={d} onClick={()=>{setView(d);setPicked(null);}}>{DECKS[d]}</button></Html>)}
   {!all&&ROOMS.filter(r=>r.deck===view).map(r=>{const [x,z]=roomCentre(r);return <Html key={r.id} position={[x,3.3,z]} center zIndexRange={[8,0]}><button className="skyline-room-label" onClick={()=>setPicked(`${r.name} · ${r.what} · ${STATUS}`)}>{r.name}</button></Html>;})}
   {view===1&&<Html position={[(YACHT.main.aftDeck+YACHT.platform.x1)/2*K+.25*K,-1,-(halfBeam(-20)+4.5)]} center zIndexRange={[8,0]}><button className="skyline-room-label" onClick={()=>setPicked(`Passerelle · The gangway from the marina pontoon to the aft deck gate, how everyone gets on and off · ${STATUS}`)}>Passerelle</button></Html>}
   <pointLight position={[0,(all?I.explode*1.5:0)+8,0]} color="#ffe6bf" intensity={isNight?120:8} distance={60} decay={1.6}/>
  </Canvas>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label={`Exit ${shown()} and return to city`}>← Exit yacht</button><div><small>{shown().toUpperCase()} · YACHT</small><h2>{title}</h2></div></header>
  <nav className="skyline-floor-picker" aria-label={`Choose ${shown()} deck`}><strong>Deck navigation</strong>{[-1,3,2,1,0].map(n=><button key={n} aria-pressed={view===n} onClick={()=>{setView(n);setPicked(null);}}>{n===-1?'All':DECKS[n]}</button>)}</nav>
  <aside className="skyline-interior-note">{picked??(all?`All four decks lifted apart: beach club and cabins, main saloon and owner's suite, bridge saloon and wheelhouse, sun deck and jacuzzi · ${lookHint()}`:'Select a space')}<span>{`${STATUS} · People on board are visitors and crew figures · A schematic from the deck plan, not a fitted model`}</span></aside>
 </section>;
}
