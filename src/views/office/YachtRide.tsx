import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {Html} from '@react-three/drei';
import * as THREE from 'three';
import {yachtRide,type YachtView} from '../map3d/yachtRide';
import {DECK_FLOOR,cityFacing,deckToMap,decksShown,easeAngle,openSide,yachtLivePose,yachtRideView} from '../map3d/yachtRidePlan';
import {Person,SeatedPerson} from './InteriorPrimitives';
import {DECKS,DECK_INSET,DECK_SPAN,ROOMS,YACHT_INTERIOR as I,halfBeam,peopleOnBoard,roomCentre,type Deck,type Room} from './yachtInteriorPlan';

/**
 * Riding the Atlas yacht inside the map (Khaneil, 2026-11-14: "I should be able to see the Atlas city wherever I am when
 * Im inside the yacht. Follow gold jet design rule"). Her four decks are drawn in the map's own scene at her live pose,
 * stacked at their real heights and open on the starboard side like a doll's house, and the map camera rides with her:
 * the real city, marina, harbour boats and sea go by outside as she cruises out and back. The map's own yacht is hidden
 * meanwhile, since these decks stand in for her. People on board are visitors and crew figures, never agents.
 */
type Item={p:[number,number,number];s:[number,number,number];c:string;r?:number};
const WHITE='#f1f0ec',HULL='#a4a9ac',BOOT='#2c3134',GLASS='#8fa9b6',INK='#2b2a28',FABRIC='#ece6d8',WOOD='#8a6a4c';
const CLOTHES=['#f4f2ec','#2f4a5a','#c96f53','#4f78a8','#e0c068','#6d9b6a'];

function Boxes({items,night=false}:{items:Item[];night?:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null),invalidate=useThree(s=>s.invalidate);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;invalidate();const o=new THREE.Object3D(),c=new THREE.Color();
  items.forEach((it,i)=>{o.position.set(...it.p);o.rotation.set(0,it.r??0,0);o.scale.set(...it.s);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,c.set(it.c));});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
 },[items,invalidate]);
 if(!items.length)return null;
 // A changing count needs a fresh mesh, or the old one stays drawn.
 return <instancedMesh key={items.length} ref={ref} args={[undefined,undefined,items.length]} raycast={()=>null}><boxGeometry/><meshStandardMaterial roughness={.6} emissive={night?'#4a3a22':'#000000'} emissiveIntensity={night?.55:0}/></instancedMesh>;
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
/** The deck plate, one smooth slab on the hull's lines, under the floor at y. */
function DeckPlate({deck,y}:{deck:Deck;y:number}){
 const geo=useMemo(()=>{const g=new THREE.ExtrudeGeometry(new THREE.Shape(deckOutline(deck).map(([x,z])=>new THREE.Vector2(x,z))),{depth:.3,bevelEnabled:false});g.rotateX(Math.PI/2);g.translate(0,y,0);return g;},[deck,y]);
 useEffect(()=>()=>geo.dispose(),[geo]);
 return <mesh geometry={geo} raycast={()=>null}><meshStandardMaterial color={deck===0?'#d8d6cf':WHITE} roughness={.6}/></mesh>;
}

/** One deck at height y: hull or glazing round the edge, room floors, walls cut low on the camera's side (`open`: +1 the
 * starboard side, -1 port), furniture. */
function deckItems(deck:Deck,y:number,open:1|-1):Item[]{
 const items:Item[]=[],edge=deckOutline(deck);
 for(let i=0;i<edge.length;i++){
  const [ax,az]=edge[i],[bx,bz]=edge[(i+1)%edge.length],len=Math.hypot(bx-ax,bz-az),mx=(ax+bx)/2,mz=(az+bz)/2,r=-Math.atan2(bz-az,bx-ax);
  if(len<.01)continue;
  if(deck===0){
   // The hull round the lower deck, down past the waterline: full height on the port side, cut low on the starboard side.
   const hh=mz*open<0?I.deckH+.2:.9;items.push({p:[mx,y-.3+hh/2,mz],s:[len+.05,hh+.3,.16],c:HULL,r},{p:[mx,y-1.2,mz],s:[len+.05,1.4,.16],c:BOOT,r});
  }else{
   const outside=ROOMS.some(o=>o.deck===deck&&o.open&&mx>=o.x0-.5&&mx<=o.x1+.5);
   if(outside||mz*open<0)items.push({p:[mx,y+.5,mz],s:[len+.02,1,.05],c:outside?GLASS:WHITE,r});
  }
 }
 for(const r of ROOMS.filter(r=>r.deck===deck)){
  const [cx,cz]=roomCentre(r),w=r.x1-r.x0,d=r.z1-r.z0;
  items.push({p:[cx,y+.02,cz],s:[w-.08,.04,d-.08],c:r.floor});
  if(!r.open){
   const far=open>0?r.z0:r.z1,near=open>0?r.z1:r.z0;
   items.push({p:[cx,y+I.wall/2,far],s:[w,I.wall,.14],c:deck===0?'#efece4':WHITE});
   items.push({p:[cx,y+.5,near],s:[w,1,.14],c:deck===0?'#efece4':WHITE});
   for(const x of [r.x0,r.x1])items.push({p:[x,y+I.wall/2,cz],s:[.14,I.wall,d],c:'#f4f2ec'});
   // Saloons, wheelhouse and suite: a dark glazing band on the far wall, as on the outside.
   if(deck>0)items.push({p:[cx,y+I.wall*.55,far+open*.08],s:[w-.3,I.wall*.6,.04],c:'#2a343b'});
  }
  items.push(...furniture(r,y+.04));
 }
 return items;
}

