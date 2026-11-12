import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene,TERRACE_H} from './scene';
import {blocksArea,marinaFootprint,marinaSite,supportPoint,SUPPORT_HALF} from './marinaPlan';
import {PERIMETER_RAIL} from './perimeterRailPlan';

const supports=(loop:{route:[number,number][];lengths:number[];length:number},keep:Parameters<typeof supportPoint>[2])=>{
 const out:{x:number;z:number}[]=[];for(let d=3;d<loop.length;d+=PERIMETER_RAIL.supportSpacing){const q=supportPoint(loop,d,keep);if(q)out.push(q);}return out;
};

describe('harbour marina and rail viaduct (Khaneil, 2026-11-07: pole on the boardwalk dock)',()=>{
 it('had a viaduct support standing on the marina before supports kept clear',()=>{
  const s=buildScene(layoutMap(catalog,[],'district')),area=marinaFootprint(marinaSite(s,TERRACE_H));
  expect(supports(s.communityRail!.loop!,[]).some(q=>blocksArea([area],q.x,q.z,SUPPORT_HALF,SUPPORT_HALF))).toBe(true);
 });
 for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`keeps every support off the stair, pier and dock: ${grouping}`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),loop=s.communityRail!.loop!,area=marinaFootprint(marinaSite(s,TERRACE_H));
  const kept=supports(loop,[area]),all=supports(loop,[]);
  expect(kept.every(q=>!blocksArea([area],q.x,q.z,SUPPORT_HALF,SUPPORT_HALF))).toBe(true);
  // Supports slide aside instead of disappearing, so the viaduct keeps every pier.
  expect(kept.length).toBe(all.length);
 });
});
