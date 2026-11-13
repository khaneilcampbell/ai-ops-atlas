import * as THREE from 'three';
import {AIRCRAFT_LAYOUT,AIRPORT_LAYOUT,AIRPORT_LANDING_RUNWAY,AIRPORT_TERMINAL} from '../map3d/airport';
import {AIRPORT_BUILDINGS} from '../map3d/airportBuildings';
import {GOLD_JET_PIVOT,GOLD_JET_SCALE,type GoldJetWorld} from '../map3d/goldJetPlan';
import {TERRACE_H} from '../map3d/scene';
import {JET_CABIN} from './goldJetInteriorPlan';

/**
 * The world outside the gold jet's cabin (Khaneil, 2026-11-13: "when inside the plane i want to be able to see the plane
 * when its moving and the outside graphics of the plane like the building the sky etc."). The cabin stays still on
 * screen and the airport, the city and the clouds move past it, following the jet's real pose on the map's loop.
 *
 * Cabin units are metres (nose +x, cutaway side +z, floor y 0). Map units are the map's own; the cabin is the drawn
 * jet blown up, so one map unit is CABIN_PER_MAP metres.
 */
export const CABIN_PER_MAP=(JET_CABIN.noseX-JET_CABIN.tailX)/(2*AIRCRAFT_LAYOUT.halfLength*GOLD_JET_SCALE);
/** The airliners on the map stand this high on the terraces (LogisticsAirport). */
export const AIRCRAFT_BASE_Y=TERRACE_H+.06;

export interface JetPose {x:number;y:number;z:number;yaw:number;pitch:number;roll:number}

/**
 * Cabin point -> map point, for the jet at `pose` (airport-local, as fleetPose gives it). Follows the map's own
 * transforms: the mirrored airport group on a west-facing campus, the aircraft group, the pose, the gold jet's scale
 * about its door, then the cabin turned so its nose (+x) points down the aircraft's nose (-z).
 */
export function cabinToMap(pose:JetPose,airport:{x:number;z:number;west?:boolean}):THREE.Matrix4{
 const m=new THREE.Matrix4(),t=new THREE.Matrix4();
 if(airport.west)m.makeTranslation(2*airport.x+AIRPORT_LAYOUT.mirrorWidth,0,0).multiply(t.makeScale(-1,1,1));
 m.multiply(t.makeTranslation(airport.x,AIRCRAFT_BASE_Y,airport.z));
 m.multiply(t.makeTranslation(pose.x,pose.y,pose.z));
 m.multiply(t.makeRotationFromEuler(new THREE.Euler(pose.pitch,pose.yaw,pose.roll,'YXZ')));
 // The scaled jet's centre and cabin floor (the door sill), about the forward door.
 const [px,,pz]=GOLD_JET_PIVOT;
 m.multiply(t.makeTranslation(px*(1-GOLD_JET_SCALE),AIRCRAFT_LAYOUT.doorY*GOLD_JET_SCALE,pz*(1-GOLD_JET_SCALE)));
 m.multiply(t.makeRotationY(Math.PI/2));
 m.multiply(t.makeScale(1/CABIN_PER_MAP,1/CABIN_PER_MAP,1/CABIN_PER_MAP));
 // A mirrored airport mirrors the jet too: flip the cabin across so the view outside isn't drawn back to front.
 if(airport.west)m.multiply(t.makeScale(1,1,-1));
 return m;
}
/** Map point -> cabin point: the matrix the outside world is drawn with, inside the cabin. */
export const mapToCabin=(pose:JetPose,airport:{x:number;z:number;west?:boolean})=>cabinToMap(pose,airport).invert();

export interface OutsideBox {x:number;y:number;z:number;w:number;h:number;d:number;c:string}
const TOWER_COLOURS=['#d9dde0','#b9c7d2','#e6dccb','#9fb1bf','#cfc6b6','#aebcc4'];
/** Map point for an airport-local point. */
const ap=(a:GoldJetWorld['airport'],x:number,z:number):[number,number]=>[a.x+(a.west?AIRPORT_LAYOUT.mirrorWidth-x:x),a.z+z];

