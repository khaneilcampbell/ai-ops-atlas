import {hash} from '../mapLayout';
import type {Inst} from './models';
import type {Point,Tree} from './scene';

/**
 * Los Angeles planting (Khaneil, 2026-11-13: "mostly palm trees like Los Angeles"). The scene still
 * decides where a tree or shrub stands; this decides what grows there and how it is built, from a
 * hash of its position so a plant never changes between renders.
 *
 * Trees: tall, thin fan palms and shorter, fuller date palms are the majority, with a few round
 * shade trees (ficus), purple jacaranda (the old pink blossom) and slim Italian cypress (the old
 * cone tree). Shrubs: clipped hedges, agave, bird of paradise and bougainvillea.
 *
 * Every part is a box, ball, trunk or cone from the shared geometry kit, grouped so the whole
 * planting is a handful of instanced draws. A palm's fronds are four-triangle folded leaves, so a
 * whole palm is about 100 triangles; the round tree it replaces is over a thousand.
 */
export type LaTree='fan'|'date'|'ficus'|'jacaranda'|'cypress';
export type LaShrub='hedge'|'agave'|'paradise'|'bougainvillea';

const key=(x:number,z:number,salt:string)=>hash(`${x.toFixed(2)}:${z.toFixed(2)}:${salt}`);

/** What grows where the scene planted a tree; null for trees drawn by their own building (stadium palms). */
export function laTreeKind(t:Pick<Tree,'x'|'z'|'kind'>):LaTree|null{
 if(t.kind==='palm')return null;
 if(t.kind==='fan'||t.kind==='date')return t.kind;
 if(t.kind==='blossom')return 'jacaranda';
 const p=key(t.x,t.z,'la');
 if(t.kind==='cone')return p<.45?'cypress':'fan';
 return p<.5?'fan':p<.82?'date':p<.94?'ficus':'cypress';
}

export function laShrubKind(b:Pick<Point,'x'|'z'>):LaShrub{
 const p=key(b.x,b.z,'shrub');
 return p<.35?'hedge':p<.6?'agave':p<.8?'paradise':'bougainvillea';
}

export const LA_COLORS={
 fanFrond:['#7a9a45','#88a650','#6f8d3d'],dateFrond:['#4e7a37','#5b8a3f','#46703a'],
 fanTrunk:'#a08a6a',dateTrunk:'#8b7152',skirt:'#8e6d45',dates:'#d18a2e',
 ficus:['#3f7a3a','#4a8642','#386f35','#438040'],jacaranda:['#9c80d4','#b19ae2','#8a6dc6','#a58bdb'],cypress:['#35583a','#3f6643'],
 hedge:['#3f6e36','#47783c'],agave:'#86a59a',paradiseLeaf:'#3f7448',paradiseFlower:'#f08a24',bougainvillea:['#d63f8f','#e2589f','#c93583'],
} as const;

/** Instances grouped by the mesh that draws them (see Landscape in models.tsx). */
export interface LaParts{
 /** g.trunk, plain: trunks and the dead-frond skirts under fan palm crowns. */
 trunks:Inst[];
 /** g.frond, foliage: palm fronds (a folded four-triangle leaf). */
 leaves:Inst[];
 /** g.box, foliage: clipped hedges, agave blades and bird of paradise flowers. */
 fronds:Inst[];
 /** g.blob, foliage: ficus and jacaranda canopies (shadowed) and their small top puffs (no shadow). */
 blobs:Inst[];puffs:Inst[];
 /** g.cone, foliage: cypress. */
 cones:Inst[];
 /** g.ball, foliage: shrub clumps and palm crown hearts. */
 clumps:Inst[];
 /** g.ball, plain, no shadow: flowers and date clusters. */
 flowers:Inst[];
}

export const emptyParts=():LaParts=>({trunks:[],leaves:[],fronds:[],blobs:[],puffs:[],cones:[],clumps:[],flowers:[]});

