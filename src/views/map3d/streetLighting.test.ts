import {it,expect} from 'vitest';
import {catalog} from '../../catalog';import {layoutMap,type GroupBy} from '../mapLayout';import {buildScene} from './scene';
import {planStreetLights,lightingObstacles,STREET_LIGHT,stadiumFloodPositions} from './streetLighting';
for(const group of ['none','district','status','tag'] as GroupBy[])it(`lights streets without blocking buildings in ${group}`,()=>{
 const s=buildScene(layoutMap(catalog,[],group)),lights=planStreetLights(s),boxes=lightingObstacles(s);
 expect(lights.length).toBeGreaterThan(40);expect(lights.length).toBeLessThanOrEqual(STREET_LIGHT.maxFixtures);expect(lights.some(p=>p.highway)).toBe(true);
 expect(lights.some(p=>p.x>s.hills!.x&&p.x<s.hills!.x+s.hills!.w&&p.z>s.hills!.z&&p.z<s.hills!.z+s.hills!.d),'Hills has street lighting').toBe(true);
 expect(lights.some(p=>p.x>s.financial!.x&&p.x<s.financial!.x+s.financial!.w&&p.z>s.financial!.z&&p.z<s.financial!.z+s.financial!.d),'Financial District has street lighting').toBe(true);
 for(const [i,p]of lights.entries()){expect(Number.isFinite(p.yaw)).toBe(true);expect(boxes.some(b=>Math.abs(p.x-b.x)<b.w/2+.12&&Math.abs(p.z-b.z)<b.d/2+.12)).toBe(false);for(const q of lights.slice(i+1))expect(Math.hypot(p.x-q.x,p.z-q.z)).toBeGreaterThanOrEqual(STREET_LIGHT.minSeparation);}
});
it('uses the existing four stadium floodlight mounts above the seating',()=>{const points=stadiumFloodPositions({x:0,z:0});expect(points).toHaveLength(4);expect(new Set(points.map(p=>p.join(','))).size).toBe(4);for(const [x,z]of points){expect(Math.abs(x-4)).toBeCloseTo(2.4);expect(Math.abs(z-3.5)).toBeCloseTo(2.3);}});
