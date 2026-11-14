import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {FIGURE,figureParts,hideGait,newGait,stepGait} from './walkerFigure';

const parts=()=>({torso:new THREE.Matrix4(),head:new THREE.Matrix4(),legs:[new THREE.Matrix4(),new THREE.Matrix4()] as [THREE.Matrix4,THREE.Matrix4],arms:[new THREE.Matrix4(),new THREE.Matrix4()] as [THREE.Matrix4,THREE.Matrix4]});
// Ends of a lifted unit box part: its base (local 0) and top (local 1).
const ends=(m:THREE.Matrix4)=>[new THREE.Vector3(0,0,0).applyMatrix4(m),new THREE.Vector3(0,1,0).applyMatrix4(m)];

describe('walking figures',()=>{
 it('stands on its feet with legs to the hips, arms from the shoulders and the head on top',()=>{
  const p=figureParts(2,1,3,0,0,parts());
  for(const leg of p.legs){const [foot,hip]=ends(leg);expect(foot.y).toBeCloseTo(1,6);expect(hip.y).toBeCloseTo(1+FIGURE.leg.h,6);}
  for(const arm of p.arms){const [hand,shoulder]=ends(arm);expect(shoulder.y).toBeCloseTo(1+FIGURE.arm.y,6);expect(hand.y).toBeCloseTo(1+FIGURE.arm.y-FIGURE.arm.h,6);}
  expect(ends(p.legs[0])[0].x).toBeLessThan(2);expect(ends(p.legs[1])[0].x).toBeGreaterThan(2);
  expect(new THREE.Vector3().setFromMatrixPosition(p.head).y).toBeCloseTo(1+FIGURE.head.y,6);
 });

 it('swings each leg against the other and each arm against its leg, pivoting at hips and shoulders',()=>{
  const p=figureParts(0,0,0,Math.PI/3,1,parts());
  const [l,r]=p.legs.map(m=>ends(m)),[la,ra]=p.arms.map(m=>ends(m));
  // Hips and shoulders stay put; feet and hands move in opposite directions along the walk.
  const fwd=new THREE.Vector3(Math.sin(Math.PI/3),0,Math.cos(Math.PI/3));
  expect(l[1].y).toBeCloseTo(FIGURE.leg.h,6);expect(la[1].y).toBeCloseTo(FIGURE.arm.y,6);
  expect(l[0].dot(fwd)*r[0].dot(fwd)).toBeLessThan(0);
  expect(l[0].dot(fwd)*la[0].dot(fwd)).toBeLessThan(0);
  expect(r[0].dot(fwd)*ra[0].dot(fwd)).toBeLessThan(0);
 });

 it('strides while walking, settles when standing, and starts still after being out of sight',()=>{
  const g=newGait();let swing=0,max=0;
  for(let t=0;t<40;t++){swing=stepGait(g,t*.06,0,.1);max=Math.max(max,Math.abs(swing));}
  expect(max).toBeGreaterThan(.5);
  for(let t=0;t<30;t++)swing=stepGait(g,2.34,0,.1);
  expect(Math.abs(swing)).toBeLessThan(.01);
  hideGait(g);expect(stepGait(g,50,50,.1)).toBe(0);
 });
});
