import {expect,it} from 'vitest';
import * as THREE from 'three';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {beacon,FINANCIAL_NIGHT as N,takeCrown,windowKind} from './financialNight';
import type {Inst} from './models';

const f=buildScene(layoutMap(catalog,[],'none')).financial!;
/** Pane centres on each tower's front: six columns, one row per floor, as the district draws them. */
const panes=f.buildings.flatMap(b=>Array.from({length:30},(_,floor)=>Array.from({length:6},(_,col)=>[f.x+b.x-1.4+col*.56,1.8+floor*.42,f.z+b.z+1.42] as const)).flat().map(p=>({id:b.id,p})));

it('lights most windows at night, but not all, so the skyline has depth',()=>{
 const lit=panes.filter(({p})=>windowKind(...p)>0).length/panes.length;
 expect(lit).toBeGreaterThan(.5);expect(lit).toBeLessThan(.85);
});
it('gives every tower lit and dark windows',()=>{
 for(const b of f.buildings){const kinds=panes.filter(p=>p.id===b.id).map(({p})=>windowKind(...p));expect(kinds.some(k=>k>0)).toBe(true);expect(kinds.some(k=>k===0)).toBe(true);}
});
it('keeps the district mostly warm, with a few neutral and cool rooms',()=>{
 const lit=panes.map(({p})=>windowKind(...p)).filter(k=>k>0),share=(k:number)=>lit.filter(x=>x===k).length/lit.length;
 expect(share(1)).toBeGreaterThan(.6);expect(share(2)).toBeGreaterThan(.08);expect(share(3)).toBeGreaterThan(.02);expect(share(3)).toBeLessThan(share(2));
});
it('reads floors as busy or quiet, not random noise',()=>{
 // Windows on one floor of one tower agree far more often than chance.
 let same=0,total=0;
 for(const b of f.buildings)for(let floor=0;floor<30;floor++){const row=panes.filter(p=>p.id===b.id).slice(floor*6,floor*6+6).map(({p})=>windowKind(...p)>0);for(let i=1;i<row.length;i++){total++;if(row[i]===row[i-1])same++;}}
 expect(same/total).toBeGreaterThan(.65);
});
it('uses warm light warmer than the cool rooms, matched to the city windows',()=>{
 const warm=new THREE.Color(N.warm),cool=new THREE.Color(N.cool);
 expect(warm.r-warm.b).toBeGreaterThan(cool.r-cool.b);expect(N.warm).toBe('#ffd9a1');
 // Under the bloom threshold, so glass glows but never blows out.
 expect(N.window).toBeLessThan(1);expect(N.sign).toBeLessThan(.9);
});
it('moves only roof-level accent pieces into the glowing crown',()=>{
 const accent='#126BC4',solid:Inst[]=[{p:[0,0,0],s:[1,1,1],c:'#ffffff'}],crown:Inst[]=[];
 solid.push({p:[0,5.3,0],s:[1,.2,1],c:'#126bc4'},{p:[0,.8,0],s:[1,.05,1],c:'#126bc4'},{p:[0,5.1,0],s:[1,.1,1],c:'#e6e9e7'});
 takeCrown(solid,1,5,accent,crown);
 expect(crown.map(p=>p.p[1])).toEqual([5.3]);
 expect(solid.map(p=>p.p[1])).toEqual([0,.8,5.1]);
});
it('places beacons in aviation red',()=>{expect(beacon(1,2,3)).toMatchObject({p:[1,2,3],c:N.beacon});});
