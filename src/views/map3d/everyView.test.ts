import {expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {MAP_LENSES} from '../../lib/lenses';
import {layoutMap,type GroupBy} from '../mapLayout';
import {anchorsOf} from './Map3D';
import {buildScene} from './scene';
import {AGENCY_KEY} from './marketingAgencyPlan';
import {GALLERIA_KEY} from './galleriaPlan';

// Every building on the map must be on the map, clickable, in every view. The scene is built from
// the layout alone, so the grouping is the only thing that can drop a building: the view menu
// (lenses) only filters connection lines, and day, night and the phone layout draw the same scene.
const GROUPINGS:GroupBy[]=['district','none','status','tag'];
const buildingsIn=(g:GroupBy)=>{const layout=layoutMap(catalog,[],g);return [...anchorsOf(buildScene(layout),layout).keys()].sort();};

it('lenses filter lines only, so a grouping covers every view',()=>{
 expect(MAP_LENSES).toEqual(['infrastructure','agents','automations']);
});

it('shows the same buildings in every grouping',()=>{
 const all=buildingsIn('district');
 expect(all).toContain(AGENCY_KEY);
 expect(all).toContain(GALLERIA_KEY);
 // The Atlas Galleria stands on the green behind the Marketplace. Only the district layout (the
 // default) leaves that lot; the other layouts butt the Marketplace against other land or put a
 // station stair there, so the Galleria is left out rather than squeezed onto it.
 const rest=all.filter(k=>k!==GALLERIA_KEY);
 for(const g of GROUPINGS.slice(1))expect(buildingsIn(g).filter(k=>k!==GALLERIA_KEY),`missing or extra in ${g} grouping`).toEqual(rest);
});
