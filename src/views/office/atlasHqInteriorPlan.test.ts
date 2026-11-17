import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {planOffice} from './model';
import {HQ_INTERIOR,core,floorDoor,glassHeight,isAtlasHq,isGold,isTall,shellAxes,shellOutline,shellValue,towerAspect,wallPieces} from './atlasHqInteriorPlan';
import {CC} from '../map3d/commandCenterPlan';
import {doorWalk} from './BuildingCirculation';

const project=catalog.projects.find(p=>p.id==='ai-ops-atlas')!;
const agents=catalog.agents.filter(a=>a.projectId===project.id);
const plan=planOffice(project,agents);

describe('Atlas HQ interior',()=>{
 it('only applies to Atlas HQ',()=>{expect(isAtlasHq('ai-ops-atlas')).toBe(true);expect(isAtlasHq('benjaire-site')).toBe(false);});
 it('wraps every desk, the rack and the plants inside the glass',()=>{
  for(const ws of plan.workstations)expect(shellValue(plan.w,plan.d,Math.abs(ws.x)+.8,Math.abs(ws.z)+.6)).toBeLessThan(1);
  const {w,d}=plan;
  for(const [x,z] of [[-w/2+.69,-d/2+.69],[w/2-.5,-d/2+.5],[-w/2+.5,d/2-.5],[-w/2+1.35,-d/2+.45]])expect(shellValue(w,d,x,z)).toBeLessThan(1);
  // The core stands inside the glass, behind the wall display.
  const c=core(d);expect(shellValue(w,d,c.w/2,c.z-c.depth/2)).toBeLessThan(1);expect(c.z+c.depth/2).toBeLessThanOrEqual(-d/2+.03);
 });
 it('glazes the lobby in the warm lobby glass and every office floor in green, as outside',()=>{
  for(let i=0;i<HQ_INTERIOR.points;i++){expect(isGold(i,0)).toBe(true);for(const l of [1,2,3,4])expect(isGold(i,l)).toBe(false);}
 });
 it('keeps the camera side open and every office floor one storey tall',()=>{
  expect(isTall(HQ_INTERIOR.points/4)).toBe(true);expect(isTall(HQ_INTERIOR.points/2)).toBe(true);
  expect(isTall(0)).toBe(false);expect(isTall(HQ_INTERIOR.points*3/4)).toBe(false);
  // The roof is flat outside, so the top floor is a storey like the others.
  const {a}=shellAxes(plan.w,plan.d);
  expect(glassHeight(-a,4,plan.w,plan.d)).toBe(HQ_INTERIOR.height);
  expect(glassHeight(a,4,plan.w,plan.d)).toBe(HQ_INTERIOR.height);
  expect(glassHeight(0,0,plan.w,plan.d)).toBe(HQ_INTERIOR.lobbyHeight);
  // Lobby glass stays under the floor above (3.4 apart).
  expect(HQ_INTERIOR.lobbyHeight).toBeLessThan(3.4);
 });
 it('gives every floor plate the block\'s proportions and rounded corners',()=>{
  const {a,b}=shellAxes(plan.w,plan.d);
  expect(a/b).toBeGreaterThanOrEqual(towerAspect-1e-9);expect(towerAspect).toBeCloseTo(CC.a/CC.b);
  expect(shellOutline(plan.w,plan.d)).toHaveLength(HQ_INTERIOR.points);
 });
 it('opens a clear door in the front glass of each floor, on the route from the lift to the desks',()=>{
  const {w,d}=plan,door=floorDoor(w,d),pts=shellOutline(w,d),n=pts.length,h=door.width/2;
  const len=(l:number)=>pts.reduce((sum,p,i)=>sum+wallPieces(p,pts[(i+1)%n],l,w,d).reduce((t,[a,b])=>t+Math.hypot(b[0]-a[0],b[1]-a[1]),0),0);
  const whole=len(0);
  // The lobby keeps its glass (it has the entrance); every upper floor loses just the doorway.
  for(const l of [1,2,3,4]){expect(whole-len(l)).toBeGreaterThan(door.width);expect(whole-len(l)).toBeLessThan(door.width+.5);}
  for(let i=0;i<n;i++)for(const [a,b] of wallPieces(pts[i],pts[(i+1)%n],2,w,d))if(a[1]>0)expect(Math.min(a[0],b[0])>=h||Math.max(a[0],b[0])<=-h).toBe(true);
  expect(shellValue(w,d,door.x,door.z)).toBeCloseTo(1);
  // The walker (lift landing at z = d/2 + 1.1) passes the glass line inside the doorway and ends inside the floor.
  const landing=d/2+1.1,start=doorWalk(0,0),out=doorWalk(.3,0);
  expect(landing+start.z).toBeLessThan(door.z);expect(landing+out.z).toBeGreaterThan(door.z);
  expect(Math.abs(start.x*w/16-door.x)).toBeLessThan(door.width/2);
  expect(shellValue(w,d,start.x,landing+start.z)).toBeLessThan(1);
 });
});
