import {describe,it,expect} from 'vitest';
import {mallUnits,mallInteriorFloor,MALL_SHAPE,mallDoorway} from './mallInteriorPlan';
import {MARKETPLACE_WORKSPACES} from './marketplaceWorkspaces';
import {marketplaceWalk,officeWalkAt,OFFICE_WALK} from './officeWalk';
import type {Pt} from '../map3d/roads';
function inside(p:Pt,poly:Pt[]){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
describe('visual Marketplace office life',()=>{
 for(const assignment of MARKETPLACE_WORKSPACES)it(`${assignment.agentId} exits through its door, stays on its floor and returns without jumps`,()=>{
  const unit=mallUnits().find(u=>u.id===assignment.unitId)!,route=marketplaceWalk(unit),{outer,inner}=mallInteriorFloor(MALL_SHAPE,unit.level),poly=[...outer,...[...inner].reverse()];
  const doorway=mallDoorway(unit);expect(route.points[2]).toEqual([(doorway.a[0]+doorway.b[0])/2,(doorway.a[1]+doorway.b[1])/2]);
  expect(route.length).toBeGreaterThan(2);expect(route.length).toBeLessThan(20);
  let previous=officeWalkAt(route,0);const phases=new Set<string>();
  for(let t=0;t<=180;t+=.1){const next=officeWalkAt(route,t);phases.add(next.phase);
   expect(Math.hypot(next.x-previous.x,next.z-previous.z)).toBeLessThanOrEqual(OFFICE_WALK.speed*.1+1e-6);
   for(const [dx,dz] of [[.2,0],[-.2,0],[0,.2],[0,-.2]])expect(inside([next.x+dx,next.z+dz],poly)).toBe(true);
   previous=next;
  }
  expect([...phases].sort()).toEqual(['paused','seated','walking']);
  const end=officeWalkAt(route,route.delay+OFFICE_WALK.rest+2*route.length/OFFICE_WALK.speed+OFFICE_WALK.pause+.1);
  expect(end.phase).toBe('seated');expect([end.x,end.z]).toEqual(route.points[0]);
 });
});
