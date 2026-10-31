import type {Tower} from './scene';
import {headquartersEnvelope} from './financialPlan';

/**
 * The GitHub building (the github-profile HQ) as a stacked-slab residential tower: pale rounded
 * concrete boxes wrapped around floor-to-ceiling dark glass, stacked and offset left and right,
 * with open terraces between them where a staircase with yellow-cushioned steps climbs from one
 * box's roof to the next and a tree grows in a planter. It stands on a stepped, glazed podium and
 * ends in a roof garden. Design reference: KC's MAHAK Residential Towers screenshots, 2026-10-31.
 *
 * Everything here is plain data in the tower's own frame: x across, y up from the plinth top
 * (FLOOR_BASE), z toward the front. Horizontal sizes are fractions of the tower's footprint `k`;
 * heights are world units. The renderer is GithubTower.tsx; the meshes are githubTowerGeometry.ts.
 */
export const GITHUB_TOWER={
 projectId:'github-profile',
 /**
  * Roof height as a share of the Financial District's reference height (headquartersEnvelope),
  * so the tower stands among the Financial towers and rises with them. The shortest Financial
  * tower is 1.08 of the reference, so 0.98 keeps every one of them taller.
  */
 share:.98,
 /** Two stepped podium tiers: x0,x1,z0,z1 in footprints, h tall, then a rounded concrete slab. */
 podium:[
  {x0:-.55,x1:.55,z0:-.55,z1:.51,h:.26},
  {x0:-.52,x1:.52,z0:-.52,z1:.34,h:.24},
 ],
 slab:.05,
 /** The solid concrete core at the back, rising past the roof as a crown. */
 core:{x0:-.5,x1:.5,z0:-.5,z1:-.2,crown:.4},
 /** Each glass box: this wide, centred this far left or right of the middle, out to this front. */
 box:{width:.66,offset:.17,front:.535,frame:.055,wall:.045,radius:.075},
 /** A box (storey) aims for this height; the count is whatever fills the tower evenly. */
 storey:.46,
 /** Steps per staircase, block depth (z, footprints) and how far into the terrace they sit. */
 stair:{steps:8,z0:.3,z1:.49,lift:1.7,stringer:.028},
 cushion:'#e3b23c',
 tree:{x:.35,z:-.04,planter:.15,trunk:.2,crown:.085},
} as const;

export const isGithubTower=(projectId:string)=>projectId===GITHUB_TOWER.projectId;

/** Roof height above the plinth, from the same reference the Financial District rises from. */
export const githubTowerHeight=(reference:number)=>reference*GITHUB_TOWER.share;

/** Give the GitHub tower its height from every tower's plain height (before any custom height). */
export function sizeGithubTower(towers:Tower[]){
 const reference=headquartersEnvelope(towers);
 for(const t of towers)if(isGithubTower(t.projectId))t.customHeight=githubTowerHeight(reference);
}

export const podiumTop=()=>GITHUB_TOWER.podium.reduce((y,p)=>y+p.h,0);

/** Which side storey i's box stands on: -1 left, +1 right. The terrace is on the other side. */
export const boxSide=(i:number)=>(i%2?1:-1) as 1|-1;

export interface Box3 {x0:number;x1:number;y0:number;y1:number;z0:number;z1:number}
export interface Stair {side:1|-1;steps:Box3[];cushions:Box3[];from:[number,number];to:[number,number]}
export interface GithubTowerPlan {
 k:number;height:number;storeys:number;storey:number;base:number;
 podium:Box3[];core:Box3;boxes:Box3[];terraces:Box3[];stairs:Stair[];
 planters:Box3[];trees:{x:number;y:number;z:number;trunk:number;crown:number}[];
 roofGarden:Box3;crownTop:number;
}

/**
 * Lay out the tower for footprint k and roof height `height` (above the plinth top). Box i fills
 * storey i on one side; its roof is the terrace floor for storey i+1 on that side, where a
 * staircase climbs from the outer edge up to the next box's roof on the inner edge.
 */
