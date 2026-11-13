import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {fleetPose} from '../map3d/flightSchedule';
import {GOLD_JET_SLOT,goldJetState,type GoldJetWorld} from '../map3d/goldJetPlan';
import {TERRACE_H} from '../map3d/scene';
import {AIRCRAFT_BASE_Y,CABIN_PER_MAP,cabinToMap,mapToCabin,outsideBoxes,outsideClouds} from './goldJetOutsidePlan';

const level={x:3,y:0,z:5,yaw:0,pitch:0,roll:0};
const world:GoldJetWorld={airport:{x:10,z:-4},bounds:{x0:-30,z0:-30,x1:40,z1:40},buildings:[{x:0,z:0,w:2,d:2,h:6},{x:5,z:5,w:1,d:1,h:.1}]};
const toMap=(m:THREE.Matrix4,x:number,y:number,z:number)=>new THREE.Vector3(x,y,z).applyMatrix4(m);

describe('the world outside the gold jet cabin',()=>{
 it('points the cabin nose down the aircraft heading, at the jet\'s place on the map',()=>{
  for(const yaw of [0,Math.PI/2,2.4]){
   const m=cabinToMap({...level,yaw},world.airport),c=toMap(m,0,0,0),nose=toMap(m,10,0,0).sub(c).normalize();
   // fleetPose yaw 0 faces -z; positive yaw turns the nose toward -x.
   expect(nose.x).toBeCloseTo(-Math.sin(yaw),5);expect(nose.z).toBeCloseTo(-Math.cos(yaw),5);
   expect(Math.hypot(c.x-(world.airport.x+level.x),c.z-(world.airport.z+level.z))).toBeLessThan(.2);
  }
 });
 it('keeps the cabin the jet\'s size and its floor just above the apron at the gate',()=>{
  const m=cabinToMap(level,world.airport);
  expect(toMap(m,23,0,0).distanceTo(toMap(m,-23,0,0))*CABIN_PER_MAP).toBeCloseTo(46,4);
  const floor=toMap(m,0,0,0).y;
  expect(floor).toBeGreaterThan(AIRCRAFT_BASE_Y);expect((floor-TERRACE_H)*CABIN_PER_MAP).toBeLessThan(6);
 });
 it('has the city climb away below the cabin as the jet climbs',()=>{
  const ground=(y:number)=>new THREE.Vector3(world.airport.x+3,TERRACE_H,world.airport.z+5).applyMatrix4(mapToCabin({...level,y},world.airport)).y;
  expect(ground(0)).toBeLessThan(0);expect(ground(8)).toBeLessThan(ground(0)-100);
 });
 it('is not drawn back to front on a west-facing (mirrored) airport',()=>{
  const m=cabinToMap(level,{...world.airport,west:true});
  expect(m.determinant()).toBeGreaterThan(0);
 });
 it('moves with the live flight: two moments on the loop put the world in different places',()=>{
  let t=0;while(goldJetState(t).stage!=='flight')t+=.5;
  const a=mapToCabin(fleetPose(t,GOLD_JET_SLOT),world.airport),b=mapToCabin(fleetPose(t+3,GOLD_JET_SLOT),world.airport);
  expect(new THREE.Vector3(0,TERRACE_H,0).applyMatrix4(a).distanceTo(new THREE.Vector3(0,TERRACE_H,0).applyMatrix4(b))).toBeGreaterThan(1);
 });
 it('draws the land, both runways, the airport buildings and the city\'s towers, plus clouds at height',()=>{
  const {ground,buildings}=outsideBoxes(world,false);
  expect(ground.length).toBeGreaterThan(10);
  expect(buildings.some(b=>b.x===0&&b.z===0&&b.h===6)).toBe(true);
  expect(buildings.some(b=>b.h===.1)).toBe(false);
  const clouds=outsideClouds(world,10);
  expect(clouds.length).toBeGreaterThan(20);expect(Math.min(...clouds.map(c=>c.y))).toBeGreaterThan(TERRACE_H+7);
 });
 it('is in the cabin view, with a window-seat view and wings outside',()=>{
  const src=readFileSync(new URL('./GoldJetInterior.tsx',import.meta.url),'utf8');
  expect(src).toContain('<GoldJetOutside night={isNight} reduced={reduced}/>');
  expect(src).toContain('<GoldJetSky night={isNight}/>');
  expect(src).toContain("'Window seat view'");
  expect(src).toContain('res.wing');
 });
});
