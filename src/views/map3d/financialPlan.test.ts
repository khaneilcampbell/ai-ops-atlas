import {financialDimensions} from './financialArchitecture';
import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene,TERRACE_H} from './scene';
import {towerTop} from './models';
import {FINANCIAL as F,FINANCIAL_BUILDINGS,financialPark} from './financialPlan';
import {distanceToRoad} from './highway';
import {airportFootprint} from './airport';
import {pathClear} from './roads';
for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`plans ten clear connected high-rises in ${grouping} grouping`,()=>{
 const scene=buildScene(layoutMap(catalog,[],grouping)),f=scene.financial!;expect(f).toBeDefined();expect(f.buildings).toHaveLength(10);
 expect(f.buildings.find(b=>b.id==='budget')!.height).toBeCloseTo(f.referenceHeight*1.08);
 for(const r of scene.land.filter(r=>(r.x!==f.x||r.z!==f.z)&&r!==scene.land.find(l=>l.x===f.circa?.x&&l.z===f.circa?.z)))expect(f.x<r.x+r.w&&f.x+f.w>r.x&&f.z<r.z+r.d&&f.z+f.d>r.z).toBe(false);
 const tallest=Math.max(...scene.towers.map(t=>towerTop(t)-TERRACE_H));
 const boxes=f.buildings.map(b=>({x:f.x+b.x,z:f.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d}));
 for(let i=0;i<f.buildings.length;i++){const b=f.buildings[i];expect(b.height).toBeGreaterThan(tallest);expect(b.approach.at(-1)).toEqual([f.x+b.x,f.z+F.northWalkZ]);expect(pathClear(b.approach,boxes.filter((_,j)=>i!==j),.3)).toBe(true);if(b.id==='circa')continue;expect(b.x-F.towerWidth/2).toBeGreaterThan(0);expect(b.x+F.towerWidth/2).toBeLessThan(f.w);}
 // Original tower offsets stay fixed within the translated district; the expansion stays airport-ward.
 for(const b of f.buildings.slice(0,5)){const original=FINANCIAL_BUILDINGS.find(v=>v.id===b.id)!;expect(f.x+b.x).toBeCloseTo(f.originalX+original.x);}
 expect(f.x).toBeLessThan(f.originalX);
 const airportEdge=airportFootprint(scene.airport!).x;
 expect(Math.abs(f.x+12-airportEdge)).toBeLessThan(Math.abs(f.originalX+10-airportEdge));
 const park={x:f.x+f.park.x+f.park.w/2,z:f.z+f.park.z+f.park.d/2,w:f.park.w,d:f.park.d};
 for(const b of boxes)expect(Math.abs(b.x-park.x)<(b.w+park.w)/2&&Math.abs(b.z-park.z)<(b.d+park.d)/2).toBe(false);
 for(const path of f.park.paths){expect(pathClear(path,[{x:f.park.pool.x+f.park.pool.w/2,z:f.park.pool.z+f.park.pool.d/2,w:f.park.pool.w+.3,d:f.park.pool.d+.3}],.25)).toBe(true);}
 expect(f.park.paths[0][0][1]).toBe(F.northWalkZ);
 for(const p of [...f.park.trees,...f.park.benches,...f.park.lights]){for(const path of f.park.paths)expect(distanceToRoad(p,path)).toBeGreaterThan(f.park.trees.includes(p)?F.parkTreeRadius+.3:.35);}
 for(const p of f.perimeterTrees){const world:[number,number]=[f.x+p[0],f.z+p[1]];for(const b of f.buildings)expect(distanceToRoad(world,b.approach)).toBeGreaterThanOrEqual(F.perimeterTreeRadius+.35);expect(pathClear([world,[world[0]+.001,world[1]]],boxes,F.perimeterTreeRadius+.09)).toBe(true);}
 const apron=airportFootprint(scene.airport!);expect(f.x<apron.x+apron.w&&f.x+f.w>apron.x&&f.z<apron.z+apron.d&&f.z+f.d>apron.z).toBe(false);
 expect(pathClear(scene.freight!.route,[park,...boxes],.55)).toBe(true);
 for(const access of scene.freight!.access)expect(pathClear(access.collector,[park,...boxes],.3)).toBe(true);
 expect(pathClear(f.road,boxes,.3)).toBe(true);expect(pathClear(f.walk,boxes,.3)).toBe(true);
 expect(distanceToRoad(f.road.at(-1)!,f.street)).toBeLessThan(.001);expect(distanceToRoad(f.walk.at(-1)!,f.sidewalk)).toBeLessThan(.001);
 expect(scene.freight?.access.some(a=>a.id==='financial-district')).toBe(true);
});

describe('Financial Park central green',()=>{
 it('has a stepped fountain on the axis, gardens either side, and keeps planting off the paths',()=>{
  const p=financialPark();
  expect(p.pools.length).toBe(4);
  for(let i=1;i<p.pools.length;i++){expect(p.pools[i].rise).toBeLessThan(p.pools[i-1].rise);expect(p.pools[i].z).toBeGreaterThan(p.pools[i-1].z+p.pools[i-1].d);}
  for(const q of p.pools){expect(q.x).toBeGreaterThanOrEqual(p.pool.x);expect(q.z+q.d).toBeLessThanOrEqual(p.pool.z+p.pool.d+1e-9);}
  expect(p.rings.filter(r=>r.x<20).length).toBe(2);expect(p.rings.filter(r=>r.x>20).length).toBe(2);
  for(const [x,z,r]of p.shrubs)for(const path of p.paths)expect(distanceToRoad([x,z],path)).toBeGreaterThan(r+.2);
  for(const b of p.beds)for(const path of p.paths)expect(distanceToRoad([b.x+b.w/2,b.z+b.d/2],path)).toBeGreaterThan(b.w/2+.2);
  for(const r of p.rings)for(const path of p.paths)expect(distanceToRoad([r.x,r.z],path)).toBeGreaterThan(r.r+.25);
 });
});
