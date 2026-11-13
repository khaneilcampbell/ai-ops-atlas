import type {Rect} from './scene';
import type {Pt} from './roads';
import {distanceToRoad} from './highway';

/**
 * Topiary gardens (Khaneil, 2026-11-13): a few small formal gardens on open lawn round the city,
 * after a topiary chess garden and clipped shrubs. Each is a green and cream checkerboard lawn in a
 * clipped box hedge, with heart topiary trees with roses, boxwood balls, flowering shrubs and
 * evergreen cones, and one centrepiece. Restrained on purpose: at most three, far apart, only on
 * open ground, never on a street, path, roof, water or another plan's lot, and no building moves.
 */
export const GARDEN={size:3.4,tile:.4,margin:.9,pathClear:1.1,spacing:20,max:3,step:1} as const;
export type GardenCentre='knight'|'tiered'|'ball';
export interface Garden {x:number;z:number;centre:GardenCentre}
export interface GardenSite {
 /** Open ground a garden may stand on (meadow and district lawns). */
 ground:Rect[];
 /** Lots, buildings, paving, water and other plans' sites the garden must keep clear of. */
 obstacles:Rect[];
 /** Streets, walks and tracks, as centre lines. */
 paths:Pt[][];
}
const CENTRES:GardenCentre[]=['knight','tiered','ball'];
const overlaps=(a:Rect,b:Rect)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.z<b.z+b.d&&a.z+a.d>b.z;
const inside=(r:Rect,x:number,z:number)=>x>=r.x&&x<=r.x+r.w&&z>=r.z&&z<=r.z+r.d;
/** The garden's square on the map. */
export const gardenRect=(g:Pick<Garden,'x'|'z'>):Rect=>({x:g.x-GARDEN.size/2,z:g.z-GARDEN.size/2,w:GARDEN.size,d:GARDEN.size});

export function planGardens(s:GardenSite):Garden[]{
 if(!s.ground.length)return [];
 const x0=Math.min(...s.ground.map(r=>r.x)),x1=Math.max(...s.ground.map(r=>r.x+r.w)),z0=Math.min(...s.ground.map(r=>r.z)),z1=Math.max(...s.ground.map(r=>r.z+r.d));
 const half=GARDEN.size/2,reach=half+GARDEN.margin,ROOM=2.5,segs=s.paths.flatMap(p=>p.slice(1).map((b,i):[Pt,Pt]=>[p[i],b]));
 // Bucket everything by map cell once, so each candidate only looks at what is near it.
 const CELL=4,key=(i:number,k:number)=>i*100003+k,buckets=<T,>(items:T[],bounds:(t:T)=>Rect)=>{const m=new Map<number,T[]>();for(const t of items){const r=bounds(t);for(let i=Math.floor(r.x/CELL);i<=Math.floor((r.x+r.w)/CELL);i++)for(let k=Math.floor(r.z/CELL);k<=Math.floor((r.z+r.d)/CELL);k++){const q=key(i,k);let l=m.get(q);if(!l)m.set(q,l=[]);l.push(t);}}return m;};
 const near=<T,>(m:Map<number,T[]>,r:Rect)=>{const out=new Set<T>();for(let i=Math.floor(r.x/CELL);i<=Math.floor((r.x+r.w)/CELL);i++)for(let k=Math.floor(r.z/CELL);k<=Math.floor((r.z+r.d)/CELL);k++)for(const t of m.get(key(i,k))??[])out.add(t);return out;};
 const grounds=buckets(s.ground,r=>r),blocks=buckets(s.obstacles,r=>r),lines=buckets(segs,([a,b])=>({x:Math.min(a[0],b[0]),z:Math.min(a[1],b[1]),w:Math.abs(b[0]-a[0]),d:Math.abs(b[1]-a[1])}));
 const cx=(x0+x1)/2,cz=(z0+z1)/2,found:{x:number;z:number;score:number}[]=[];
 // A coarser search on very large maps keeps the plan's cost flat (about 100 x 100 candidates at most).
 const step=Math.max(GARDEN.step,Math.ceil(Math.max(x1-x0,z1-z0)/100));
 for(let x=Math.ceil((x0+reach)/step)*step;x<=x1-reach;x+=step)for(let z=Math.ceil((z0+reach)/step)*step;z<=z1-reach;z+=step){
  const area={x:x-reach,z:z-reach,w:reach*2,d:reach*2},box={x:x-half,z:z-half,w:GARDEN.size,d:GARDEN.size};
  // The whole square plus its margin stands on open ground.
  const ground=[...near(grounds,area)];let onGround=ground.length>0;
  for(let i=0;i<=4&&onGround;i++)for(let k=0;k<=4&&onGround;k++){const px=area.x+area.w*i/4,pz=area.z+area.d*k/4;if(!ground.some(r=>inside(r,px,pz)))onGround=false;}
  if(!onGround)continue;
  const around=near(blocks,{x:box.x-ROOM,z:box.z-ROOM,w:box.w+ROOM*2,d:box.d+ROOM*2});
  let room=ROOM,blocked=false;
  for(const o of around){if(overlaps(o,area)){blocked=true;break;}room=Math.min(room,rectGap(o,box));}
  if(blocked)continue;
  // Clear of every street, walk and track: no path passes within the margin of the square.
  const pad=GARDEN.pathClear;let crossed=false;
  for(const [a,b]of near(lines,{x:box.x-pad,z:box.z-pad,w:box.w+pad*2,d:box.d+pad*2}))if(segmentNearRect(a,b,box,pad)){crossed=true;break;}
  if(crossed)continue;
  // Prefer roomy lawn near the middle of the city, where the gardens are seen.
  found.push({x,z,score:room-Math.hypot(x-cx,z-cz)*.08});
 }
 found.sort((a,b)=>b.score-a.score||a.x-b.x||a.z-b.z);
 const out:Garden[]=[];
 for(const f of found){
  if(out.length>=GARDEN.max)break;
  if(out.some(g=>Math.hypot(g.x-f.x,g.z-f.z)<GARDEN.spacing))continue;
  out.push({x:f.x,z:f.z,centre:CENTRES[out.length%CENTRES.length]});
 }
 return out;
}