/** drei Html scale for the quiet tags, in map units: sized for the usual ride distance, smaller as you pull back. */
const DISTANCE=6;
/** The decks shown for a view, the people on them and their quiet name tags, in deck metres. */
function Decks({view,open,night}:{view:YachtView;open:1|-1;night:boolean}){
 const decks=decksShown(view);
 const items=useMemo(()=>decks.flatMap(d=>deckItems(d,DECK_FLOOR[d],open)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- decks follows view
  [view,open]);
 const people=useMemo(()=>peopleOnBoard().filter(p=>decks.includes(p.deck)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- decks follows view
  [view]);
 const single=view!==-1&&view!=='sundeck';
 return <>
  {decks.map(d=><DeckPlate key={d} deck={d} y={DECK_FLOOR[d]}/>)}
  <Boxes items={items} night={night}/>
  {people.map((p,i)=><group key={`${view}-${i}`} position={[p.x,DECK_FLOOR[p.deck]+.04,p.z]} scale={1.35}>{p.seated?<SeatedPerson x={0} z={0} color={CLOTHES[i%CLOTHES.length]}/>:<Person x={0} z={0} color={CLOTHES[i%CLOTHES.length]}/>}</group>)}
  {/* Names as small quiet tags on the far side that never take a click: deck names for the whole yacht, room names on one deck. */}
  {view===-1&&decks.map(d=><Html key={`deck-${d}`} position={[DECK_SPAN[d][0]+1.5,DECK_FLOOR[d]+2.6,-open*(halfBeam(DECK_SPAN[d][0]+4)-.6)]} center distanceFactor={DISTANCE} zIndexRange={[6,0]} style={{pointerEvents:'none'}}><span className="ride-room-tag yacht">{DECKS[d]}</span></Html>)}
  {single&&ROOMS.filter(r=>r.deck===view).map(r=>{const [x]=roomCentre(r);return <Html key={r.id} position={[x,DECK_FLOOR[r.deck]+2.9,open>0?r.z0+.6:r.z1-.6]} center distanceFactor={DISTANCE} zIndexRange={[6,0]} style={{pointerEvents:'none'}}><span className="ride-room-tag yacht">{r.name}</span></Html>;})}
  {/* Warm light from inside at night, like the buildings' lit windows. */}
  {night&&<pointLight position={[0,DECK_FLOOR[2],2]} color="#ffe2b0" intensity={260} distance={70} decay={1.6}/>}
 </>;
}

interface RideControls {target:THREE.Vector3;enabled:boolean}
/**
 * Mounted in the map's scene while you are inside the yacht: carries her decks with her and puts the map camera on board.
 * The map skips its own camera controls meanwhile and gets them back, with the view you left, on the way out.
 */
export default function YachtRide({night,controls,city}:{night:boolean;controls:RideControls;city:{x:number;z:number}}){
 const group=useRef<THREE.Group>(null);
 const {camera,size,invalidate}=useThree();
 const portrait=size.width<size.height;
 useLayoutEffect(()=>{
  const cam=camera as THREE.PerspectiveCamera,near=cam.near;
  yachtRide.active=true;controls.enabled=false;cam.near=.05;cam.updateProjectionMatrix();invalidate();
  return ()=>{yachtRide.active=false;controls.enabled=true;cam.near=near;cam.updateProjectionMatrix();};
 },[camera,controls,invalidate]);
 const eye=useMemo(()=>new THREE.Vector3(),[]),target=useMemo(()=>new THREE.Vector3(),[]);
 const view=useRideView();
 // The camera turns with her so the city stays in view (cityFacing), and the decks open on whichever side it is on.
 const auto=useRef<number|null>(null),[open,setOpen]=useState<1|-1>(1),openRef=useRef<1|-1>(1);
 useFrame((_,dt)=>{
  const g=group.current,pose=yachtLivePose();if(!g||!pose)return;
  const m=deckToMap(pose);
  g.matrix.copy(m);g.matrixWorldNeedsUpdate=true;
  const want=cityFacing(yachtRide.view,portrait,pose,city);
  auto.current=auto.current===null?want:easeAngle(auto.current,want,dt);
  const v=yachtRideView(yachtRide.view,portrait,auto.current+yachtRide.yaw,yachtRide.pitch,yachtRide.zoom);
  const side=openSide(v,openRef.current);if(side!==openRef.current){openRef.current=side;setOpen(side);}
  eye.copy(v.eye).applyMatrix4(m);target.copy(v.target).applyMatrix4(m);
  camera.position.copy(eye);controls.target.copy(target);camera.lookAt(target);
 });
 return <group ref={group} matrixAutoUpdate={false}><Decks view={view} open={open} night={night}/></group>;
}

/** The overlay changes yachtRide.view outside React: follow it here so the decks shown change with it. */
function useRideView(){
 const [view,setView]=useState<YachtView>(yachtRide.view);
 useFrame(()=>{if(yachtRide.view!==view)setView(yachtRide.view);});
 return view;
}
