import * as THREE from 'three';
import {compact,fins,lid,skin} from './atlasHqGeometry';
import type {Pt3} from './atlasHqPlan';
import {slab} from './ribbonTowerGeometry';
import {ANNEX,annexPlan,annexRoof,annexStrip,type AnnexShape} from './commerceAnnexPlan';

/** One Commerce tool office as a few merged meshes, local to its lot centre at ground level. */
export function annexGeometry(shape:AnnexShape,height:number){
 const a=ANNEX,k=shape.k,n=a.ring,lobby=a.lobby*k,strip=annexStrip(n);
 // Levels from the lobby top to the roof; each point's top level carries its own sloped height.
 const ts=Array.from({length:a.levels+1},(_,l)=>l/a.levels);
 const yAt=(t:number,i:number)=>lobby+(height*(t<1?1:annexRoof(i,n))-lobby)*t;
 const levels:Pt3[][]=ts.map(t=>annexPlan(shape,t).map(([x,z],i)=>[x,yAt(t,i),z] as Pt3));
 const base=annexPlan(shape,0);
 const lobbyLevels:Pt3[][]=[base.map(([x,z])=>[x,0,z] as Pt3),base.map(([x,z])=>[x,lobby,z] as Pt3)];
 // Gold strip up the point: the same rings pushed out a hair, only between the strip's points.
 const lift=.006*k,proud=ts.map(t=>annexPlan(shape,t,lift/k).map(([x,z],i)=>[x,yAt(t,i),z] as Pt3));
 const keep=(ring:Pt3[])=>[...strip].sort((p,q)=>((p+n/2)%n)-((q+n/2)%n)).map(i=>ring[i]);
 const goldStrip=stripSkin(proud.map(keep));
 const finSkip=new Set([...strip]);
 const finIdx=Array.from({length:n},(_,i)=>i).filter(i=>i%a.finEvery===0&&!finSkip.has(i));
 return compact({
  glass:skin(levels),
  gold:merge([skin(lobbyLevels),goldStrip]),
  fins:pickFins(levels,finIdx,a.finDepth*k),
  roof:lid(levels[levels.length-1],.01*k),
  plinth:slab(annexPlan(shape,0,a.plinth),a.plinthH*k,a.plinthH*k),
 });
}

/** An open band (not closed round) of quads between successive rows. */
function stripSkin(rows:Pt3[][]){
 const pos:number[]=[],uv:number[]=[];
 for(let r=0;r<rows.length-1;r++)for(let j=0;j<rows[r].length-1;j++){
  const p=rows[r][j],q=rows[r][j+1],s=rows[r+1][j+1],t=rows[r+1][j];
  pos.push(...p,...q,...s,...p,...s,...t);
  uv.push(j/4,p[1]/1.2,(j+1)/4,q[1]/1.2,(j+1)/4,s[1]/1.2,j/4,p[1]/1.2,(j+1)/4,s[1]/1.2,j/4,t[1]/1.2);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}

/** Fins only at the chosen outline points (fins() takes an every-n step, so filter its points). */
function pickFins(levels:Pt3[][],idx:number[],depth:number){
 // fins() works out normals from the whole ring, so build every fin and keep the chosen ones.
 const all=fins(levels,1,depth),per=6*3*2*(levels.length-1),pos=all.getAttribute('position').array as Float32Array,out:number[]=[];
 for(const i of idx)for(let v=i*per;v<(i+1)*per;v++)out.push(pos[v]);
 all.dispose();
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(out,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(new Array(out.length/3*2).fill(0),2));g.computeVertexNormals();return g;
}

function merge(gs:THREE.BufferGeometry[]){
 const pos:number[]=[],uv:number[]=[];
 for(const g0 of gs){const g=g0.index?g0.toNonIndexed():g0;pos.push(...(g.getAttribute('position').array as Float32Array));const u=g.getAttribute('uv');uv.push(...(u?u.array as Float32Array:new Float32Array(g.getAttribute('position').count*2)));}
 const m=new THREE.BufferGeometry();m.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));m.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));m.computeVertexNormals();return m;
}

export function annexTriangles(g:ReturnType<typeof annexGeometry>){
 return Object.values(g).reduce((s,x)=>s+(x.index?x.index.count:x.getAttribute('position').count)/3,0);
}
