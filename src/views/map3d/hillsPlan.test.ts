import {it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {HILLS as h,planHills} from './hillsPlan';
import {pathClear} from './roads';
for(const group of ['none','district','status','tag'] as GroupBy[])it(`connects a separate estate parcel in ${group} grouping`,()=>{
 const scene=buildScene(layoutMap(catalog,[],group)),a=scene.hills!;expect(a).toBeDefined();
 for(const r of scene.land.filter(r=>r.x!==a.x||r.z!==a.z))expect(a.x<r.x+r.w&&a.x+a.w>r.x&&a.z<r.z+r.d&&a.z+a.d>r.z).toBe(false);
 for(const b of [h.mansion,h.garage,h.pool,h.court]){expect(b.x-b.w/2).toBeGreaterThan(0);expect(b.x+b.w/2).toBeLessThan(a.w);expect(b.z-b.d/2).toBeGreaterThan(0);expect(b.z+b.d/2).toBeLessThan(a.d);}
 const boxes=[...scene.towers,...scene.kiosks,...scene.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));expect(pathClear(a.road,boxes,.3)).toBe(true);expect(pathClear(a.walk,boxes,.3)).toBe(true);
 expect(scene.carBridges.flatMap(b=>b.roads).flat()).toContainEqual(a.road[0]);expect(a.road.at(-1)).toEqual(a.drive[0]);expect(a.walk.at(-1)).toEqual(a.promenade[0]);
 expect(a.promenade.at(-1)).toEqual([a.x+h.mansion.x,a.z+h.mansion.z+h.mansion.d/2]);
 expect(Math.abs((a.x+10)-(a.x+13))).toBeGreaterThan(.65+.24);expect(h.court.playDepth/h.court.playWidth).toBeCloseTo(23.77/10.97,2);
 const shore=scene.terraces.reduce((best,p)=>p.z+p.d>best.z+best.d?p:best);if(shore){const dockX=shore.x+shore.w/2;expect(dockX<a.x-1||dockX>a.x+a.w+1,'estate leaves the existing dock approach clear').toBe(true);}
 expect(scene.transportConnections.some(l=>l.id==='atlas-hills')).toBe(true);
});
it('does not add an estate with disconnected streets',()=>expect(planHills({land:[],paving:[],carBridges:[],towers:[],kiosks:[],retail:[]})).toBeUndefined());