/** A ring of fronds round a crown top: each frond a folded leaf hinged at the heart, drooping outward by `droop`. */
function crown(out:Inst[],x:number,y:number,z:number,n:number,len:number,width:number,droop:number,turn:number,colors:readonly string[]){
 for(let f=0;f<n;f++){const t=turn+f/n*Math.PI*2,reach=len*.5*Math.cos(droop);
  out.push({p:[x+Math.sin(t)*reach,y-len*.5*Math.sin(droop),z+Math.cos(t)*reach],s:[width,width*.35,len],r:t,rx:droop,c:colors[f%colors.length]});}
}

/** Where a leaning trunk of this height ends (the trunk turns by yaw, then leans by `lean`, like Inst's YXZ rotation). */
function trunkTop(x:number,y:number,z:number,h:number,lean:number,yaw:number):[number,number,number]{
 return [x+Math.sin(lean)*Math.sin(yaw)*h,y+Math.cos(lean)*h,z+Math.sin(lean)*Math.cos(yaw)*h];
}

/** Very tall, thin and slightly leaning, with a small tight crown over a brown skirt of dead fronds. */
export function fanPalm(o:LaParts,x:number,y:number,z:number,s:number){
 const v=key(x,z,'h'),h=s*(6.2+v*3.2),lean=(key(x,z,'lean')-.5)*.12,yaw=key(x,z,'yaw')*Math.PI*2;
 o.trunks.push({p:[x,y,z],s:[.075,h,.075],r:yaw,rx:lean,c:LA_COLORS.fanTrunk});
 const [tx,ty,tz]=trunkTop(x,y,z,h,lean,yaw);
 o.trunks.push({p:[tx,ty-s*.62,tz],s:[.15,s*.6,.15],r:yaw,c:LA_COLORS.skirt});
 o.clumps.push({p:[tx,ty+s*.05,tz],s:[s*.2,s*.18,s*.2],c:LA_COLORS.fanFrond[0]});
 crown(o.leaves,tx,ty+s*.12,tz,6,s*1.45,s*.42,-.4,yaw,LA_COLORS.fanFrond);
 crown(o.leaves,tx,ty+s*.04,tz,7,s*1.6,s*.45,.4,yaw+.45,LA_COLORS.fanFrond);
}

/** Shorter and thicker, with a wide, full, drooping crown and orange date clusters under it. */
export function datePalm(o:LaParts,x:number,y:number,z:number,s:number){
 const v=key(x,z,'h'),h=s*(2.6+v*1.4),yaw=key(x,z,'yaw')*Math.PI*2;
 o.trunks.push({p:[x,y,z],s:[.17,h,.17],r:yaw,c:LA_COLORS.dateTrunk});
 o.clumps.push({p:[x,y+h,z],s:[s*.42,s*.34,s*.42],c:LA_COLORS.dateFrond[2]});
 crown(o.leaves,x,y+h+s*.3,z,5,s*2.3,s*.5,-.15,yaw,LA_COLORS.dateFrond);
 crown(o.leaves,x,y+h+s*.2,z,8,s*2.6,s*.55,.35,yaw+.4,LA_COLORS.dateFrond);
 crown(o.leaves,x,y+h+s*.04,z,7,s*2.3,s*.5,.85,yaw+.8,LA_COLORS.dateFrond);
 for(const a of [.7,2.8,4.9])o.flowers.push({p:[x+Math.sin(a+yaw)*s*.38,y+h-s*.12,z+Math.cos(a+yaw)*s*.38],s:[s*.12,s*.12,s*.12],c:LA_COLORS.dates});
}