function rectGap(a:Rect,b:Rect){const dx=Math.max(0,a.x-(b.x+b.w),b.x-(a.x+a.w)),dz=Math.max(0,a.z-(b.z+b.d),b.z-(a.z+a.d));return Math.hypot(dx,dz);}
/** True when segment a-b comes within `clear` of the rectangle. */
function segmentNearRect(a:Pt,b:Pt,r:Rect,clear:number){
 const g={x:r.x-clear,z:r.z-clear,w:r.w+clear*2,d:r.d+clear*2};
 if(Math.max(a[0],b[0])<g.x||Math.min(a[0],b[0])>g.x+g.w||Math.max(a[1],b[1])<g.z||Math.min(a[1],b[1])>g.z+g.d)return false;
 if(inside(g,a[0],a[1])||inside(g,b[0],b[1]))return true;
 const cx=r.x+r.w/2,cz=r.z+r.d/2;
 return distanceToRoad([cx,cz],[a,b])<=Math.hypot(r.w,r.d)/2+clear;
}

export interface GardenPart {p:[number,number,number];s:[number,number,number];r?:number;rx?:number;c:string}
/** Garden pieces by shape, all drawn as shared instanced meshes (no textures, lights or frame work). */
export interface GardenParts {boxes:GardenPart[];balls:GardenPart[];cones:GardenPart[];cyls:GardenPart[];beads:GardenPart[]}
export const GARDEN_COLORS={
 lawn:'#78ad4e',cream:'#efe7d2',edge:'#d9ceb4',box:['#3f6e36','#47783c'],topiary:['#5d8f3e','#679b45'],cone:'#35583a',
 trunk:'#7a5c40',rose:['#9e2f3c','#b23a48'],bridle:'#c9a35a',
 // Hydrangea blue and violet, camellia and oleander pinks, from the reference shrubs.
 flowers:['#7f9cd6','#a98ad6','#e58fa8','#f2a7c3'],
} as const;

