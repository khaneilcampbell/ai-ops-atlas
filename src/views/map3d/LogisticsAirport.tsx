import {airportFlightCircuit,type WorldObstacle} from './flightClearance';
import * as THREE from "three";
import {MODELS,SCALE} from "./vehicleModels";
import AirportCampus from "./AirportCampus";
import {FLIGHT_SCHEDULE,fleetPose} from "./flightSchedule";
import {airportAnimationEnabled} from "./airportBuildings";
import {liveryFor,type Livery} from "./airlineLiveries";
import {terminalParts} from "./airportTerminal";
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
export function Airport({plan:a,g,m,pick,moving,bounds,flightAltitude,obstacles,night=false}:{night?:boolean;bounds?:{x0:number;z0:number;x1:number;z1:number};flightAltitude?:number;obstacles?:WorldObstacle[];plan?:AirportPlan;g:Geometry;m:Materials;pick:Pick;moving:boolean}) {
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
      // Entrance doors under the fan canopy.
      box(x-.42,y+.06,z+6,.05,.8,1.4,"#20372c"),
      box(x+15,y+.015,z+7.5,2.2,.045,21,"#2b3335"),
      box(x+7.35,y+.02,z+7,7.6,.035,20.8,"#969e9d"),
      box(x+11.5,y+.02,z+8,.85,.04,20,"#777f7f"),
      box(x+7.5,y+.02,z+18,7,.04,1.2,"#414a49"),
      box(x+2,y+.05,z+18,2.2,1.05,2,"#eadfc8"),
      box(x+2,y+1.1,z+18,2.5,.12,2.3,"#294237"),
    ];
    const glass:Inst[]=[],interiorLights:Inst[]=[],round:Inst[]=[];
    // Check-in islands and lounge seating inside the oval hall, lit from the ceiling at night.
    for(const zz of [3.4,5.2,6.8,8.6]){
     interiorLights.push(box(x+1.6,y+1.12,z+zz,2,.025,.12,'#fff2d1'),box(x+1.8,y+1.82,z+zz,1.6,.025,.12,'#fff2d1'));
     for(const xx of [1,2.3])cubes.push(box(x+xx,y+.06,z+zz,.44,.26,.28,'#294237'),box(x+xx,y+.32,z+zz+.11,.44,.22,.08,'#355f5b'));
    }
    for(const zz of [4,6,8])cubes.push(box(x+.2,y+.06,z+zz,.5,.4,.7,'#e8e5d9'),box(x+.2,y+.46,z+zz,.55,.04,.75,'#c9a35a'),box(x+.25,y+.5,z+zz,.04,.23,.25,'#254b58'));
    // Public arrivals forecourt and a separate landside display parking area.
    cubes.push(box(x+AIRPORT_TERMINAL.arrivalsX,y+.035,z+2.4,.64,.025,20,'#424b50'),box(x-.85,y+.04,z+5,.48,.05,13.4,'#e6d6b4')); // The oval car park itself is part of the terminal shapes.
    for(const [i,bay] of airportParkingBays().entries()){
     const px=x+bay.x,pz=z+bay.z,model=MODELS[i%2?'gwagon':'bmw'];
     for(const p of model.parts)cubes.push({p:[px+p.at[2]*SCALE,y+.065+p.at[1]*SCALE,pz-p.at[0]*SCALE],s:p.size.map(v=>v*SCALE) as [number,number,number],r:Math.PI/2,c:p.color??['#386b92','#e6e8e3','#303b40'][i%3]});
     for(const side of [-1,1])cubes.push(box(px+side*.32,y+.066,pz,.02,.008,.95,'#eee8d5'));
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
      cubes.push(box(x+bridge.x,y+BOARDING_LAYOUT.floor,z+bridge.z,bridge.w,.03,.38,"#d9d8ca"),box(x+bridge.x,y+BOARDING_LAYOUT.ceiling,z+bridge.z,bridge.w+.2,.04,.5,"#e9ebe6"));
      for(const side of [-1,1])cubes.push(box(x+5.1,y+.35,z+gateZ-.8+side*.2,3.2,.04,.02,"#456b73"));
      cubes.push(box(x+7,y+.065,z+gateZ, .035,.012,2.8,"#d6bd6e"));
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
  const circuit=useMemo(()=>a&&bounds?airportFlightCircuit(a,bounds,flightAltitude,obstacles):undefined,[a,bounds,flightAltitude,obstacles]);
  if(!a||!parts)return null;
  return <group position={a.west?[2*a.x+AIRPORT_LAYOUT.mirrorWidth,0,0]:[0,0,0]} scale={a.west?[-1,1,1]:[1,1,1]}>
    <Instanced items={parts.lamps} geometry={g.ball} material={m.lamp}/>
    <Instanced items={parts.grass} geometry={g.box} material={m.terrace}/>
    <Instanced items={parts.cubes} geometry={g.box} material={m.plain}/>
    <Instanced items={parts.glass} geometry={g.box} material={glazing} pick={{...pick,keys:parts.glass.map(()=>AIRPORT_KEY)}}/>
    <Instanced items={parts.interiorLights} geometry={g.box} material={m.glass}/>
    <Instanced items={parts.round} geometry={g.ball} material={m.plain}/>
    {[...AIRPORT_REMOTE_STANDS,{x:AIRPORT_LAYOUT.gateX,z:AIRPORT_LAYOUT.gateZ[0]},{x:AIRPORT_LAYOUT.gateX,z:AIRPORT_LAYOUT.gateZ[3]}].map((stand,i)=><group key={i} position={[a.x,TERRACE_H+.06,a.z]}><Aircraft g={g} m={m} clock={clock} slot={0} parked={stand} livery={liveryFor(i+2)}/></group>)}
    <TerminalShapes a={a} g={g} m={m} glazing={glazing} night={night}/>
    <AirportCampus a={a} g={g} m={m} pick={pick} night={night}/>
    <AirportSign x={a.x-.48} z={a.z+6} y={TERRACE_H+1.55} mirrored={a.west}/>
    <BoardingActivity x={a.x} z={a.z} g={g} m={m}/>
    {Array.from({length:FLIGHT_SCHEDULE.count},(_,slot)=><group key={slot} position={[a.x,TERRACE_H+.06,a.z]}><Aircraft g={g} m={m} clock={clock} slot={slot} circuit={circuit} livery={liveryFor(slot)}/></group>)}
  </group>;
}

