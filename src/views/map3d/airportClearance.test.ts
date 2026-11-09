import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {airportTrafficKeepOut,BOARDING_LAYOUT} from './airport';
import {TERMINAL_PIER} from './airportTerminal';
import {pathClear} from './roads';
describe('airport public traffic clearance',()=>{
 it('restores the original low boarding gallery',()=>{expect(TERMINAL_PIER.floor).toBe(.2);expect(BOARDING_LAYOUT.floor).toBe(.22);expect(TERMINAL_PIER.width).toBe(.7);});
 for(const grouping of ['district','status','tag','none'] as const)it(`routes public traffic outside the terminal and apron: ${grouping}`,()=>{
  const scene=buildScene(layoutMap(catalog,[],grouping));
  expect(scene.airport).toBeDefined();
  const box=airportTrafficKeepOut(scene.airport!);
  for(const c of scene.transportConnections)expect(pathClear(c.road,[box],.3),c.id).toBe(true);
 });
});
