import {expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene,LAND_TOP,TERRACE_H} from './scene';

// One ground plane (Khaneil, 2026-11-07): open land is level with the terraces, streets and stations.
it('keeps open land a hair under the terrace tops, so they meet without a step or flicker',()=>{
 expect(TERRACE_H-LAND_TOP).toBeGreaterThan(0);expect(TERRACE_H-LAND_TOP).toBeLessThan(.01);
});
for(const g of ['none','district','status','tag'] as GroupBy[])it(`plants nothing below the ground plane and builds no freight trunk road: ${g}`,()=>{
 const s=buildScene(layoutMap(catalog,[],g));
 expect(s.freight).toBeUndefined();
 for(const p of [...s.trees,...s.bushes,...s.ponds])expect(p.y).toBeGreaterThanOrEqual(LAND_TOP-1e-9);
});
