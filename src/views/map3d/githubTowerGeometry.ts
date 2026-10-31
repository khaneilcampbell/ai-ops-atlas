import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {GITHUB_TOWER,type Box3,type GithubTowerPlan} from './githubTowerPlan';
import {GITHUB_ANNEX,type GithubAnnex} from './githubAnnex';

/** The GitHub tower's static meshes, merged by material so the whole building is a few draw calls. */

const merge=(gs:THREE.BufferGeometry[])=>{
 const parts=gs.map(g=>(g.index?g.toNonIndexed():g));
 const m=parts.length?mergeGeometries(parts):new THREE.BufferGeometry();
 if(!m)throw new Error('GitHub tower: parts could not be merged');
 for(const g of [...gs,...parts])if(g!==m)g.dispose();
 return m;
};

function box(b:Box3){
 const g=new THREE.BoxGeometry(b.x1-b.x0,b.y1-b.y0,b.z1-b.z0);
 g.translate((b.x0+b.x1)/2,(b.y0+b.y1)/2,(b.z0+b.z1)/2);
 return g;
}

function roundedRect(x0:number,y0:number,x1:number,y1:number,r:number){
 const s=new THREE.Shape();
 s.moveTo(x0+r,y0);s.lineTo(x1-r,y0);s.quadraticCurveTo(x1,y0,x1,y0+r);s.lineTo(x1,y1-r);s.quadraticCurveTo(x1,y1,x1-r,y1);
 s.lineTo(x0+r,y1);s.quadraticCurveTo(x0,y1,x0,y1-r);s.lineTo(x0,y0+r);s.quadraticCurveTo(x0,y0,x0+r,y0);
 return s;
}

/**
 * One glass box's concrete frame: a rounded tube seen from the front (top slab, bottom slab and
 * both end walls), extruded from the core to the front with softly rounded edges.
 */
function frame(b:Box3,slab:number,wall:number,radius:number){
 const bevel=Math.min(.018,radius*.3),depth=b.z1-b.z0-2*bevel;
 const outer=roundedRect(b.x0+bevel,b.y0+bevel,b.x1-bevel,b.y1-bevel,radius);
 const hole=new THREE.Path();
 hole.moveTo(b.x0+wall,b.y0+slab);hole.lineTo(b.x0+wall,b.y1-slab);hole.lineTo(b.x1-wall,b.y1-slab);hole.lineTo(b.x1-wall,b.y0+slab);hole.lineTo(b.x0+wall,b.y0+slab);
 outer.holes.push(hole);
 const g=new THREE.ExtrudeGeometry(outer,{depth,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:4});
 g.translate(0,0,b.z0+bevel);
 return g;
}

/** A plan-view rounded slab (podium tiers, roof garden), y0 to y1. */
function roundedSlab(b:Box3,r:number){
 const g=new THREE.ExtrudeGeometry(roundedRect(b.x0,-b.z1,b.x1,-b.z0,r),{depth:b.y1-b.y0,bevelEnabled:false,curveSegments:5});
 g.rotateX(-Math.PI/2);
 g.translate(0,b.y0,0);
 return g;
}

/** A thin box from a to b (in the x-y plane at depth z), for stringers and stair balustrades. */
function strut(a:[number,number],b:[number,number],z0:number,z1:number,t:number){
 const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
 const g=new THREE.BoxGeometry(len,t,z1-z0);
 g.rotateZ(Math.atan2(b[1]-a[1],b[0]-a[0]));
 g.translate((a[0]+b[0])/2,(a[1]+b[1])/2,(z0+z1)/2);
 return g;
}

export interface GithubTowerGeometry {
 concrete:THREE.BufferGeometry;glass:THREE.BufferGeometry;lobby:THREE.BufferGeometry;
 rails:THREE.BufferGeometry;garden:THREE.BufferGeometry;
}

