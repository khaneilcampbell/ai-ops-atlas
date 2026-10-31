import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {towerTop} from './models';
import {LOBBY_DOOR,LOBBY_SIGN,podiumTop,RIBBON,footprint,isRibbonTower,portalGap,ribbonHeights,ribbonPieceCount,ringsAt,waist} from './ribbonTowerPlan';
import {ribbonGeometry,ribbonTriangles} from './ribbonTowerGeometry';

describe('Benjaire HQ ribbon tower',()=>{
 it('is Benjaire HQ only',()=>{
  expect(isRibbonTower('benjaire-site')).toBe(true);expect(isRibbonTower('ai-ops-atlas')).toBe(false);
  const scene=buildScene(layoutMap(catalog,[],'district'));
  expect(scene.towers.find(t=>isRibbonTower(t.projectId))?.name).toBe('Benjaire HQ');
 });
 it('stays on its old plinth, so the plaza, kiosks, roads and links stay put',()=>{
  for(const k of [.8,1,1.2])for(const [x,z] of footprint(k)){expect(Math.abs(x)).toBeLessThanOrEqual(RIBBON.plinth*k);expect(Math.abs(z)).toBeLessThanOrEqual(RIBBON.plinth*k);}
 });
 it('opens a sky portal through the upper middle and closes it above and below',()=>{
  expect(portalGap(.3)).toBe(0);expect(portalGap(.9)).toBe(0);expect(portalGap((RIBBON.portal.from+RIBBON.portal.to)/2)).toBeCloseTo(RIBBON.portal.width);
  expect(ringsAt(.3)).toHaveLength(1);expect(ringsAt(.62)).toHaveLength(2);
  // Pinched waists: the plan swells and narrows up the tower.
  const w=Array.from({length:21},(_,i)=>waist(i/20));expect(Math.max(...w)-Math.min(...w)).toBeGreaterThan(.12);
  expect(ribbonHeights().length).toBeGreaterThan(36);
 });
 it('stays under Atlas HQ and the Financial District towers',()=>{
  for(const grouping of ['none','district','status','tag'] as GroupBy[]){
   const scene=buildScene(layoutMap(catalog,[],grouping)),b=scene.towers.find(t=>isRibbonTower(t.projectId))!,atlas=scene.towers.find(t=>t.identity.landmark)!;
   expect(towerTop(b)).toBeLessThan(towerTop(atlas));
   for(const f of scene.financial?.buildings??[])expect(f.height).toBeGreaterThan(towerTop(b));
  }
 });
 it('stays inside its performance budget: merged meshes, a few instances, no lights',()=>{
  const p=ribbonPieceCount();expect(p.meshes).toBeLessThanOrEqual(12);expect(p.instances).toBeLessThan(12);
  // At the tallest the city scale can make it (half again the reference drawing's height and more).
  const g=ribbonGeometry(1,RIBBON.height*2);
  for(const v of Object.values(g))if(v&&typeof v==='object'&&'attributes' in v)expect((v as {attributes:{position?:unknown}}).attributes.position).toBeDefined();
  expect(ribbonTriangles(g)).toBeLessThan(50000);
  const source=readFileSync(join(__dirname,'RibbonTower.tsx'),'utf8');
  expect(source).not.toMatch(/<(point|spot|directional|ambient|hemisphere|rectArea)Light/);expect(source).not.toMatch(/useFrame/);
  // The lightest quality level drops every other ribbon.
  expect(source).toMatch(/quality<3&&<mesh geometry=\{geo\.ribbonsOdd\}/);
  expect(readdirSync(__dirname).filter(f=>/^ribbontower/i.test(f)).length).toBeGreaterThanOrEqual(3);
 });
 it('has a Financial District size lobby entrance, with the sign above the doors',()=>{
  // Financial District doors are 0.7 wide and 0.55 tall.
  expect(LOBBY_DOOR.width).toBeCloseTo(.7);expect(LOBBY_DOOR.height).toBeCloseTo(.55);
  expect(podiumTop(0)).toBeGreaterThan(LOBBY_DOOR.height+.2);
  const signH=LOBBY_SIGN.width/LOBBY_SIGN.aspect;
  expect(LOBBY_SIGN.y-signH/2).toBeGreaterThan(LOBBY_DOOR.height);expect(LOBBY_SIGN.y+signH/2).toBeLessThan(podiumTop(0));
 });
});
