import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene,TERRACE_H} from './scene';
import {blocksArea,marinaFootprint,marinaSite,supportPoint,SUPPORT_HALF} from './marinaPlan';
import {PERIMETER_RAIL} from './perimeterRailPlan';

const supports=(loop:{route:[number,number][];lengths:number[];length:number},keep:Parameters<typeof supportPoint>[2])=>{
 const out:{x:number;z:number}[]=[];for(let d=3;d<loop.length;d+=PERIMETER_RAIL.supportSpacing){const q=supportPoint(loop,d,keep);if(q)out.push(q);}return out;
};

describe('harbour marina and rail viaduct (KC, 2026-11-07: pole on the boardwalk dock)',()=>{
 it('had a viaduct support standing on the marina before supports kept clear',()=>{
  // The viaduct used to run offshore across the dock; since it moved onto the shore (2026-11-13) a straight test track
  // through the dock stands in for that route.
  const s=buildScene(layoutMap(catalog,[],'district')),area=marinaFootprint(marinaSite(s,TERRACE_H)),z=area.z+area.d/2;
  const track={route:[[area.x-6.5,z],[area.x+area.w+6.5,z]] as [number,number][],lengths:[0,area.w+13],length:area.w+13};
  expect(supports(track,[]).some(q=>blocksArea([area],q.x,q.z,SUPPORT_HALF,SUPPORT_HALF))).toBe(true);
  expect(supports(track,[area]).some(q=>blocksArea([area],q.x,q.z,SUPPORT_HALF,SUPPORT_HALF))).toBe(false);
 });
 for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`keeps every support off the stair, pier and dock: ${grouping}`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),loop=s.communityRail!.loop!,area=marinaFootprint(marinaSite(s,TERRACE_H));
  const kept=supports(loop,[area]),all=supports(loop,[]);
  expect(kept.every(q=>!blocksArea([area],q.x,q.z,SUPPORT_HALF,SUPPORT_HALF))).toBe(true);
  // Supports slide aside instead of disappearing, so the viaduct keeps every pier.
  expect(kept.length).toBe(all.length);
 });
});