/** Every piece of the gardens. y is the ground the gardens stand on. */
export function gardenParts(gardens:Garden[],y:number):GardenParts{
 const o:GardenParts={boxes:[],balls:[],cones:[],cyls:[],beads:[]};
 const C=GARDEN_COLORS,t=GARDEN.tile,n=7,half=GARDEN.size/2;
 for(const g of gardens){
  const at=(dx:number,dz:number):[number,number]=>[g.x+dx,g.z+dz];
  // Checkerboard lawn on a stone edge.
  o.boxes.push({p:[g.x,y,g.z],s:[GARDEN.size,.012,GARDEN.size],c:C.edge});
  for(let i=0;i<n;i++)for(let k=0;k<n;k++){const [x,z]=at((i-(n-1)/2)*t,(k-(n-1)/2)*t);o.boxes.push({p:[x,y+.012,z],s:[t,.012,t],c:(i+k)%2?C.cream:C.lawn});}
  // A clipped box hedge round the edge, open in the middle of each side.
  const hedge=half-.12,gap=.45,len=hedge-gap/2+.08,pos=([x,z]:[number,number],up=0):[number,number,number]=>[x,y+.012+up,z];
  for(const side of [-1,1])for(const end of [-1,1]){
   const along=end*(gap/2+len/2);
   o.boxes.push({p:pos(at(along,side*hedge)),s:[len,.2,.16],c:C.box[0]},{p:pos(at(side*hedge,along)),s:[.16,.2,len],c:C.box[1]});
  }
  // Boxwood balls flank every opening; evergreen cones stand in the corners.
  for(const side of [-1,1])for(const end of [-1,1]){
   o.balls.push({p:pos(at(end*(gap/2+.1),side*hedge),.22),s:[.12,.12,.12],c:C.topiary[0]},{p:pos(at(side*hedge,end*(gap/2+.1)),.22),s:[.12,.12,.12],c:C.topiary[1]});
   o.cones.push({p:pos(at(side*hedge,end*hedge)),s:[.3,.8,.3],c:C.cone});
  }
  // Two heart topiary trees with roses, on the diagonal.
  for(const d of [-1,1]){
   const [x,z]=at(d*.82,-d*.82),top=y+.55;
   o.cyls.push({p:[x,y+.012,z],s:[.06,.55,.06],c:C.trunk});
   for(const side of [-1,1])o.balls.push({p:[x+side*.13,top+.3,z],s:[.19,.19,.11],c:C.topiary[0]});
   o.cones.push({p:[x,top+.36,z],s:[.6,.46,.2],rx:Math.PI,c:C.topiary[0]});
   for(const [rx,ry]of [[-.15,.36],[.14,.33],[0,.16],[.04,-.02]])for(const face of [-1,1])o.beads.push({p:[x+rx,top+ry,z+face*.105],s:[.05,.04,.025],c:C.rose[(rx>0?1:0)]});
  }
  // Flowering shrubs in the two other corners inside the hedge.
  for(const [i,d]of [[0,-1],[1,1]] as const){
   const [x,z]=at(d*.95,d*.95);
   for(const [j,[dx,dz]]of ([[0,0],[.22,.05],[.05,.22]] as const).entries()){
    o.balls.push({p:[x+dx*d,y+.11,z+dz*d],s:[.14,.12,.14],c:C.box[j%2]});
    const c=C.flowers[i*2+(j%2)];
    for(const [bx,bz]of [[-.05,0],[.05,.03],[0,-.05]])o.beads.push({p:[x+dx*d+bx,y+.21,z+dz*d+bz],s:[.04,.04,.04],c});
   }
  }
  // The centrepiece stands on the middle square.
  const [x,z]=at(0,0),b=y+.024;
  if(g.centre==='knight'){
   // A topiary chess knight in profile (snout toward +x), with a gold mane and bridle. u runs nose-ward, v up; k scales it.
   const k=1.25,P=(u:number,v:number,w=0):[number,number,number]=>[x+u*k,b+v*k,z+w*k],S=(w:number,h:number,d:number):[number,number,number]=>[w*k,h*k,d*k];
   o.cyls.push({p:P(0,0),s:S(.5,.08,.5),c:C.topiary[1]},{p:P(0,.08),s:S(.4,.07,.4),c:C.topiary[0]},{p:P(0,.15),s:S(.3,.15,.3),c:C.topiary[1]});
   o.boxes.push({p:P(-.08,.3),s:S(.34,.32,.24),c:C.topiary[0]},{p:P(.09,.62),s:S(.42,.2,.22),c:C.topiary[1]},{p:P(.26,.5),s:S(.2,.14,.2),c:C.topiary[1]});
   o.balls.push({p:P(-.14,.62),s:S(.16,.17,.12),c:C.topiary[0]});
   o.cones.push({p:P(-.06,.82,-.06),s:S(.07,.13,.07),c:C.topiary[0]},{p:P(-.06,.82,.06),s:S(.07,.13,.07),c:C.topiary[0]});
   o.boxes.push({p:P(-.3,.3),s:S(.04,.44,.1),c:C.bridle},{p:P(.21,.5),s:S(.03,.15,.23),c:C.bridle},{p:P(.12,.7),s:S(.35,.03,.23),c:C.bridle});
   for(const w of [-.115,.115])o.beads.push({p:P(.03,.74,w),s:S(.025,.025,.012),c:'#1f2a22'});
  }else if(g.centre==='tiered'){
   // A three-tier boxwood "cake" on a short stem.
   o.cyls.push({p:[x,b,z],s:[.08,.75,.08],c:C.trunk});
   for(const [h,r]of [[.22,.24],[.5,.17],[.74,.11]])o.balls.push({p:[x,b+h,z],s:[r,r*.8,r],c:C.topiary[h>.4?1:0]});
  }else{
   // One large clipped boxwood ball ringed by roses.
   o.balls.push({p:[x,b+.3,z],s:[.3,.3,.3],c:C.topiary[1]});
   for(let i=0;i<8;i++){const a=i/8*Math.PI*2;o.beads.push({p:[x+Math.cos(a)*.38,b+.04,z+Math.sin(a)*.38],s:[.05,.05,.05],c:C.rose[i%2]});}
  }
 }
 return o;
}
