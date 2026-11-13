import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as THREE from 'three';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene,TERRACE_H,WATER_Y} from './scene';
import {marinaSite} from './marinaPlan';
import {YACHT,YACHT_OFFICE_ID,YACHT_SCALE,YACHT_DECK_Y,boardingRoute,harbourLoop,routeLengths,yachtBerth,yachtFootprint} from './yachtPlan';
import {yachtGeometry} from './yachtGeometry';
import {ROOMS,peopleOnBoard,roomInsideHull,DECKS} from '../office/yachtInteriorPlan';

const scene=buildScene(layoutMap(catalog,[],'district')),marina=marinaSite(scene,TERRACE_H),berth=yachtBerth(marina);
const overlaps=(a:{x:number;z:number;w:number;d:number},b:{x:number;z:number;w:number;d:number})=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.z<b.z+b.d&&a.z+a.d>b.z;

describe('Atlas yacht berth',()=>{
 it('floats in open water off the marina, clear of the land and the marina stair', ()=>{
  const L=YACHT.length*YACHT_SCALE,B=YACHT.beam*YACHT_SCALE,hull={x:berth.x-L/2,z:berth.z-B/2,w:L,d:B};
  for(const r of scene.land)expect(overlaps(hull,r),`land ${r.x},${r.z}`).toBe(false);
  // The stair and pier (and the cross dock's end lamps, 1.72 out from the pier) stay clear.
  expect(overlaps(hull,{x:marina.x-1.8,z:marina.pierZ-1.8,w:3.6,d:2.9})).toBe(false);
  expect(berth.pontoon.x0).toBeLessThan(marina.x+1.8);
  expect(berth.pontoon.x1).toBeGreaterThan(berth.x+L/2);
  // On the open-water side of the pontoon.
  expect(hull.z).toBeGreaterThan(berth.pontoon.z+berth.pontoon.w/2);
 });
 it('sends the harbour boats round her: no boat passes through the hull, the pontoon or the passerelle', ()=>{
  const curve=new THREE.CatmullRomCurve3(harbourLoop(scene.bounds,marina,berth).map(([x,z])=>new THREE.Vector3(x,0,z)),true,'centripetal');
  const fp=yachtFootprint(berth),boat=.35;
  for(let i=0;i<=8000;i++){const q=curve.getPointAt(i/8000);const inside=q.x>fp.x-boat&&q.x<fp.x+fp.w+boat&&q.z>fp.z-boat&&q.z<fp.z+fp.d+boat;expect(inside,`${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBe(false);}
  // Boats still reach the cross dock.
  let near=Infinity;for(let i=0;i<=8000;i++){const q=curve.getPointAt(i/8000);near=Math.min(near,Math.hypot(q.x-marina.x,q.z-(marina.pierZ+1.4)));}
  expect(near).toBeLessThan(.05);
 });
 it('walks people from the promenade down the stair, along the dock and up the passerelle onto the aft deck', ()=>{
  const r=boardingRoute(marina,berth),{total}=routeLengths(r),deckY=WATER_Y+YACHT_DECK_Y;
  expect(r[0]).toEqual([marina.x,TERRACE_H+.03,marina.cityWalkZ]);
  expect(r.at(-1)![1]).toBeCloseTo(deckY,1);
  expect(Math.abs(r.at(-1)![2]-berth.z)).toBeLessThan(YACHT.beam*YACHT_SCALE/2);
  expect(berth.gangway.y1).toBeGreaterThan(berth.gangway.y0);
  expect(berth.gangway.z1).toBeGreaterThan(berth.gangway.z0);
  expect(total).toBeGreaterThan(5);
 });
});

describe('Atlas yacht model',()=>{
 it('stays inside a small triangle budget and has no broken vertices', ()=>{
  const g=yachtGeometry();let tris=0;
  for(const v of Object.values(g)){const p=v.getAttribute('position');tris+=p.count/3;for(let i=0;i<p.array.length;i++)expect(Number.isFinite(p.array[i])).toBe(true);}
  expect(tris).toBeLessThan(6000);
 });
});

describe('Inside Atlas',()=>{
 it('has all four decks and every room fits inside the hull', ()=>{
  expect(DECKS).toHaveLength(4);
  for(const d of [0,1,2,3])expect(ROOMS.some(r=>r.deck===d),`deck ${d}`).toBe(true);
  for(const r of ROOMS)expect(roomInsideHull(r),r.id).toBe(true);
 });
 it('puts people in real rooms on every deck, and no agents', ()=>{
  const people=peopleOnBoard();
  for(const p of people)expect(ROOMS.some(r=>r.id===p.room&&r.deck===p.deck&&p.x>=r.x0&&p.x<=r.x1&&p.z>=r.z0&&p.z<=r.z1),p.room).toBe(true);
  for(const d of [0,1,2,3])expect(people.some(p=>p.deck===d)).toBe(true);
 });
 it('is reached from the panel and routed before the generic interiors', ()=>{
  const panel=readFileSync(join(__dirname,'../../components/DetailPanel.tsx'),'utf8');expect(panel).toContain('<EnterBuildingButton id={YACHT_OFFICE_ID}/>');
  const map=readFileSync(join(__dirname,'../Map.tsx'),'utf8');expect(map).toContain('lazy(() => import("./office/YachtInterior"))');
  expect(map.indexOf('YACHT_OFFICE_ID ?')).toBeLessThan(map.indexOf('startsWith("skyline-business:") ?'));
  expect(YACHT_OFFICE_ID.startsWith('skyline-business:')).toBe(true);
 });
});
