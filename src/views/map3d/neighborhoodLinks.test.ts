import {financialDimensions} from './financialArchitecture';
import {expect,it} from 'vitest';import {catalog} from '../../catalog';import {layoutMap,type GroupBy} from '../mapLayout';import {buildScene} from './scene';import {uncoveredLand} from './neighborhoodLinks';import {overlapsParcel} from './citySpacing';import {closedRoadArc,distanceToRoad} from './highway';import {splitAtLand,connectionSpans} from './connectionGeometry';import {pathClear,type Pt} from './roads';import {COMMUNITY as C,railState,commuterStage,walkPoint} from './hillsCommunityPlan';
const length=(p:Pt[])=>p.slice(1).reduce((n,b,i)=>n+Math.hypot(b[0]-p[i][0],b[1]-p[i][1]),0);
const previous={none:{rail:169.227,highway:438.735},district:{rail:178.408,highway:452.874},status:{rail:169.227,highway:438.735},tag:{rail:168.5,highway:459.624}};
for(const g of ['none','district','status','tag'] as GroupBy[])it(`keeps a compact connected city without changing district contents: ${g}`,()=>{
 const s=buildScene(layoutMap(catalog,[],g)),h=s.hills!,f=s.financial!,r=s.communityRail!;
 expect(h.z-Math.max(...s.terraces.map(t=>t.z+t.d))).toBeLessThan(2);expect(f.x).toBeGreaterThan(Math.min(...s.terraces.map(t=>t.x))-10);
 expect(f.buildings).toHaveLength(10);expect(s.community!.buildings).toHaveLength(13);
 // The line now continues behind BMW and the towers to Financial Park (KC, 2026-10-31).
 expect(r.length).toBeLessThan(previous[g].rail*.82);expect(length(s.freight!.highway)).toBeLessThan(previous[g].highway*.95);
 expect(s.transportConnections.map(c=>c.id)).toEqual(expect.arrayContaining(['hills-city-boulevard','financial-stadium-local','atlas-hills','financial-district']));
 for(const a of s.neighborhoodLand!){for(const b of s.land)if(a!==b)expect(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1e-8&&Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z)>1e-8,`new terrain overlap: ${JSON.stringify({a,b,dx:Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),dz:Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z)})}`).toBe(false);}
 const boxes=[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
 boxes.push(...f.buildings.map(b=>({x:f.x+b.x,z:f.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d})),...s.community!.buildings.filter(b=>b.id!=='station').map(b=>({x:h.x+b.x,z:h.z+b.z,w:b.w,d:b.d})));
 for(const c of s.transportConnections.filter(l=>['hills-city-boulevard','financial-stadium-local'].includes(l.id))){expect(pathClear(c.road,boxes,.32)).toBe(true);expect(pathClear(c.walk,boxes,.23)).toBe(true);}
 expect(pathClear(r.route,[...boxes,{x:s.dealership!.x+5,z:s.dealership!.z+4,w:10,d:8}],.6)).toBe(true);
 for(const link of s.transportConnections.filter(l=>['atlas-hills','financial-district','hills-city-boulevard','financial-stadium-local'].includes(l.id)))expect(pathClear(link.road,s.fountains.map(v=>({x:v.x,z:v.z,w:.95*(v.k??1),d:.95*(v.k??1)})),.32),`local street ${link.id} stays clear of fountains ${JSON.stringify(s.fountains.filter(v=>!pathClear(link.road,[{x:v.x,z:v.z,w:.95*(v.k??1),d:.95*(v.k??1)}],.32)))}`).toBe(true);
 const deckHeight=C.railRise-.2;expect(deckHeight).toBeGreaterThan(1.3);
 const trip=C.dwell+r.length/C.speed;
 for(let t=0;t<2*trip;t+=.1){const state=railState(t,r.length),stage=commuterStage(state);expect(state.doors===1).toBe(!stage.aboard);const path=stage.hills?r.hillsWalk:r.financialWalk,p=walkPoint(path,stage.progress);expect(p.every(Number.isFinite)).toBe(true);}
});
it('subtracts existing land without losing or overlapping the connecting area',()=>{
 const existing=[{x:0,z:0,w:2,d:2},{x:4,z:0,w:2,d:2}],pieces=uncoveredLand({x:0,z:0,w:6,d:2},existing);expect(pieces.reduce((n,r)=>n+r.w*r.d,0)).toBe(4);for(const p of pieces)for(const e of existing)expect(overlapsParcel(p,e)).toBe(false);
});
it('keeps bridge guardrails over water and opens the joined land sections',()=>{
 const parts=splitAtLand(connectionSpans([[[0,1],[8,1]]]),[{x:0,z:0,w:2,d:2},{x:5,z:0,w:3,d:2}]);expect(parts.map(p=>p.onLand)).toEqual([true,false,true]);expect(parts[1]).toMatchObject({a:[2,1],b:[5,1]});
});
it('routes freight along an indented highway rather than cutting across its removed corner',()=>{
 const loop:Pt[]=[[0,0],[10,0],[10,10],[5,10],[5,5],[0,5],[0,0]],arc=closedRoadArc(loop,[2,0],[5,8]);expect(arc[0]).toEqual([2,0]);expect(arc[arc.length-1]).toEqual([5,8]);expect(arc).toContainEqual([5,5]);for(let i=1;i<arc.length;i++)for(let t=0;t<=1;t+=.1)expect(distanceToRoad([arc[i-1][0]+(arc[i][0]-arc[i-1][0])*t,arc[i-1][1]+(arc[i][1]-arc[i-1][1])*t],loop)).toBeLessThan(.001);expect(closedRoadArc(loop,[2,2],[5,8])).toEqual([]);
});
