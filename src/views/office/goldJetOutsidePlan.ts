import * as THREE from 'three';
import {AIRCRAFT_LAYOUT,AIRPORT_LAYOUT} from '../map3d/airport';
import {GOLD_JET_PIVOT,GOLD_JET_SCALE} from '../map3d/goldJetPlan';
import {TERRACE_H} from '../map3d/scene';
import {JET_CABIN} from './goldJetInteriorPlan';

/**
 * Where the gold jet's cabin sits on the map (Khaneil, 2026-11-13: see the plane moving and the real Atlas city, sky
 * and other planes from inside). The cabin is drawn in the map's own scene at the jet's live pose, and the map camera
 * rides in it (GoldJetRide).
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

/** Where the camera sits and looks, in cabin metres, for each view. */
const VIEWS={
 /** Low enough to see the horizon and the city past the cabin, high enough to look into every room. */
 cutaway:{eye:new THREE.Vector3(6,24,60),target:new THREE.Vector3(0,0,0)},
 /** A portrait phone can't fit the cabin side-on, so it looks down the cabin's length from behind the tail. */
 phone:{eye:new THREE.Vector3(-46,30,26),target:new THREE.Vector3(3,-4,0)},
 /** Window seat up front: just behind the flight deck, looking out past the nose and down at the city ahead. */
 window:{eye:new THREE.Vector3(20.5,3,.4),target:new THREE.Vector3(60,-14,-6)},
};
const UP=new THREE.Vector3(0,1,0);
/** The camera's eye and target in cabin metres: the view's base, turned by the overlay's yaw and pitch and zoomed. */
export function rideView(view:'cutaway'|'window',portrait:boolean,yaw:number,pitch:number,zoom:number){
 const base=view==='window'?VIEWS.window:portrait?VIEWS.phone:VIEWS.cutaway;
 // Cutaway: the eye orbits the cabin. Window: the eye stays in the seat and the look turns.
 const pivot=view==='window'?base.eye:base.target,other=view==='window'?base.target:base.eye;
 const v=other.clone().sub(pivot).applyAxisAngle(UP,yaw),side=v.clone().cross(UP).normalize();
 const elev=Math.asin(Math.max(-1,Math.min(1,v.y/v.length())));
 const p=Math.max(-.35-elev,Math.min(1.35-elev,pitch));
 v.applyAxisAngle(side,p).multiplyScalar(view==='window'?1:zoom);
 return view==='window'?{eye:pivot.clone(),target:pivot.clone().add(v)}:{eye:pivot.clone().add(v),target:pivot.clone()};
}