/** Everything outside, as boxes in map coordinates: the land, the airfield, the terminal and the city's buildings. */
export function outsideBoxes(world:GoldJetWorld,night:boolean):{ground:OutsideBox[];buildings:OutsideBox[];windows:OutsideBox[]}{
 const {airport:a,bounds:b}=world,ground:OutsideBox[]=[],buildings:OutsideBox[]=[],windows:OutsideBox[]=[];
 const slab=(x:number,z:number,w:number,d:number,top:number,c:string,h=.04)=>ground.push({x,y:top-h/2,z,w,h,d,c});
 slab((b.x0+b.x1)/2,(b.z0+b.z1)/2,b.x1-b.x0+4,b.z1-b.z0+4,TERRACE_H-.01,night?'#2c3b31':'#8ea07a',2.4);
 const L=AIRPORT_LAYOUT,R=AIRPORT_LANDING_RUNWAY;
 {const [x,z]=ap(a,L.landX+L.landWidth/2,L.landZ+L.landDepth/2);slab(x,z,L.landWidth,L.landDepth,TERRACE_H+.005,night?'#34412e':'#9db07e');}
 for(const r of [{x:L.runwayX,z:L.runwayZ,w:L.runwayWidth,d:L.runwayLength},{x:R.x,z:R.z,w:R.width,d:R.length}]){
  const [x,z]=ap(a,r.x,r.z);slab(x,z,r.w,r.d,TERRACE_H+.02,night?'#22252a':'#4a4f55');
  // Centre-line dashes, so the runway visibly streams past on the takeoff roll.
  for(let dz=-r.d/2+1;dz<r.d/2-1;dz+=1.2)slab(x,z+dz,.06,.55,TERRACE_H+.025,'#f4eedb',.01);
 }
 {const [x,z]=ap(a,L.taxiX,(L.landZ+L.landZ+L.landDepth)/2);slab(x,z,.9,L.landDepth-6,TERRACE_H+.015,night?'#2a2d31':'#666b70');}
 {const [x,z]=ap(a,L.gateX-1.5,(L.gateZ[0]+L.gateZ[3])/2);slab(x,z,5,L.gateZ[3]-L.gateZ[0]+6,TERRACE_H+.012,night?'#2c2e31':'#9a9ea2');}
 for(const p of AIRPORT_BUILDINGS){const [x,z]=ap(a,p.x,p.z),h=p.id==='terminal'?AIRPORT_TERMINAL.roof:p.h;buildings.push({x,y:TERRACE_H+h/2,z,w:p.w,h,d:p.d,c:p.id==='terminal'?'#cfd6dc':'#e4ddd0'});}
 world.buildings.forEach((o,i)=>{if(o.h<.2)return;buildings.push({x:o.x,y:TERRACE_H+o.h/2,z:o.z,w:o.w,h:o.h,d:o.d,c:TOWER_COLOURS[i%TOWER_COLOURS.length]});
  // Window bands round each floor, so the towers read as buildings with storeys, not plain blocks.
  for(let y=.35;y<o.h-.2;y+=.48)windows.push({x:o.x,y:TERRACE_H+y,z:o.z,w:o.w+.03,h:.2,d:o.d+.03,c:night?(i+Math.round(y*3))%3?'#f2c46e':'#3a4658':'#4f6f8c'});});
 return {ground,buildings,windows};
}

/** Clouds around the city at and above the loop's height, in map coordinates (a fixed scatter). */
export function outsideClouds(world:GoldJetWorld,altitude:number):{x:number;y:number;z:number;s:number}[]{
 const {bounds:b}=world,cx=(b.x0+b.x1)/2,cz=(b.z0+b.z1)/2,r=Math.max(b.x1-b.x0,b.z1-b.z0);
 let seed=11;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 return Array.from({length:70},()=>({x:cx+(rnd()-.5)*r*2.4,z:cz+(rnd()-.5)*r*2.4,y:TERRACE_H+altitude*(.8+rnd()*1.3),s:1.2+rnd()*2.6}));
}
