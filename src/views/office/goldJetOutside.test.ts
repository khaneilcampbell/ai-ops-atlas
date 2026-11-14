import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {fleetPose} from '../map3d/flightSchedule';
import {GOLD_JET_SLOT,goldJetState} from '../map3d/goldJetPlan';
import {TERRACE_H} from '../map3d/scene';
import {AIRCRAFT_BASE_Y,CABIN_PER_MAP,cabinToMap,rideView} from './goldJetOutsidePlan';

const level={x:3,y:0,z:5,yaw:0,pitch:0,roll:0};
const airport={x:10,z:-4};
const toMap=(m:THREE.Matrix4,x:number,y:number,z:number)=>new THREE.Vector3(x,y,z).applyMatrix4(m);
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

describe('riding the gold jet on the map',()=>{
 it('points the cabin nose down the aircraft heading, at the jet\'s place on the map',()=>{
  for(const yaw of [0,Math.PI/2,2.4]){
   const m=cabinToMap({...level,yaw},airport),c=toMap(m,0,0,0),nose=toMap(m,10,0,0).sub(c).normalize();
   // fleetPose yaw 0 faces -z; positive yaw turns the nose toward -x.
   expect(nose.x).toBeCloseTo(-Math.sin(yaw),5);expect(nose.z).toBeCloseTo(-Math.cos(yaw),5);
   expect(Math.hypot(c.x-(airport.x+level.x),c.z-(airport.z+level.z))).toBeLessThan(.2);
  }
 });
 it('keeps the cabin the jet\'s size and its floor just above the apron at the gate',()=>{
  const m=cabinToMap(level,airport);
  expect(toMap(m,23,0,0).distanceTo(toMap(m,-23,0,0))*CABIN_PER_MAP).toBeCloseTo(46,4);
  const floor=toMap(m,0,0,0).y;
  expect(floor).toBeGreaterThan(AIRCRAFT_BASE_Y);expect((floor-TERRACE_H)*CABIN_PER_MAP).toBeLessThan(6);
 });
 it('climbs with the jet and is not drawn back to front on a west-facing (mirrored) airport',()=>{
  expect(toMap(cabinToMap({...level,y:8},airport),0,0,0).y-toMap(cabinToMap(level,airport),0,0,0).y).toBeCloseTo(8,5);
  expect(cabinToMap(level,{...airport,west:true}).determinant()).toBeGreaterThan(0);
 });
 it('moves with the live flight: two moments on the loop put the cabin in different places',()=>{
  let t=0;while(goldJetState(t).stage!=='flight')t+=.5;
  const a=toMap(cabinToMap(fleetPose(t,GOLD_JET_SLOT),airport),0,0,0),b=toMap(cabinToMap(fleetPose(t+3,GOLD_JET_SLOT),airport),0,0,0);
  expect(a.distanceTo(b)).toBeGreaterThan(.05);
 });
 it('frames the cabin from outside, turns and zooms it, and keeps the window seat in its seat',()=>{
  const base=rideView('cutaway',false,0,0,1);
  expect(base.eye.y).toBeGreaterThan(5);expect(base.eye.z).toBeGreaterThan(20);
  const far=rideView('cutaway',false,0,0,2);
  expect(far.eye.distanceTo(far.target)).toBeCloseTo(2*base.eye.distanceTo(base.target),5);
  const turned=rideView('cutaway',false,Math.PI/2,0,1);
  expect(turned.eye.distanceTo(turned.target)).toBeCloseTo(base.eye.distanceTo(base.target),5);
  // Tilting as far as it goes stops a little below level: at most about 20 degrees under the cabin.
  const low=rideView('cutaway',false,0,-9,1);expect(low.eye.y/low.eye.distanceTo(low.target)).toBeGreaterThan(-.36);
  const seat=rideView('window',false,0,0,1),look=rideView('window',false,1,.3,3);
  expect(look.eye.equals(seat.eye)).toBe(true);expect(look.target.equals(seat.target)).toBe(false);
  // Up front, looking out ahead of the nose and down.
  expect(seat.target.x).toBeGreaterThan(seat.eye.x);expect(seat.target.y).toBeLessThan(seat.eye.y);
 });
 it('rides inside the map: the map keeps drawing, hides its own gold jet and leaves its controls alone meanwhile',()=>{
  const map=read('../map3d/Map3D.tsx'),airportSrc=read('../map3d/LogisticsAirport.tsx'),ride=read('./GoldJetRide.tsx'),inside=read('./GoldJetInterior.tsx');
  expect(map).toContain('officeId === GOLD_JET_OFFICE_ID');
  expect(map).toContain('if (!goldJetRide.active) controls.update();');
  expect(map).toContain('<GoldJetRide plan={scene.airport}');
  expect(airportSrc).toContain('!(gold&&goldJetRide.active)');
  expect(ride).toContain('controls.enabled=false');
  expect(ride).toContain('className="gold-jet-room-tag"');
  expect(inside).not.toContain('<Canvas');
  expect(inside).toContain("'Window seat view'");
 });
});
