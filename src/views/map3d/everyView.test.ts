import {expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {MAP_LENSES} from '../../lib/lenses';
import {layoutMap,type GroupBy} from '../mapLayout';
import {anchorsOf} from './Map3D';
import {buildScene} from './scene';
import {AGENCY_KEY} from './marketingAgencyPlan';

// Every building on the map must be on the map, clickable, in every view. The scene is built from
// the layout alone, so the grouping is the only thing that can drop a building: the view menu
// (lenses) only filters connection lines, and day, night and the phone layout draw the same scene.
const GROUPINGS:GroupBy[]=['district','none','status','tag'];
// Skyline shop keys carry their park's id, which names the grouping (park:d:..., park:all:...), so
// they are compared by shop name.
const buildingsIn=(g:GroupBy)=>{const layout=layoutMap(catalog,[],g);return [...anchorsOf(buildScene(layout),layout).keys()].map(k=>k.replace(/^retail:park:.*:([^:]+)$/,'retail:$1')).sort();};

it('lenses filter lines only, so a grouping covers every view',()=>{
 expect(MAP_LENSES).toEqual(['infrastructure','agents','automations']);
});

it('shows the same buildings in every grouping',()=>{
 const all=buildingsIn('district');
 expect(all).toContain(AGENCY_KEY);
 for(const g of GROUPINGS.slice(1))expect(buildingsIn(g),`missing or extra in ${g} grouping`).toEqual(all);
});
