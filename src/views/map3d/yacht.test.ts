import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as THREE from 'three';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene,TERRACE_H,WATER_Y} from './scene';
import {marinaSite} from './marinaPlan';
import {YACHT,YACHT_OFFICE_ID,boardingRoute,routeLengths,yachtBerth,yachtFootprint} from './yachtPlan';
import {yachtGeometry} from './yachtGeometry';
import {ROOMS,peopleOnBoard,roomInsideHull,DECKS} from '../office/yachtInteriorPlan';

const scene=buildScene(layoutMap(catalog,[],'district')),marina=marinaSite(scene,TERRACE_H),berth=yachtBerth(marina);
const overlaps=(a:{x:number;z:number;w:number;d:number},b:{x:number;z:number;w:number;d:number})=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.z<b.z+b.d&&a.z+a.d>b.z;

describe('Atlas yacht berth',()=>{
 it('floats in open water off the marina, clear of the land and the marina stair', ()=>{
  const hull={x:berth.x-YACHT.length/2,z:berth.z-YACHT.beam/2,w:YACHT.length,d:YACHT.beam};
  for(const r of scene.land)expect(overlaps(hull,r),`land ${r.x},${r.z}`).toBe(false);
  // The stair and pier (and the cross dock's end lamps, 1.72 out from the pier) stay clear.
  expect(overlaps(hull,{x:marina.x-1.8,z:marina.pierZ-1.8,w:3.6,d:2.9})).toBe(false);
  expect(berth.pontoon.x0).toBeLessThan(marina.x+1.8);
  expect(berth.pontoon.x1).toBeGreaterThan(berth.x+YACHT.length/2);
 });
 it('leaves the harbour boats their lane south of the pontoon', ()=>{
  const b=scene.bounds,pad=4.6,curve=new THREE.CatmullRomCurve3([[b.x0-pad,b.z0-pad],[(b.x0+b.x1)/2,b.z0-pad*1.3],[b.x1+pad,b.z0-pad],[b.x1+pad*1.3,(b.z0+b.z1)/2],[b.x1+pad,b.z1+pad],[marina.x,marina.pierZ+1.4],[b.x0-pad,b.z1+pad],[b.x0-pad*1.3,(b.z0+b.z1)/2]].map(([x,z])=>new THREE.Vector3(x,0,z)),true,'centripetal');
  const south=berth.pontoon.z+berth.pontoon.w/2,fp=yachtFootprint(berth);
  for(let i=0;i<=4000;i++){const q=curve.getPointAt(i/4000);if(q.x>fp.x&&q.x<fp.x+fp.w&&q.z>marina.pierZ-3)expect(q.z).toBeGreaterThan(south);}
 });
 it('walks people from the promenade down the stair, along the dock and up the passerelle onto the aft deck', ()=>{
  const r=boardingRoute(marina,berth),{total}=routeLengths(r),deckY=WATER_Y+YACHT.hull.deck;
  expect(r[0]).toEqual([marina.x,TERRACE_H+.03,marina.cityWalkZ]);
  expect(r.at(-1)![1]).toBeCloseTo(deckY,1);
  expect(Math.abs(r.at(-1)![2]-berth.z)).toBeLessThan(YACHT.beam/2);
  expect(berth.gangway.y1).toBeGreaterThan(berth.gangway.y0);
  expect(berth.gangway.z0).toBeGreaterThan(berth.gangway.z1);
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