/** Round shade tree: the old three-blob canopy in a deeper green, or jacaranda purple. */
function roundTree(o:LaParts,x:number,y:number,z:number,s:number,i:number,pal:readonly string[]){
 const col=(k:number)=>pal[(i+k)%pal.length];
 o.trunks.push({p:[x,y,z],s:[.08,s*1.3,.08],c:'#7a5c40'});
 o.blobs.push({p:[x,y+s*1.9,z],s:[s,s*.95,s],c:col(0)});
 o.blobs.push({p:[x-s*.45,y+s*1.55,z+s*.3],s:[s*.72,s*.66,s*.72],c:col(1)});
 o.blobs.push({p:[x+s*.4,y+s*1.6,z-s*.25],s:[s*.7,s*.66,s*.7],c:col(2)});
 o.puffs.push({p:[x+s*.1,y+s*2.45,z+s*.1],s:[s*.55,s*.5,s*.55],c:col(3)});
}

/** Slim Italian cypress: a short trunk under one tall, narrow cone. */
function cypress(o:LaParts,x:number,y:number,z:number,s:number,i:number){
 o.trunks.push({p:[x,y,z],s:[.06,s*.4,.06],c:'#6b5038'});
 o.cones.push({p:[x,y+s*.25,z],s:[s*.85,s*(3.6+key(x,z,'h')*1.2),s*.85],c:LA_COLORS.cypress[i%2]});
}

export function plantTree(o:LaParts,t:Tree,i:number){
 const kind=laTreeKind(t);
 if(kind==='fan')fanPalm(o,t.x,t.y,t.z,t.s);
 else if(kind==='date')datePalm(o,t.x,t.y,t.z,t.s);
 else if(kind==='ficus')roundTree(o,t.x,t.y,t.z,t.s,i,LA_COLORS.ficus);
 else if(kind==='jacaranda')roundTree(o,t.x,t.y,t.z,t.s,i,LA_COLORS.jacaranda);
 else if(kind==='cypress')cypress(o,t.x,t.y,t.z,t.s,i);
}

export function plantShrub(o:LaParts,b:Point,i:number){
 const {x,y,z,s}=b,kind=laShrubKind(b),turn=key(x,z,'turn')*Math.PI;
 if(kind==='hedge'){o.fronds.push({p:[x,y,z],s:[s*2.4,s*1.1,s*1.3],r:turn,c:LA_COLORS.hedge[i%2]});return;}
 if(kind==='agave'){
  // A low rosette of stiff blue-grey blades leaning out from the middle.
  for(let k=0;k<7;k++){const t=turn+k/7*Math.PI*2;o.fronds.push({p:[x+Math.sin(t)*s*.12,y,z+Math.cos(t)*s*.12],s:[s*.32,s*1.3,s*.07],r:t,rx:.75,c:LA_COLORS.agave});}
  o.fronds.push({p:[x,y,z],s:[s*.3,s*1.1,s*.07],r:turn,c:LA_COLORS.agave});
  return;
 }
 if(kind==='paradise'){
  o.clumps.push({p:[x,y+s*.5,z],s:[s*1.1,s*.9,s*1.1],c:LA_COLORS.paradiseLeaf});
  for(let k=0;k<3;k++){const t=turn+k*2.1;o.fronds.push({p:[x+Math.sin(t)*s*.55,y+s*1.25,z+Math.cos(t)*s*.55],s:[s*.12,s*.12,s*.5],r:t,rx:-.2,c:LA_COLORS.paradiseFlower});}
  return;
 }
 o.clumps.push({p:[x,y+s*.55,z],s:[s*1.45,s*1.05,s*1.45],c:LA_COLORS.hedge[1]});
 for(let k=0;k<5;k++){const t=turn+k*1.26;o.flowers.push({p:[x+Math.sin(t)*s*.95,y+s*(.75+(k%2)*.4),z+Math.cos(t)*s*.95],s:[s*.32,s*.28,s*.32],c:LA_COLORS.bougainvillea[k%3]});}
}

export function laPlanting(trees:Tree[],shrubs:Point[]):LaParts{
 const o=emptyParts();
 trees.forEach((t,i)=>plantTree(o,t,i));
 shrubs.forEach((b,i)=>plantShrub(o,b,i));
 return o;
}