export function planGithubTower(k:number,height:number):GithubTowerPlan{
 const G=GITHUB_TOWER,base=podiumTop();
 const storeys=Math.max(4,Math.round((height-base)/G.storey)),storey=(height-base)/storeys;
 let y=0;
 const podium=G.podium.map(p=>{const b={x0:p.x0*k,x1:p.x1*k,z0:p.z0*k,z1:p.z1*k,y0:y,y1:y+p.h};y+=p.h;return b;});
 const core={x0:G.core.x0*k,x1:G.core.x1*k,z0:G.core.z0*k,z1:G.core.z1*k,y0:base-.02,y1:height+G.core.crown};
 const boxes:Box3[]=[],terraces:Box3[]=[],stairs:Stair[]=[],planters:Box3[]=[],trees:GithubTowerPlan['trees']=[];
 const half=G.box.width/2;
 for(let i=0;i<storeys;i++){
  const s=boxSide(i),cx=s*G.box.offset,y0=base+i*storey,y1=y0+storey;
  boxes.push({x0:(cx-half)*k-(s<0?.02*k:0),x1:(cx+half)*k+(s>0?.02*k:0),y0,y1,z0:core.z1,z1:G.box.front*k});
  // The terrace beside this box, over the box below it (or the podium roof).
  const ts=-s as 1|-1,dir=-ts,outer=ts*.5*k,inner=ts*(half-G.box.offset)*k;
  const tx0=Math.min(outer,inner),tx1=Math.max(outer,inner);
  terraces.push({x0:tx0,x1:tx1,y0,y1,z0:core.z1,z1:G.box.front*k});
  // Stairs climb from the terrace's outer edge to the inner edge, a storey up.
  const n=G.stair.steps,run=(tx1-tx0)/n,rise=storey/n,steps:Box3[]=[],cushions:Box3[]=[];
  const z0=G.stair.z0*k,z1=G.stair.z1*k;
  for(let j=0;j<n;j++){
   const xa=outer+dir*j*run,xb=xa+dir*run;
   const top=y0+(j+1)*rise;
   const step={x0:Math.min(xa,xb),x1:Math.max(xa,xb),y0:top-rise*G.stair.lift,y1:top,z0,z1};
   steps.push(step);
   // Cushions on every other step, on the half nearer the building, like the reference.
   if(j%2===0&&j<n-1)cushions.push({x0:step.x0+run*.1,x1:step.x1-run*.1,y0:top,y1:top+.014,z0:z0+(z1-z0)*.05,z1:z0+(z1-z0)*.55});
  }
  stairs.push({side:ts,steps,cushions,from:[outer,y0],to:[inner,y1]});
  // A planter and a tree at the back of each terrace, clear of the box above.
  const px=ts*G.tree.x*k,pz=G.tree.z*k,pw=G.tree.planter*k/2;
  planters.push({x0:px-pw,x1:px+pw,y0,y1:y0+.06,z0:pz-pw,z1:pz+pw});
  trees.push({x:px,y:y0+.06,z:pz,trunk:Math.min(G.tree.trunk,storey*.45),crown:Math.min(G.tree.crown,storey*.2)});
 }
 // Roof garden on the last box, and a cluster of trees around it.
 const last=boxes[boxes.length-1];
 const roofGarden={x0:last.x0+.04*k,x1:last.x1-.04*k,y0:height,y1:height+.03,z0:last.z0+.02*k,z1:last.z1-.06*k};
 for(const [fx,fz] of [[.2,.3],[.55,.75],[.8,.35]] as const)trees.push({x:roofGarden.x0+(roofGarden.x1-roofGarden.x0)*fx,y:height+.03,z:roofGarden.z0+(roofGarden.z1-roofGarden.z0)*fz,trunk:.18,crown:.1});
 return {k,height,storeys,storey,base,podium,core,boxes,terraces,stairs,planters,trees,roofGarden,crownTop:core.y1};
}

/** Height of the tower's highest point above the plinth top, for labels and camera clearance. */
export const githubTowerTop=(height:number)=>height+GITHUB_TOWER.core.crown;
