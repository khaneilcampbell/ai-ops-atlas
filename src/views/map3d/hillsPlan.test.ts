import {it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {planHills} from './hillsPlan';
for(const group of ['none','district','status','tag'] as GroupBy[])it(`removes the estate while preserving marketplace access in ${group} grouping`,()=>{
 const scene=buildScene(layoutMap(catalog,[],group));
 expect(scene.hills).toBeUndefined();expect(scene.community).toBeUndefined();
 expect(scene.transportConnections.some(l=>l.id==='atlas-hills')).toBe(false);
 expect(scene.transportConnections.some(l=>l.id==='marketplace-city-boulevard')).toBe(true);
 expect(scene.mall).toBeDefined();expect(scene.communityRail).toBeDefined();

});
it('does not add an estate with disconnected streets',()=>expect(planHills({land:[],paving:[],carBridges:[],towers:[],kiosks:[]})).toBeUndefined());
