import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {pathClear} from './roads';
import {financialDimensions} from './financialArchitecture';
import {COMMUNITY_BUILDINGS} from './hillsCommunityPlan';
import {distanceToRoad} from './highway';
import {planDistrictLife,visitorAt,visitorDoorOccupied,DISTRICT_LIFE as L,SIMULATED_COMMUTERS,commuterLane} from './districtLifePlan';

describe('bounded district visitor simulation',()=>{
 for(const group of ['none','district','status','tag'] as GroupBy[])it(`keeps visitors clear of buildings, water and driving aisles in ${group}`,()=>{
  const s=buildScene(layoutMap(catalog,[],group)),p=planDistrictLife(s),f=s.financial!,c=s.community!,d=s.dealership!;
  expect(p.visitors).toHaveLength(31);expect(p.visitors.length).toBeLessThanOrEqual(L.maxVisitors);expect(p.doors).toHaveLength(10);
  expect(new Set(p.visitors.map(v=>v.area))).toEqual(new Set(['financial','hills','golf','bmw']));
  const financial=f.buildings.map(b=>({id:b.id,x:f.x+b.x,z:f.z+b.z,w:financialDimensions(b.id).width,d:financialDimensions(b.id).depth}));
  const homes=COMMUNITY_BUILDINGS.filter(b=>!['golf','station'].includes(b.kind)).map(b=>({...b,x:c.x+b.x,z:c.z+b.z}));
  for(const v of p.visitors){
   const obstacles=v.area==='financial'?financial.filter(b=>b.id!==v.target):v.area==='hills'||v.area==='golf'?homes:[];
   expect(pathClear(v.route.points,obstacles,.045),v.id).toBe(true);
   for(let time=0;time<210;time+=1.25){const q=visitorAt(v,time);
    expect(Number.isFinite(q.x+q.z+q.y)).toBe(true);
    if(v.area==='financial')expect(pathClear([[q.x,q.z],[q.x+.001,q.z]],v.target?financial.filter(b=>b.id!==v.target):financial,.04),v.id).toBe(true);
    if(v.id.startsWith('park:')){const pool=f.park.pool;expect(Math.abs(q.x-f.x-pool.x)<pool.w/2+.05&&Math.abs(q.z-f.z-pool.z)<pool.d/2+.05).toBe(false);}
    if(v.area==='golf'){expect(q.x-c.x).toBeGreaterThan(24);expect(q.x-c.x).toBeLessThan(32);expect(q.z-c.z).toBeGreaterThan(31);expect(q.z-c.z).toBeLessThan(44);}
    if(v.area==='bmw'){
     expect(distanceToRoad([q.x,q.z],d.drive)).toBeGreaterThan(.5);
     expect(pathClear([[q.x,q.z],[q.x+.001,q.z]],d.cars.map(car=>({...car,w:.72,d:.95})),.07)).toBe(true);
    }
   }
  }
 });
 it('opens each real entrance before a visitor crosses and closes it after departure',()=>{
  const s=buildScene(layoutMap(catalog,[],'none')),p=planDistrictLife(s);
  for(const door of p.doors){const v=p.visitors.find(v=>v.door===door.id)!,arrival=v.route.length/L.speed-v.offset;
   expect(visitorAt(v,arrival+1).inside).toBe(true);
   const at=v.route.points.findIndex(point=>Math.hypot(point[0]-door.x,point[1]-door.z)<.01),crossing=v.route.lengths[at]/L.speed-v.offset;
   expect(visitorDoorOccupied(door,p,crossing-1)).toBe(true);
   expect(visitorDoorOccupied(door,p,crossing+1)).toBe(true);
   if(v.area==='financial'){expect(visitorAt(v,arrival+1).y).toBeCloseTo(.21);expect(visitorDoorOccupied(door,p,arrival+L.insidePause+7)).toBe(false);}
  }
 });
 it('keeps loop boundaries continuous and confines six commuters to stairs and platforms',()=>{
  const p=planDistrictLife(buildScene(layoutMap(catalog,[],'none')));
  for(const v of p.visitors){const period=v.route.length/L.speed*2+(v.door?L.insidePause:3)+L.outsidePause;
   const a=visitorAt(v,period-v.offset-.001),b=visitorAt(v,period-v.offset+.001);
   expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeLessThan(.002);
  }
  expect(SIMULATED_COMMUTERS).toBe(6);for(let i=0;i<SIMULATED_COMMUTERS;i++)expect(Math.abs(commuterLane(i))+.04).toBeLessThan(.5);
  expect(planDistrictLife({})).toEqual({visitors:[],doors:[]});
 });
});
