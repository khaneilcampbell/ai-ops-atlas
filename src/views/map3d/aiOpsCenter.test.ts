import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {anchorsOf} from './Map3D';
import {FINANCIAL,financialKey} from './financialPlan';
import {financialDimensions} from './financialArchitecture';
import {AIOPS,AIOPS_KEY,CLEARED_FOR_AIOPS,PODIUM_H,aiOpsFootprint,floorElevation,planAiOps,presentAiOps,ribbonSpan,towerRing} from './aiOpsCenterPlan';
import {aiOpsGeometry,aiOpsTriangles} from './aiOpsCenterGeometry';
import {INTERIOR_HEIGHT,INTERIOR_K,interiorFloor} from '../office/aiOpsInteriorPlan';
import {WORKSPACE,hostOf,housedIn} from '../../modules/workspace';
import {LIBRARY_BUILDING} from '../../library/model';

const layout=layoutMap(catalog),planned=buildScene(layout),drawn=presentAiOps(planned);

describe('Atlas AI Operations Center (Khaneil, 2026-11-24)',()=>{
 it('replaces only the four waterfront towers on the drawn map; the planned scene keeps them',()=>{
  const ids=(s:typeof planned)=>s.financial!.buildings.map(b=>b.id);
  expect(ids(planned)).toEqual(expect.arrayContaining(['business-finance','insurance','financial-planning','harbor-residence']));
  expect(ids(drawn)).toEqual(ids(planned).filter(id=>!CLEARED_FOR_AIOPS.includes(financialKey(id))));
  expect(drawn.aiOps).toBeDefined();expect(planned.aiOps).toBeUndefined();
  // Streets, rail and the district outline are the planned scene's own.
  expect(drawn.communityRail).toBe(planned.communityRail);expect(drawn.financial!.street).toBe(planned.financial!.street);
 });

 it('stands on the cleared plot, clear of the street, the park, Circa and the remaining towers',()=>{
  const p=drawn.aiOps!,fd=drawn.financial!,s=p.site;
  expect(s.z+s.d/2).toBeLessThanOrEqual(fd.z+FINANCIAL.northWalkZ);
  expect(s.x+s.w/2).toBeLessThan(fd.x+FINANCIAL.park.x);
  for(const b of fd.buildings){const d=financialDimensions(b.id),x=fd.x+b.x,z=fd.z+b.z;expect(Math.abs(x-s.x)<(d.w+s.w)/2&&Math.abs(z-s.z)<(d.d+s.d)/2,b.id).toBe(false);}
  expect(p.height).toBeGreaterThan(Math.max(...planned.financial!.buildings.filter(b=>CLEARED_FOR_AIOPS.includes(financialKey(b.id))).map(b=>b.height)));
  for(const t of drawn.trees)expect(Math.abs(t.x-s.x)<s.w/2&&Math.abs(t.z-s.z)<s.d/2).toBe(false);
 });

 it('is one selectable building, and the replaced towers land on it',()=>{
  const a=anchorsOf(drawn,layout);
  expect(a.get(AIOPS_KEY)).toMatchObject({x:aiOpsFootprint(drawn.aiOps!).x});
  for(const k of CLEARED_FOR_AIOPS)expect(a.get(k)).toBe(a.get(AIOPS_KEY));
  expect(anchorsOf(planned,layout).has(AIOPS_KEY)).toBe(true);
 });

 it('keeps the model light and the ribbon on the tower, from the terrace to under the crown',()=>{
  const g=aiOpsGeometry(drawn.aiOps!.height);
  expect(aiOpsTriangles(g)).toBeLessThan(30000);
  expect(ribbonSpan(PODIUM_H,drawn.aiOps!.height)).toBeUndefined();
  for(let y=PODIUM_H+AIOPS.step.rise;y<drawn.aiOps!.height-1;y+=.5){const r=ribbonSpan(y,drawn.aiOps!.height)!;expect(r.to-r.from).toBeGreaterThan(.5);expect(r.to-r.from).toBeLessThan(1);}
  g.ribbonBack.computeBoundingBox();expect(g.ribbonBack.boundingBox!.max.y).toBeLessThan(drawn.aiOps!.height+AIOPS.crownSlope);
 });

 it('draws its interior from the exterior: same height, outlines and ribbon angles',()=>{
  expect(Math.abs(INTERIOR_HEIGHT-drawn.aiOps!.height)).toBeLessThan(.3);
  for(const level of [2,3,4]){
   const f=interiorFloor(level),y=floorElevation(level),ring=towerRing(y,INTERIOR_HEIGHT,1,64);
   f.outline.forEach(([x,z],i)=>{expect(x).toBeCloseTo(ring[i][0]*INTERIOR_K);expect(z).toBeCloseTo(ring[i][1]*INTERIOR_K);});
   expect(f.ribbon.length).toBeGreaterThan(0);
   for(const r of f.ribbon)expect(r).toMatchObject({from:ribbonSpan(r.y,INTERIOR_HEIGHT)!.from,to:ribbonSpan(r.y,INTERIOR_HEIGHT)!.to});
   expect(f.desks).toHaveLength(1);
  }
  expect(interiorFloor(0).drum).toBeDefined();expect(interiorFloor(1).desks).toHaveLength(1);
 });

 it('houses the four towers as its floors in the dashboard data; their records stay',()=>{
  for(const k of CLEARED_FOR_AIOPS)expect(hostOf(k),k).toBe(AIOPS_KEY);
  expect(housedIn(AIOPS_KEY).sort()).toEqual([...CLEARED_FOR_AIOPS].sort());
  expect(WORKSPACE.landmarks.find(l=>l.id==='ai-operations-center')?.moduleType).toBe('knowledge-repository');
  for(const id of ['financial:business-finance','financial:financial-planning'])expect(WORKSPACE.landmarks.some(l=>l.id===id),id).toBe(true);
  expect(LIBRARY_BUILDING).toBe(AIOPS_KEY);
  expect(planAiOps(planned)).toEqual(drawn.aiOps);
 });
});