/** The redesigned terminal, tower and car park: ten instanced draws sharing three extra geometries. */
function TerminalShapes({a,g,m,glazing,night}:{a:AirportPlan;g:Geometry;m:Materials;glazing:THREE.Material;night:boolean}){
 const res=useMemo(()=>{
  const disc=new THREE.CylinderGeometry(.5,.5,1,40).translate(0,.5,0);
  const flare=new THREE.CylinderGeometry(.5,.36,1,28).translate(0,.5,0);
  const tint=new THREE.MeshStandardMaterial({color:'#9ad2c4',roughness:.22,metalness:.15,emissive:'#f4d496',emissiveIntensity:0});
  return {disc,flare,tint};
 },[]);
 useEffect(()=>{res.tint.emissiveIntensity=night?.55:0;res.tint.color.set(night?'#c9dccf':'#9ad2c4');},[res,night]);
 useEffect(()=>()=>{res.disc.dispose();res.flare.dispose();res.tint.dispose();},[res]);
 const parts=useMemo(()=>terminalParts(a.x,TERRACE_H,a.z),[a]);
 return <>
  <Instanced items={parts.shell} geometry={g.box} material={m.plain}/>
  <Instanced items={parts.discs} geometry={res.disc} material={m.plain}/>
  <Instanced items={parts.domes} geometry={g.ball} material={m.plain}/>
  <Instanced items={parts.lines} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={parts.glassDiscs} geometry={res.disc} material={glazing} shadow={false}/>
  <Instanced items={parts.glassBoxes} geometry={g.box} material={glazing} shadow={false}/>
  <Instanced items={parts.cab} geometry={res.flare} material={glazing} shadow={false}/>
  <Instanced items={parts.tintBalls} geometry={g.ball} material={res.tint}/>
  <Instanced items={parts.tintDiscs} geometry={res.disc} material={res.tint}/>
  <Instanced items={parts.tintBoxes} geometry={g.box} material={res.tint}/>
 </>;
}

/** A single existing frame callback moves small boarding groups and two cargo vehicles. */
function BoardingActivity({x,z,g,m}:{x:number;z:number;g:Geometry;m:Materials}){
 const bodies=useMemo<Inst[]>(()=>Array.from({length:4},(_,j)=>({p:[j*.42,0,0],s:[.055,.15,.055],c:["#294237","#b8893b","#356386","#8a5d79"][j]})),[]);
 const heads=useMemo<Inst[]>(()=>bodies.map(p=>({p:[p.p[0],.2,p.p[2]],s:[.06,.06,.06],c:"#c5a580"})),[bodies]);
 return <>{[AIRPORT_LAYOUT.gateZ[0],AIRPORT_LAYOUT.gateZ[3]].map(gate=><group key={gate} position={[x+3.55,TERRACE_H+BOARDING_LAYOUT.floor+.03,z+gate+AIRCRAFT_LAYOUT.doorZ]}><Instanced items={bodies} geometry={g.box} material={m.plain}/><Instanced items={heads} geometry={g.ball} material={m.plain}/></group>)}</>;
}

function AirportSign({x,y,z,mirrored=false}:{x:number;y:number;z:number;mirrored?:boolean}){
 const resources=useMemo(()=>{
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d')!;
  c.fillStyle='#edf0e9';c.fillRect(0,0,1024,256);c.fillStyle='#294237';c.font='500 112px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('ATLAS AIRPORT',512,130,970);c.fillStyle='#c9a35a';c.fillRect(0,237,1024,19);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const material=new THREE.MeshBasicMaterial({map,toneMapped:false,side:THREE.DoubleSide});const geometry=new THREE.PlaneGeometry(2,.5);return {map,material,geometry};
 },[]);
 useEffect(()=>()=>{resources.map.dispose();resources.material.dispose();resources.geometry.dispose();},[resources]);
 // The west-facing campus is drawn mirrored; flip the sign back so it reads left to right.
 return <mesh position={[x,y,z]} rotation={[0,-Math.PI/2,0]} scale={[mirrored?-1:1,1,1]} material={resources.material} geometry={resources.geometry} raycast={()=>null}/>;
}
