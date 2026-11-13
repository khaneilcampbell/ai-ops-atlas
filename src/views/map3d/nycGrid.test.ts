import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {GRID_CLEAR,GRID_ID} from './nycGrid';
import {drivingGraph,planVehicles} from './vehicles';

// New York style streets (Khaneil, 2026-11-13): through avenues north-south, one-way cross streets
// east-west, and no district or building moved to make room.
const scene=buildScene(layoutMap(catalog,[],'district'));
const grid=scene.transportConnections.filter(c=>c.id.startsWith(`${GRID_ID}:`));
const round=(n:number)=>Math.round(n*1000)/1000;

describe('New York street grid',()=>{
 it('adds the west, middle and east avenues in the district view',()=>{
  expect(grid.map(c=>c.id).sort()).toEqual([`${GRID_ID}:east-avenue`,`${GRID_ID}:middle-avenue`,`${GRID_ID}:west-avenue`]);
 });

 it('runs each avenue straight along the grid, from one street to another, on land',()=>{
  const others=[...scene.transportConnections.filter(c=>!c.id.startsWith(`${GRID_ID}:`)).map(c=>c.road),...scene.carBridges.flatMap(b=>b.roads)];
  const onSeg=(p:[number,number],a:[number,number],b:[number,number])=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/l));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t)<.05;};
  const onLand=(x:number,z:number)=>scene.land.some(r=>x>=r.x-1e-6&&x<=r.x+r.w+1e-6&&z>=r.z-1e-6&&z<=r.z+r.d+1e-6);
  for(const c of grid){
   for(let i=1;i<c.road.length;i++)expect(c.road[i][0]===c.road[i-1][0]||c.road[i][1]===c.road[i-1][1]).toBe(true);
   for(const end of [c.road[0],c.road[c.road.length-1]])expect(others.some(r=>r.slice(1).some((b,i)=>onSeg(end,r[i],b))),`${c.id} ends in the open`).toBe(true);
   for(let i=1;i<c.road.length;i++){const a=c.road[i-1],b=c.road[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.1);
    for(let k=0;k<=n;k++){const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;expect(onLand(x,z),`${c.id} over water at ${x},${z}`).toBe(true);}}
  }
 });

 it('keeps every avenue clear of the buildings, the Marketplace, its Galleria and Atlas Commons',()=>{
  const boxes=[...[...scene.towers,...scene.kiosks].map(b=>({x:b.x-b.size/2,z:b.z-b.size/2,w:b.size,d:b.size,name:b.projectId??b.key})),
   ...scene.houses.map(h=>({x:h.x-h.w/2,z:h.z-h.d/2,w:h.w,d:h.d,name:h.key})),
   ...[scene.mall,scene.galleria?.rect,scene.commons?.rect,scene.stadium,scene.agency].flatMap(r=>r?[{...r,name:'landmark'}]:[])];
  for(const c of grid)for(let i=1;i<c.road.length;i++){
   const a=c.road[i-1],b=c.road[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(len/.05);
   for(let k=0;k<=n;k++){
    const along=k/n*len;if(i===1&&along<1||i===c.road.length-1&&len-along<1)continue; // the junction ends
    const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;
    for(const o of boxes)expect(x>o.x-GRID_CLEAR+1e-6&&x<o.x+o.w+GRID_CLEAR-1e-6&&z>o.z-GRID_CLEAR+1e-6&&z<o.z+o.d+GRID_CLEAR-1e-6,`${c.id} hits ${o.name} at ${x},${z}`).toBe(false);
   }
  }
 });

 it('moves no district',()=>{
  // Every district where it stood before the grid (main at c76de03), to the millimetre.
  expect(scene.terraces.map(t=>[t.id,round(t.x),round(t.z),round(t.w),round(t.d)])).toEqual([
   ['ai-ops-atlas',35.375,9.4,10.7,10.7],['benjaire-site',6.9,-.35,8.2,8.2],['commerce-pipeline',6.9,9.4,10.7,10.7],
   ['intelligence-hub',37.625,21.65,10.7,10.7],['soc-lab',-.35,30.4,8.2,8.2],['portfolio-site',16.65,21.65,5.7,5.7],
   ['github-profile',9.4,28.9,5.7,5.7],['park:cleared:benjaire-ops',-.35,14.4,5.7,5.7],['park:cleared:street-reserve:ai-ops-atlas',19.15,14.4,5.7,5.7],
   ['park:cleared:street-reserve:intelligence-hub',26.4,11.9,8.2,8.2],['park:vacant:service-desk',0,40.5,5,5],['park:vacant:career-optimizer',9.75,22,5,5],
   ['park:d:career-portfolio',9.75,36.5,12,9],['github-profile',15.1,28.9,3,5.7],
  ]);
 });
});

