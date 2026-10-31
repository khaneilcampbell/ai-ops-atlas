import {airportFlightCircuit} from './flightClearance';
import * as THREE from "three";
import {MODELS,SCALE} from "./vehicleModels";
import AirportCampus from "./AirportCampus";
import {FLIGHT_SCHEDULE,fleetPose} from "./flightSchedule";
import {airportAnimationEnabled} from "./airportBuildings";
import {liveryFor,type Livery} from "./airlineLiveries";
import {usePowerProfile} from "../../lib/power";
import { useMemo, useRef, useEffect, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { AIRPORT_KEY, AIRPORT_LAYOUT, AIRPORT_REMOTE_STANDS, AIRPORT_TERMINAL, airportParkingBays, AIRCRAFT_LAYOUT, BOARDING_LAYOUT, boardingBridge, type AirportPlan, type FlightCircuit } from "./airport";
import { Instanced, type Inst, type useGeometries, type useMaterials, type Pick } from "./models";
import { TERRACE_H } from "./scene";
type Geometry=ReturnType<typeof useGeometries>;
type Materials=ReturnType<typeof useMaterials>;

const WHEELS=[-.12,.12].flatMap(side=>[-.85,.5].map(z=>({p:[side,.09,z] as [number,number,number],s:[.055,.065,.065] as [number,number,number],c:"#202b36"})));
/** Gear for flying aircraft hangs from the belly so it can fold up after takeoff. */
const GEAR_TOP=.2;

function Aircraft({g,m,circuit,clock,slot,parked,livery}:{parked?:{x:number;z:number};g:Geometry;m:Materials;circuit?:FlightCircuit;clock:MutableRefObject<number>;slot:number;livery:Livery}) {
  const ref=useRef<Group>(null),gearRef=useRef<Group>(null);
  const parts=useMemo(()=>{
    const l=livery;
    return {
    body:[
      {p:[0,.34,0],s:[.23,.21,1.4],c:l.fuselage},
      {p:[0,.245,0],s:[.225,.10,1.28],c:l.belly},
      {p:[0,.43,-1.02],s:[.16,.075,.19],c:l.cockpit},
      {p:[-.48,.21,-.18],s:[.14,.14,.32],c:l.engine},
      {p:[.48,.21,-.18],s:[.14,.14,.32],c:l.engine},
      {p:[-.48,.21,-.46],s:[.105,.105,.035],c:l.intake},
      {p:[.48,.21,-.46],s:[.105,.105,.035],c:l.intake},
      ...(parked?WHEELS:[]),
    ] as Inst[],
    gear:WHEELS.map(w=>({...w,p:[w.p[0],w.p[1]-GEAR_TOP,w.p[2]]})) as Inst[],
    wings:[
      {p:[-.67,.30,.13],s:[1.35,.055,.4],r:-.32,c:l.wing},
      {p:[.67,.30,.13],s:[1.35,.055,.4],r:.32,c:l.wing},
      {p:[0,.36,1.02],s:[1.12,.045,.26],c:l.wing},
      // Fin reaches up to the top band so both livery bands sit on the tail, not above it.
      {p:[0,.44,1.03],s:[.07,.62,.36],c:l.tail},
      {p:[0,.5,1.04],s:[.075,.08,.34],c:l.tailLow},
      {p:[0,.67,1.04],s:[.075,.08,.34],c:l.tailHigh},
      {p:[-1.29,.34,.34],s:[.055,.20,.24],c:l.winglet},
      {p:[1.29,.34,.34],s:[.055,.20,.24],c:l.winglet},
      {p:[AIRCRAFT_LAYOUT.doorX,AIRCRAFT_LAYOUT.doorY,AIRCRAFT_LAYOUT.doorZ],s:[.02,AIRCRAFT_LAYOUT.doorHeight,.12],c:l.windows},
      ...[-1,1].flatMap(side=>Array.from({length:12},(_,i)=>({p:[side*.222,.39,-.82+i*.15],s:[.018,.055,.055],c:l.windows}))),
    ] as Inst[],
  };},[livery,parked]);
  useFrame(()=>{
    if(!ref.current||parked)return;
    const pose=fleetPose(clock.current,slot,circuit);
    ref.current.position.set(pose.x,pose.y,pose.z);
    // Heading first, then nose pitch, then bank about the fuselage.
    ref.current.rotation.set(pose.pitch,pose.yaw,pose.roll,"YXZ");
    ref.current.visible=pose.visible;
    if(gearRef.current){gearRef.current.scale.set(1,Math.max(.001,pose.gear),1);gearRef.current.visible=pose.gear>.02;}
  });
  return <group ref={ref} position={parked?[parked.x,0,parked.z]:undefined}>
    <Instanced items={parts.body} geometry={g.ball} material={m.plain}/>
    <Instanced items={parts.wings} geometry={g.box} material={m.plain}/>
    {!parked&&<group ref={gearRef} position={[0,GEAR_TOP,0]}><Instanced items={parts.gear} geometry={g.ball} material={m.plain} shadow={false}/></group>}
  </group>;
}

/** Shared geometry and materials; departures use the existing scene frame loop. */
export function Airport({plan:a,g,m,pick,moving,bounds,flightAltitude,night=false}:{night?:boolean;bounds?:{x0:number;z0:number;x1:number;z1:number};flightAltitude?:number;plan?:AirportPlan;g:Geometry;m:Materials;pick:Pick;moving:boolean}) {
  const clock=useRef(0);
  const power=usePowerProfile();
  const [visible,setVisible]=useState(()=>document.visibilityState!=="hidden");
  useEffect(()=>{const on=()=>setVisible(document.visibilityState!=="hidden");document.addEventListener("visibilitychange",on);return()=>document.removeEventListener("visibilitychange",on)},[]);
  const animate=airportAnimationEnabled(moving,power.pauseInBackground,visible);
  const glazing=useMemo(()=>new THREE.MeshPhysicalMaterial({color:'#8ec8dc',transparent:true,opacity:.2,roughness:.14,metalness:.04,depthWrite:false}),[]);
  useEffect(()=>{glazing.color.set(night?'#f5e4be':'#8ec8dc');glazing.emissive.set('#f4d496');glazing.emissiveIntensity=night?1.1:0;glazing.opacity=night?.58:.2;},[glazing,night]);
  useEffect(()=>()=>glazing.dispose(),[glazing]);
  useFrame((_,dt)=>{if(animate)clock.current+=Math.min(dt,.1);});
  const parts=useMemo(()=>{
    if(!a)return null;
    const y=TERRACE_H,x=a.x,z=a.z;
    const box=(px:number,py:number,pz:number,w:number,h:number,d:number,c:string):Inst=>({p:[px,py,pz],s:[w,h,d],c});
    const cubes:Inst[]=[
      box(x+1.5,y,z+6,5,.045,12,"#d5c8ac"),
      box(x+1.5,y+.05,z+6,3.8,.10,10.5,"#eef0eb"),
      box(x+1.5,y+1.25,z+6,3.8,.10,10.5,"#eef0eb"),
      box(x+1.5,y+2.45,z+6,4.2,.16,11,"#f0f1ed"),
      box(x+1.5,y+2.61,z+6,2.7,.3,5.5,"#e5e8e3"),
      box(x+1.5,y+2.91,z+6,2.9,.06,5.8,"#294237"),
      box(x-.43,y+.05,z+6,.04,1.25,2,"#20372c"),
      box(x-.46,y+1.4,z+6,.045,.25,3,"#c9a35a"),
      box(x+1.5,y,z-3,.65,3.7,.65,"#e2d4b6"),
      box(x+1.5,y+3.7,z-3,1.35,.7,1.25,"#355e5b"),
      box(x+1.5,y+4.4,z-3,1.5,.12,1.4,"#294237"),
      box(x+15,y+.015,z+7.5,2.2,.045,21,"#2b3335"),
      box(x+3.65,y+.22,z+6,.55,.03,14.5,"#d9d8ca"),
      box(x+3.65,y+.54,z+6,.75,.04,14.8,"#294237"),
      box(x+7.35,y+.02,z+7,7.6,.035,20.8,"#969e9d"),
      box(x+11.5,y+.02,z+8,.85,.04,20,"#777f7f"),
      box(x+7.5,y+.02,z+18,7,.04,1.2,"#414a49"),
      box(x+2,y+.05,z+18,2.2,1.05,2,"#eadfc8"),
      box(x+2,y+1.1,z+18,2.5,.12,2.3,"#294237"),
    ];
    const glass:Inst[]=[],interiorLights:Inst[]=[],round:Inst[]=[box(x+1.5,y+4.95,z-3,.5,.5,.5,'#f4f1e6')];
    // Warm glazed cab panels sit outside the tower shaft and below its roof.
    for(const side of [-1,1])glass.push(box(x+1.5+side*.685,y+3.82,z-3,.025,.44,1.08,'#ffffff'),box(x+1.5,y+3.82,z-3+side*.635,1.18,.44,.025,'#ffffff'));
    // Glazed terminal with a visible check-in hall and upper passenger lounge.
    for(const yy of [.15,1.35]){
     for(const zz of [1.2,3.6,6,8.4,10.8])for(const xx of [-.4,3.4])cubes.push(box(x+xx,y+yy,z+zz,.07,1.1,.07,'#9eaaa8'));
     for(const zz of [1.2,10.8])glass.push(box(x+1.5,y+yy,z+zz,3.7,1.08,.025,'#ffffff'));
     for(const xx of [-.4,3.4]){
      glass.push(box(x+xx,y+yy,z+6,.025,1.08,9.6,'#ffffff'));
      interiorLights.push(box(x+xx,y+yy+.98,z+6,.04,.035,9.6,'#fff2d1'));
     }
     for(const zz of [2.4,5,7.6,9.4]){
      interiorLights.push(box(x+1.5,y+yy+1.02,z+zz,2.8,.025,.14,'#fff2d1'));
      for(const xx of [.4,2.4])cubes.push(box(x+xx,y+yy,z+zz,.44,.26,.28,'#294237'),box(x+xx,y+yy+.26,z+zz+.11,.44,.22,.08,'#355f5b'));
     }
    }
    for(const zz of [3,5,7,9])cubes.push(box(x+.05,y+.15,z+zz,.5,.4,.7,'#e8e5d9'),box(x+.05,y+.55,z+zz,.55,.04,.75,'#c9a35a'),box(x+.1,y+.59,z+zz,.04,.23,.25,'#254b58'));
    // Public arrivals forecourt and a separate landside display parking area.
    cubes.push(box(x+AIRPORT_TERMINAL.arrivalsX,y+.035,z+2.4,.64,.025,20,'#424b50'),box(x-.85,y+.04,z+5,.48,.05,13.4,'#e6d6b4'),box(x+1,y+.035,z-6.4,4.4,.025,3.2,'#424b50'));
    for(const [i,bay] of airportParkingBays().entries()){
     const px=x+bay.x,pz=z+bay.z,model=MODELS[i%2?'gwagon':'bmw'];
     for(const p of model.parts)cubes.push({p:[px+p.at[2]*SCALE,y+.065+p.at[1]*SCALE,pz-p.at[0]*SCALE],s:p.size.map(v=>v*SCALE) as [number,number,number],r:Math.PI/2,c:p.color??['#386b92','#e6e8e3','#303b40'][i%3]});
     for(const side of [-1,1])cubes.push(box(px+side*.32,y+.066,pz,.02,.008,.95,'#eee8d5'));
    }
    for(const side of [-1,1])for(let zz=-1.25;zz<13.25;zz+=.5){
     if(AIRPORT_LAYOUT.gateZ.some(g=>Math.abs(zz-(g+AIRCRAFT_LAYOUT.doorZ))<.45))continue;
     glass.push(box(x+3.65+side*.29,y+.25,z+zz,.02,.27,.48,'#ffffff'));
    }
    // Remote stands add parked jets without increasing airborne traffic.
    for(const stand of AIRPORT_REMOTE_STANDS){
     cubes.push(box(x+stand.x,y+.02,z+stand.z,3.7,.035,3.6,'#969e9d'),box(x+stand.x,y+.06,z+stand.z,.035,.01,2.8,'#d6bd6e'));
     for(const side of [-1,1])cubes.push(box(x+stand.x+side*1.65,y+.06,z+stand.z,.025,.01,3.4,'#e5e7da'));
     const taxiExtensionZ=stand.z<0?-3:20;
     cubes.push(box(x+9.9,y+.02,z+stand.z,2.8,.035,.8,'#8b9493'),box(x+11.5,y+.02,z+taxiExtensionZ,.85,.035,6,'#8b9493'));
    }
    for(const gateZ of AIRPORT_LAYOUT.gateZ){
      const bridge=boardingBridge(gateZ);
      // Enclosed boarding bridges stop at the passenger door; no public path crosses airside.
      cubes.push(box(x+bridge.x,y+BOARDING_LAYOUT.floor,z+bridge.z,bridge.w,.03,.38,"#d9d8ca"),box(x+bridge.x,y+BOARDING_LAYOUT.ceiling,z+bridge.z,bridge.w+.2,.04,.5,"#294237"));
      for(const side of [-1,1])cubes.push(box(x+5.1,y+.35,z+gateZ-.8+side*.2,3.2,.04,.02,"#456b73"));
      cubes.push(box(x+7,y+.065,z+gateZ, .035,.012,2.8,"#d6bd6e"),box(x+9.2,y+.065,z+gateZ,4.4,.01,.025,'#d6bd6e'));
      for(const side of [-1,1]){
       glass.push(box(x+bridge.x,y+BOARDING_LAYOUT.floor+.03,z+bridge.z+side*.2,bridge.w,.25,.02,'#ffffff'));
       for(let xx=BOARDING_LAYOUT.fromX;xx<bridge.x+bridge.w/2;xx+=.65)cubes.push(box(x+xx,y+BOARDING_LAYOUT.floor,z+bridge.z+side*.21,.035,.32,.035,'#c2ccc7'));
      }
      cubes.push(box(x+bridge.x+bridge.w/2-.15,y+.05,z+bridge.z,.09,.17,.09,'#c2c7be'));
    }
    for(const gz of AIRPORT_LAYOUT.gateZ)cubes.push(box(x+9.7,y+.05,z+gz+1.8,.05,2.35,.05,'#63786c'),box(x+9.7,y+2.4,z+gz+1.8,.3,.035,.08,'#63786c'));
    for(let px=4;px<10;px+=.4)cubes.push(box(x+px,y+.05,z+16.8,.035,.24,.035,"#294237"));
    cubes.push(box(x+7,y+.29,z+16.8,6,.035,.035,"#294237"));
    // Parallel taxiway and hold-short bars keep all waiting jets off the active runway.
    cubes.push(box(x+11.5,y+.07,z+8,.035,.012,19,"#d6bd6e"),box(x+13,y+.02,z+17.5,3,.04,.85,"#777f7f"));
    for(const zz of [17.2,17.4])cubes.push(box(x+13.6,y+.075,z+zz,.04,.015,.7,"#d6bd6e"));
    for(let i=0;i<16;i++)cubes.push(box(x+15,y+.065,z-2+i*1.2,.055,.012,.55,"#f4eedb"));
    for(const threshold of [-2.5,17.5])for(let i=0;i<5;i++)cubes.push(box(x+14.2+i*.4,y+.066,z+threshold,.14,.012,.65,"#f4eedb"));
    for(let i=0;i<22;i++)for(const side of [13.75,16.25])cubes.push(box(x+side,y+.04,z-2.5+i,.045,.06,.045,"#d0ad69"));
    return {glass,interiorLights,round,grass:[{p:[x+AIRPORT_LAYOUT.landX+AIRPORT_LAYOUT.landWidth/2,0,z+AIRPORT_LAYOUT.landZ+AIRPORT_LAYOUT.landDepth/2],s:[AIRPORT_LAYOUT.landWidth,y,AIRPORT_LAYOUT.landDepth]} as Inst],cubes,lamps:[...AIRPORT_LAYOUT.gateZ.map(gz=>({p:[x+9.7,y+2.45,z+gz+1.8],s:[.15,.04,.15]} as Inst)),...Array.from({length:22},(_,i)=>[13.75,16.25].map(dx=>({p:[a.x+dx,TERRACE_H+.11,a.z-2.5+i],s:[.025,.025,.025]} as Inst))).flat()]};
  },[a]);
  const circuit=useMemo(()=>a&&bounds?airportFlightCircuit(a,bounds,flightAltitude):undefined,[a,bounds,flightAltitude]);
  if(!a||!parts)return null;
  return <group position={a.west?[2*a.x+AIRPORT_LAYOUT.mirrorWidth,0,0]:[0,0,0]} scale={a.west?[-1,1,1]:[1,1,1]}>
    <Instanced items={parts.lamps} geometry={g.ball} material={m.lamp}/>
    <Instanced items={parts.grass} geometry={g.box} material={m.terrace}/>
    <Instanced items={parts.cubes} geometry={g.box} material={m.plain}/>
    <Instanced items={parts.glass} geometry={g.box} material={glazing} pick={{...pick,keys:parts.glass.map(()=>AIRPORT_KEY)}}/>
    <Instanced items={parts.interiorLights} geometry={g.box} material={m.glass}/>
    <Instanced items={parts.round} geometry={g.ball} material={m.plain}/>
    {[...AIRPORT_REMOTE_STANDS,{x:AIRPORT_LAYOUT.gateX,z:AIRPORT_LAYOUT.gateZ[0]},{x:AIRPORT_LAYOUT.gateX,z:AIRPORT_LAYOUT.gateZ[3]}].map((stand,i)=><group key={i} position={[a.x,TERRACE_H+.06,a.z]}><Aircraft g={g} m={m} clock={clock} slot={0} parked={stand} livery={liveryFor(i+2)}/></group>)}
    <AirportCampus a={a} g={g} m={m} pick={pick} night={night}/>
    <AirportSign x={a.x-.48} z={a.z+6} y={TERRACE_H+1.6}/>
    <BoardingActivity x={a.x} z={a.z} g={g} m={m}/>
    {Array.from({length:FLIGHT_SCHEDULE.count},(_,slot)=><group key={slot} position={[a.x,TERRACE_H+.06,a.z]}><Aircraft g={g} m={m} clock={clock} slot={slot} circuit={circuit} livery={liveryFor(slot)}/></group>)}
  </group>;
}

/** A single existing frame callback moves small boarding groups and two cargo vehicles. */
function BoardingActivity({x,z,g,m}:{x:number;z:number;g:Geometry;m:Materials}){
 const bodies=useMemo<Inst[]>(()=>Array.from({length:4},(_,j)=>({p:[j*.42,0,0],s:[.055,.15,.055],c:["#294237","#b8893b","#356386","#8a5d79"][j]})),[]);
 const heads=useMemo<Inst[]>(()=>bodies.map(p=>({p:[p.p[0],.2,p.p[2]],s:[.06,.06,.06],c:"#c5a580"})),[bodies]);
 return <>{[AIRPORT_LAYOUT.gateZ[0],AIRPORT_LAYOUT.gateZ[3]].map(gate=><group key={gate} position={[x+3.55,TERRACE_H+BOARDING_LAYOUT.floor+.03,z+gate+AIRCRAFT_LAYOUT.doorZ]}><Instanced items={bodies} geometry={g.box} material={m.plain}/><Instanced items={heads} geometry={g.ball} material={m.plain}/></group>)}</>;
}

function AirportSign({x,y,z}:{x:number;y:number;z:number}){
 const resources=useMemo(()=>{
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d')!;
  c.fillStyle='#edf0e9';c.fillRect(0,0,1024,256);c.fillStyle='#294237';c.font='500 112px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('ATLAS AIRPORT',512,130,970);c.fillStyle='#c9a35a';c.fillRect(0,237,1024,19);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const material=new THREE.MeshBasicMaterial({map,toneMapped:false,side:THREE.DoubleSide});const geometry=new THREE.PlaneGeometry(2,.5);return {map,material,geometry};
 },[]);
 useEffect(()=>()=>{resources.map.dispose();resources.material.dispose();resources.geometry.dispose();},[resources]);
 return <mesh position={[x,y,z]} rotation={[0,-Math.PI/2,0]} material={resources.material} geometry={resources.geometry} raycast={()=>null}/>;
}