export function githubTowerGeometry(p:GithubTowerPlan):GithubTowerGeometry{
 const G=GITHUB_TOWER,k=p.k,concrete:THREE.BufferGeometry[]=[],glass:THREE.BufferGeometry[]=[],lobby:THREE.BufferGeometry[]=[],rails:THREE.BufferGeometry[]=[],garden:THREE.BufferGeometry[]=[];
 // Podium: each tier a glazed storey under a rounded concrete slab, stepping back toward the top.
 for(const t of p.podium){
  lobby.push(box({...t,x0:t.x0+.03*k,x1:t.x1-.03*k,z0:t.z0+.03*k,z1:t.z1-.03*k,y1:t.y1-G.slab}));
  concrete.push(roundedSlab({...t,y0:t.y1-G.slab},.06*k));
  // Corner piers hold the slab, as in the reference's base.
  for(const x of [t.x0+.05*k,t.x1-.05*k])concrete.push(box({x0:x-.025*k,x1:x+.025*k,y0:t.y0,y1:t.y1-G.slab,z0:t.z1-.06*k,z1:t.z1-.02*k}));
 }
 // A planted strip along the front terrace the upper tier steps back from.
 const [lower,upper]=p.podium;
 garden.push(box({x0:lower.x0+.05*k,x1:lower.x1-.05*k,y0:lower.y1,y1:lower.y1+.04,z0:upper.z1+.03*k,z1:lower.z1-.04*k}));
 // Core: rounded in plan, past the roof as a crown.
 concrete.push(roundedSlab(p.core,.05*k));
 // Boxes: concrete frame, glass set back from the frame's front edge, and the glazed back wall.
 for(const b of p.boxes){
  concrete.push(frame(b,G.box.frame,G.box.wall,G.box.radius*k));
  glass.push(box({x0:b.x0+G.box.wall*.6,x1:b.x1-G.box.wall*.6,y0:b.y0+G.box.frame*.6,y1:b.y1-G.box.frame*.6,z0:b.z0+.01,z1:b.z1-.035*k}));
 }
 // Terraces: the glazed core wall behind, stairs with a stringer and a glass balustrade, planters.
 for(const [i,t] of p.terraces.entries()){
  const s=p.stairs[i];
  glass.push(box({x0:t.x0+.02*k,x1:t.x1-.02*k,y0:t.y0+.01,y1:t.y1-G.box.frame*.8,z0:t.z0,z1:t.z0+.012}));
  for(const st of s.steps)concrete.push(box(st));
  const z0=G.stair.z0*k,z1=G.stair.z1*k,drop=(t.y1-t.y0)/G.stair.steps*G.stair.lift;
  concrete.push(strut([s.from[0],s.from[1]-drop*.55],[s.to[0],s.to[1]-drop*.55],z0+.01*k,z1-.01*k,G.stair.stringer));
  rails.push(strut([s.from[0],s.from[1]+.06],[s.to[0],s.to[1]+.06],z1+.004,z1+.012,.11));
  concrete.push(box(p.planters[i]));
 }
 garden.push(box(p.roofGarden));
 return {concrete:merge(concrete),glass:merge(glass),lobby:merge(lobby),rails:merge(rails),garden:merge(garden)};
}

export interface GithubAnnexGeometry {concrete:THREE.BufferGeometry;glass:THREE.BufferGeometry;garden:THREE.BufferGeometry}

/**
 * The glass podium in world space, standing on `ground` (the terrace top): each storey a rounded
 * band of floor-to-ceiling glass under a rounded concrete slab with a planted lip, stepping back
 * toward the top, plus the glass skybridge to the tower.
 */
export function githubAnnexGeometry(a:GithubAnnex,ground:number):GithubAnnexGeometry{
 const A=GITHUB_ANNEX,concrete:THREE.BufferGeometry[]=[],glass:THREE.BufferGeometry[]=[],garden:THREE.BufferGeometry[]=[];
 const up=(b:Box3):Box3=>({...b,y0:b.y0+ground,y1:b.y1+ground});
 for(const [i,raw] of a.tiers.entries()){
  const t=up(raw),r=Math.min(A.radius,(t.x1-t.x0)/2-.01,(t.z1-t.z0)/2-.01),inset=.04;
  glass.push(roundedSlab({...t,x0:t.x0+inset,x1:t.x1-inset,z0:t.z0+inset,z1:t.z1-inset,y1:t.y1-A.slab},Math.max(.02,r-inset)));
  concrete.push(roundedSlab({...t,y0:t.y1-A.slab},r));
  // A thin floor plate at the base of the ground storey, so the glass sits on something.
  if(!i)concrete.push(roundedSlab({...t,y1:t.y0+.025},r));
 }
 // Roof garden on the top tier.
 const top=up(a.tiers[a.tiers.length-1]);
 garden.push(roundedSlab({x0:top.x0+.12,x1:top.x1-.12,z0:top.z0+.12,z1:top.z1-.12,y0:top.y1,y1:top.y1+.025},Math.max(.05,A.radius-.12)));
 // Skybridge: a glass tube between a floor and a roof slab.
 const b=up(a.skybridge);
 concrete.push(box({...b,y1:b.y0+.04}),box({...b,y0:b.y1-.035}));
 glass.push(box({...b,y0:b.y0+.04,y1:b.y1-.035,...(a.side.endsWith('x')?{z0:b.z0+.02,z1:b.z1-.02}:{x0:b.x0+.02,x1:b.x1-.02})}));
 return {concrete:merge(concrete),glass:merge(glass),garden:merge(garden)};
}
