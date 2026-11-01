import type {Pt} from './roads';
import {ROAD_W,towerRing} from './roads';
import type {Rect,Scene3D,Tower} from './scene';
import {GITHUB_TOWER,type Box3} from './githubTowerPlan';

/**
 * The GitHub tower's glass podium (KC, 2026-10-31: "missing the bottom part of the building with
 * the floor to ceiling windows. expand the landscape around Github"). The GitHub terrace grows
 * outward on whichever side faces open ground, and a long, low podium of three stepped storeys of
 * floor-to-ceiling glass stands on the new land beside the tower, joined to it by a glass
 * skybridge over the tower's ring road, the way the reference's base wraps beside its towers.
 *
 * Planned last, after every district, road and neighbourhood. The new land may overlap plain
 * landscape (meadow, beach, gardens, ponds), which it simply covers (KC, 2026-10-31: "combine the
 * landscape of the area and make it overlap if it needs to"), but never another district, a
 * building or plan footprint, or any road, rail or walk. When no side is free, the tower keeps its
 * own small podium and no land is added.
 */
export const GITHUB_ANNEX={
 /** How far the terrace grows outward, and the beach margin around the new terrace. */
 depth:3,beach:.775,
 /** Podium: keeps this far from the ring road and the terrace edges; tiers step back this much. */
 roadGap:.25,edge:.35,ends:.45,stepOut:.55,stepEnds:.35,tiers:3,storey:.46,slab:.05,radius:.45,
 skybridge:{width:.42,height:.3,lift:.62},
} as const;

export type Side='+x'|'-x'|'+z'|'-z';
export interface GithubAnnex {
 side:Side;
 /** The added terrace (raised, grassed) and the land under it. */
 terrace:Rect;land:Rect;
 /** World-space podium tiers, bottom up; y is above the terrace top. */
 tiers:Box3[];
 /** The glass skybridge from the podium to the tower, over the ring road. */
 skybridge:Box3;
 /** Shrubs and trees on the tiers' roofs, world x/z, y above the terrace top. */
 shrubs:[number,number,number][];trees:[number,number,number][];
}

const overlaps=(a:Rect,b:Rect,pad=0)=>a.x<b.x+b.w+pad&&a.x+a.w>b.x-pad&&a.z<b.z+b.d+pad&&a.z+a.d>b.z-pad;
const inside=(r:Rect,[x,z]:Pt,pad=0)=>x>r.x-pad&&x<r.x+r.w+pad&&z>r.z-pad&&z<r.z+r.d+pad;
const grow=(r:Rect,m:number):Rect=>({x:r.x-m,z:r.z-m,w:r.w+2*m,d:r.d+2*m});

/**
 * The beach goes only on the far side: none where the new terrace meets the old one, and none
 * along its ends, which face the brooks between districts.
 */
function trimInward(r:Rect,own:Rect,side:Side):Rect{
 if(side==='+x'){const x=own.x+own.w;return {...r,x,w:r.x+r.w-x,z:own.z,d:own.d};}
 if(side==='-x')return {...r,w:own.x-r.x,z:own.z,d:own.d};
 if(side==='+z'){const z=own.z+own.d;return {...r,z,d:r.z+r.d-z,x:own.x,w:own.w};}
 return {...r,d:own.z-r.z,x:own.x,w:own.w};
}

/** The rectangle `terrace` grows into on `side`, `depth` deep. */
export function annexRect(t:Rect,side:Side,depth:number):Rect{
 if(side==='+x')return {x:t.x+t.w,z:t.z,w:depth,d:t.d};
 if(side==='-x')return {x:t.x-depth,z:t.z,w:depth,d:t.d};
 if(side==='+z')return {x:t.x,z:t.z+t.d,w:t.w,d:depth};
 return {x:t.x,z:t.z-depth,w:t.w,d:depth};
}

export interface AnnexSite {
 tower:Tower;terrace:Rect;
 /** Ground nobody else may take: other districts, buildings, plan footprints, decks, paving. */
 blocked:Rect[];
 /** Roads, walks and rails: no point of any may fall on the new land. */
 lines:Pt[][];
}

/** Choose a free side and lay out the podium. Sides are tried camera-facing first. */
export function planGithubAnnex(s:AnnexSite):GithubAnnex|undefined{
 const A=GITHUB_ANNEX;
 for(const side of ['+x','+z','-x','-z'] as Side[]){
  const terrace=annexRect(s.terrace,side,A.depth),land=trimInward(grow(terrace,A.beach),s.terrace,side);
  // Neighbouring meadows may meet the new beach edge to edge, but nothing may sit on it.
  if(s.blocked.some(r=>overlaps(land,r,-.05)))continue;
  if(s.lines.some(l=>l.some(p=>inside(land,p,.2))))continue;
  return {side,terrace,land,...podium(s.tower,s.terrace,terrace,side)};
 }
 return undefined;
}