describe('one-way cross streets',()=>{
 const d=drivingGraph(scene)!;
 const onStreet=(z:number)=>d.oneWay.find(s=>s.zs.some(q=>Math.abs(q-z)<.05));

 it('signs some east-west streets one way, with the boulevards left two-way',()=>{
  expect(d.oneWay.length).toBeGreaterThanOrEqual(2);
  const zs=d.next.flatMap((l,i)=>l.map(j=>[d.nodes[i],d.nodes[j]] as const)).filter(([a,b])=>Math.abs(a[2]-b[2])<1e-6&&a[0]!==b[0]).map(([a])=>a[2]);
  expect(onStreet(Math.min(...zs))).toBeUndefined();
  expect(onStreet(Math.max(...zs))).toBeUndefined();
  expect(new Set(d.oneWay.map(s=>s.dir)).size).toBe(2);
 });

 it('drives each one-way street only its signed way',()=>{
  d.next.forEach((list,i)=>list.forEach(j=>{
   const a=d.nodes[i],b=d.nodes[j],s=Math.abs(a[2]-b[2])<1e-6?onStreet(a[2]):undefined;
   if(s&&!d.next[j].includes(i))expect(Math.sign(b[0]-a[0]),`wrong way at ${a}`).toBe(s.dir);
  }));
  for(const v of planVehicles(scene))for(const l of v.legs){
   if(l.hold||Math.abs(l.b[1]-l.a[1])>1e-6||Math.abs(l.b[0]-l.a[0])<.3)continue;
   // A car in the right-hand lane sits a lane off the centre line: find the street it drives.
   const s=d.oneWay.find(w=>w.zs.some(q=>Math.abs(q-l.a[1])<.2));
   const two=d.next.some((list,i)=>list.some(j=>{const a=d.nodes[i],b=d.nodes[j];return Math.abs(a[2]-b[2])<1e-6&&Math.abs(a[2]-l.a[1])<.2&&d.next[j].includes(i)&&Math.min(a[0],b[0])<=Math.max(l.a[0],l.b[0])&&Math.max(a[0],b[0])>=Math.min(l.a[0],l.b[0]);}));
   if(s&&!two)expect(Math.sign(l.b[0]-l.a[0]),`${v.id} drives the wrong way at ${l.a}`).toBe(s.dir);
  }
 });

 it('still lets every junction reach every other',()=>{
  const nodes=d.next.flatMap((l,i)=>l.length?[i]:[]);
  const reach=(lists:number[][])=>{const seen=new Set([nodes[0]]),todo=[nodes[0]];while(todo.length)for(const j of lists[todo.pop()!])if(!seen.has(j)){seen.add(j);todo.push(j);}return seen;};
  const back=d.next.map(()=>[] as number[]);d.next.forEach((l,i)=>l.forEach(j=>back[j].push(i)));
  expect(reach(d.next).size).toBe(nodes.length);
  expect(reach(back).size).toBe(nodes.length);
 });

 for(const g of ['none','status','tag'] as GroupBy[])it(`keeps a full fleet driving in the ${g} grouping`,()=>{
  expect(planVehicles(buildScene(layoutMap(catalog,[],g))).length).toBeGreaterThanOrEqual(3);
 });
});
