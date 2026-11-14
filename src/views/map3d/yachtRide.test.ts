import {describe,expect,it,beforeEach} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {WATER_Y} from './scene';
import {YACHT_SCALE,yachtBerth} from './yachtPlan';
import {TRAVEL,TRAVEL_CLOCK} from './travelLoops';
import {DECK_FLOOR,DECK_PER_MAP,YACHT_BOX,YACHT_METRES,cityFacing,deckToMap,openSide,decksShown,publishYacht,yachtBoundsAt,yachtCruiseState,yachtLive,yachtLivePose,yachtRideView} from './yachtRidePlan';
import {K} from '../office/yachtInteriorPlan';

const read=(path:string)=>readFileSync(join(__dirname,path),'utf8');
const berth=yachtBerth({x:2.5,pierZ:60.5,shoreZ:58.7,cityWalkZ:57.9} as Parameters<typeof yachtBerth>[0]);
const travel={lap:60,yacht:{berth,depart:10,back:10+TRAVEL.sail,period:240}};
const toMap=(m:THREE.Matrix4,x:number,y:number,z:number)=>new THREE.Vector3(x,y,z).applyMatrix4(m);

describe('the yacht can be selected wherever she is',()=>{
 beforeEach(()=>{TRAVEL_CLOCK.live=true;publishYacht(berth,travel);});
 it('is at her berth while moored and out at sea mid-cruise',()=>{
  TRAVEL_CLOCK.t=5;
  const moored=yachtLivePose()!;expect(moored.x).toBeCloseTo(berth.x,5);expect(moored.z).toBeCloseTo(berth.z,5);
  TRAVEL_CLOCK.t=10+TRAVEL.sail/2;
  const out=yachtLivePose()!;expect(Math.hypot(out.x-berth.x,out.z-berth.z)).toBeGreaterThan(10);
 });
 it('frames and outlines her where she is, turned to her heading',()=>{
  TRAVEL_CLOCK.t=10+TRAVEL.sail*.3;
  const p=yachtLivePose()!,b=yachtBoundsAt(p);
  expect(b.x).toBeCloseTo(p.x,5);expect(b.z).toBeCloseTo(p.z,5);
  expect(b.y1-b.y0).toBeCloseTo(YACHT_BOX.h,5);
  // Side-on (yaw a quarter turn) the flat box swaps length and beam.
  const turned=yachtBoundsAt({...p,yaw:Math.PI/2});expect(turned.w).toBeCloseTo(YACHT_BOX.d,5);expect(turned.d).toBeCloseTo(YACHT_BOX.w,5);
 });
 it('names each part of the cruise and counts down to the next sailing',()=>{
  expect(yachtCruiseState(TRAVEL.sail+30,240)).toMatchObject({stage:'berth',nextIn:240-TRAVEL.sail-30});
  expect(yachtCruiseState(1).stage).toBe('casting-off');
  expect(yachtCruiseState(TRAVEL.sail*.3).stage).toBe('outbound');
  expect(yachtCruiseState(TRAVEL.sail*.7).stage).toBe('homebound');
  expect(yachtCruiseState(TRAVEL.sail-1).stage).toBe('alongside');
  expect(yachtCruiseState(Infinity).stage).toBe('berth');
 });
 it('stays at the berth on maps without the travel loops',()=>{
  publishYacht(berth,undefined);TRAVEL_CLOCK.t=10+TRAVEL.sail/2;
  expect(yachtLivePose()).toMatchObject({x:berth.x,z:berth.z});
  expect(yachtLive.berth).toBe(berth);
 });
 it('moves her nameplate and outline with her and frames her live pose',()=>{
  const map=read('Map3D.tsx');
  expect(map).toContain('label.follow=');
  expect(map).toContain('if (key === YACHT_KEY) return yachtOutline();');
  expect(map).toContain('sailing ? yachtBoundsAt(sailing)');
  expect(read('AtlasYacht.tsx')).toContain('yachtLivePose()');
 });
});