function podium(t:Tower,own:Rect,annex:Rect,side:Side){
 const A=GITHUB_ANNEX,ring=towerRing(t,(t.size/.92)*1.25+1),x=side.endsWith('x'),sign=side[0]==='+'?1:-1;
 const lane=ring?ring.x1-t.x:t.size/2+.55,inner=lane+ROAD_W/2+A.roadGap;
 // Along the side's axis: from beside the ring road to near the new terrace's far edge.
 const c=x?t.x:t.z,far=x?(sign>0?annex.x+annex.w:annex.x):(sign>0?annex.z+annex.d:annex.z);
 const a0=c+sign*inner,a1=far-sign*A.edge;
 // Across: the whole terrace span, inset from its ends.
 const b0=(x?own.z:own.x)+A.ends,b1=(x?own.z+own.d:own.x+own.w)-A.ends;
 const box=(lo:number,hi:number,c0:number,c1:number,y0:number,y1:number):Box3=>x
  ?{x0:Math.min(lo,hi),x1:Math.max(lo,hi),z0:c0,z1:c1,y0,y1}
  :{x0:c0,x1:c1,z0:Math.min(lo,hi),z1:Math.max(lo,hi),y0,y1};
 const tiers:Box3[]=[],shrubs:[number,number,number][]=[],trees:[number,number,number][]=[];
 for(let i=0;i<A.tiers;i++){
  const out=a1-sign*i*A.stepOut,e=i*A.stepEnds;
  tiers.push(box(a0,out,b0+e,b1-e,i*A.storey,(i+1)*A.storey));
  // Planting along the open strip each step leaves on the tier below's roof.
  if(i){
   const mid=out+sign*A.stepOut*.5,y=i*A.storey;
   for(let b=b0+e+.25;b<b1-e-.2;b+=.32)shrubs.push(x?[mid,y,b]:[b,y,mid]);
   for(const f of [.22,.78])trees.push(x?[mid,y,b0+e+(b1-b0-2*e)*f]:[b0+e+(b1-b0-2*e)*f,y,mid]);
  }
 }
 // A roof garden's trees on top.
 const top=tiers[tiers.length-1],ty=A.tiers*A.storey;
 for(const [fx,fz] of [[.3,.3],[.7,.55],[.4,.75]] as const)trees.push([top.x0+(top.x1-top.x0)*fx,ty,top.z0+(top.z1-top.z0)*fz]);
 // Skybridge: from the tower's own podium edge to the podium, across the middle, over the road.
 const k=t.size,towerEdge=c+sign*GITHUB_TOWER.podium[1].x1*k,mid=x?t.z:t.x,w=A.skybridge.width/2,lift=A.skybridge.lift;
 const skybridge=box(towerEdge,a0+sign*.05,mid-w,mid+w,lift,lift+A.skybridge.height);
 return {tiers,skybridge,shrubs,trees};
}

const isRect=(v:unknown):v is Rect=>!!v&&typeof v==='object'&&['x','z','w','d'].every(k=>typeof (v as Record<string,unknown>)[k]==='number');
const isLine=(v:unknown):v is Pt[]=>Array.isArray(v)&&v.length>1&&v.every(p=>Array.isArray(p)&&p.length===2&&typeof p[0]==='number');

/** Every road, rail and walk polyline anywhere in the scene, including plans added by other features. */
function sceneLines(v:unknown,out:Pt[][]=[],depth=0):Pt[][]{
 if(depth>5||!v||typeof v!=='object')return out;
 if(isLine(v)){out.push(v);return out;}
 if(Array.isArray(v)){
  if(v.length>1&&v.every(p=>p&&typeof p==='object'&&typeof (p as {gx?:unknown}).gx==='number'))out.push((v as {gx:number;gy:number}[]).map(p=>[p.gx,p.gy] as Pt));
  else for(const x of v)sceneLines(x,out,depth+1);
  return out;
 }
 for(const x of Object.values(v))sceneLines(x,out,depth+1);
 return out;
}

/** Plain landscape the annex may cover; everything else in the scene keeps clear. */
const GROUND_KEYS=new Set(['land','neighborhoodLand','raisedLand','terraces','paving','steps','brooks','ponds','falls','trees','bushes','rocks','bollards','bounds','githubAnnex']);

/** Plan the annex on a finished scene and add its terrace and land, clearing plants under it. */
export function addGithubAnnex(scene:Scene3D){
 const tower=scene.towers.find(t=>t.projectId===GITHUB_TOWER.projectId),own=scene.terraces.find(t=>t.id===GITHUB_TOWER.projectId);
 if(!tower||!own)return;
 const ownCentre=(r:Rect)=>inside(own,[r.x+r.w/2,r.z+r.d/2]);
 const blocked:Rect[]=[
  ...scene.terraces.filter(t=>t.id!==GITHUB_TOWER.projectId),...scene.parks,...scene.bridges,
  ...scene.paving.filter(r=>!ownCentre(r)),
  ...[...scene.towers,...scene.kiosks,...scene.retail,...scene.strays].filter(b=>b!==tower).map(b=>({x:b.x-b.size/2,z:b.z-b.size/2,w:b.size,d:b.size})),
  ...scene.houses.map(h=>({x:h.x-h.w/2,z:h.z-h.d/2,w:h.w,d:h.d})),
  // Neighbourhood ground keeps its own edges (neighborhoodLinks.test: it never overlaps other land).
  ...(scene.neighborhoodLand??[]),
 ];
 // Every other feature's own footprint (stadium, Financial District, mall and so on), wherever it
 // keeps one at its top level, so features added later are respected too.
 for(const [key,v] of Object.entries(scene))if(!GROUND_KEYS.has(key)&&isRect(v))blocked.push(v);
 const lines=sceneLines(Object.fromEntries(Object.entries(scene).filter(([k])=>!GROUND_KEYS.has(k)||k==='paving')));
 const annex=planGithubAnnex({tower,terrace:own,blocked,lines});
 if(!annex)return;
 scene.githubAnnex=annex;
 scene.terraces.push({id:GITHUB_TOWER.projectId,park:false,...annex.terrace});
 scene.land.push(annex.land);
 for(const items of [scene.trees,scene.bushes,scene.rocks,scene.bollards])for(let i=items.length-1;i>=0;i--)if(inside(annex.land,[items[i].x,items[i].z],.2))items.splice(i,1);
}