describe('riding the yacht on the map',()=>{
 it('uses the interior scale and lays the decks at their real heights',()=>{
  expect(YACHT_METRES).toBeCloseTo(K,8);
  expect(DECK_PER_MAP).toBeCloseTo(K/YACHT_SCALE,8);
  expect(DECK_FLOOR[0]).toBeGreaterThan(0);
  for(let d=1;d<4;d++)expect(DECK_FLOOR[d]-DECK_FLOOR[d-1]).toBeCloseTo(3.19,1);
 });
 it('carries the decks with her: bow down her heading, at her place on the water',()=>{
  for(const yaw of [0,Math.PI/2,2.4]){
   const pose={x:4,z:70,yaw},m=deckToMap(pose),c=toMap(m,0,0,0),bow=toMap(m,10,0,0).sub(c).normalize();
   // The map yacht's group turns by rotation.y = yaw: bow +x turns toward -z.
   expect(bow.x).toBeCloseTo(Math.cos(yaw),5);expect(bow.z).toBeCloseTo(-Math.sin(yaw),5);
   expect(c.x).toBeCloseTo(4,5);expect(c.z).toBeCloseTo(70,5);expect(c.y).toBeCloseTo(WATER_Y,5);
   expect(toMap(m,29,0,0).distanceTo(toMap(m,-29,0,0))*DECK_PER_MAP).toBeCloseTo(58,4);
  }
 });
 it('frames her from the open starboard side, turns and zooms, and keeps the sun deck view standing on the sun deck',()=>{
  const all=yachtRideView(-1,false,0,0,1);expect(all.eye.z).toBeGreaterThan(40);expect(all.eye.y).toBeGreaterThan(DECK_FLOOR[3]);
  const zoomed=yachtRideView(-1,false,0,0,2);expect(zoomed.eye.distanceTo(zoomed.target)).toBeCloseTo(all.eye.distanceTo(all.target)*2,4);
  const turned=yachtRideView(-1,false,.8,0,1);expect(turned.target.distanceTo(all.target)).toBeLessThan(1e-9);expect(turned.eye.distanceTo(all.eye)).toBeGreaterThan(5);
  // Orbiting never drops below the water.
  expect(yachtRideView(-1,false,0,-3,1).eye.y).toBeGreaterThan(0);
  const sun=yachtRideView('sundeck',false,.6,.2,2),still=yachtRideView('sundeck',false,0,0,1);
  expect(sun.eye.distanceTo(still.eye)).toBeLessThan(1e-9);expect(sun.eye.y).toBeGreaterThan(DECK_FLOOR[3]);
  // One deck: the camera looks down at that deck, and the decks above are not drawn.
  const main=yachtRideView(1,false,0,0,1);expect(main.target.y).toBeCloseTo(DECK_FLOOR[1]+1,5);
  expect(decksShown(1)).toEqual([0,1]);expect(decksShown(-1)).toEqual([0,1,2,3]);expect(decksShown('sundeck')).toEqual([0,1,2,3]);
 });
 it('keeps the Atlas city in view wherever she is: the camera sits across her decks from it, the sun deck looks at it',()=>{
  const city={x:0,z:0};
  for(const pose of [{x:3,z:60,yaw:0},{x:-20,z:90,yaw:2.2},{x:25,z:75,yaw:-1.1},{x:0,z:-70,yaw:.4}]){
   const m=deckToMap(pose),toCity=new THREE.Vector3(city.x-pose.x,0,city.z-pose.z).normalize();
   const look=(v:{eye:THREE.Vector3;target:THREE.Vector3})=>{const e=toMap(m,v.eye.x,v.eye.y,v.eye.z),t=toMap(m,v.target.x,v.target.y,v.target.z);return new THREE.Vector3(t.x-e.x,0,t.z-e.z).normalize();};
   for(const view of [-1,2,'sundeck'] as const)expect(look(yachtRideView(view,false,cityFacing(view,false,pose,city),0,1)).dot(toCity),String(view)).toBeGreaterThan(.99);
   expect(look(yachtRideView(-1,true,cityFacing(-1,true,pose,city),0,1)).dot(toCity)).toBeGreaterThan(.99);
  }
 });
 it('opens the decks on the camera side, switching only once the camera is well round',()=>{
  const at=(yaw:number)=>yachtRideView(-1,false,yaw,0,1);
  expect(openSide(at(0),1)).toBe(1);expect(openSide(at(Math.PI),1)).toBe(-1);
  // Near the bow or stern it keeps the side it had.
  expect(openSide(at(Math.PI/2),1)).toBe(1);expect(openSide(at(Math.PI/2),-1)).toBe(-1);
 });
 it('follows the gold jet design rules inside: see-through overlay, map draws, quiet tags, no out-of-date panel text',()=>{
  const overlay=read('../office/YachtInterior.tsx'),ride=read('../office/YachtRide.tsx'),css=read('../../styles/yachtRide.css'),map=read('Map3D.tsx'),panel=read('../../components/DetailPanel.tsx');
  expect(overlay).toContain('yacht-interior riding');expect(overlay).not.toContain('<Canvas');
  expect(css).toMatch(/\.yacht-interior\.riding[^{]*\{[^}]*background:transparent/);
  expect(ride).toContain('className="ride-room-tag yacht"');expect(css).toMatch(/\.ride-room-tag\.yacht\{[^}]*pointer-events:none/);
  expect(map).toContain('officeId === YACHT_OFFICE_ID');expect(map).toContain('ridingYacht && <Suspense');
  expect(panel).not.toContain('does not sail');
 });
});
