import type {Point,Rect,Tree} from './scene';
import type {MallPlan} from './mallPlan';

/**
 * Marketplace Gardens: a formal garden on the open green behind the Atlas Marketplace, plus planted
 * beds on its front plaza. Everything is static. Trees, topiary and path lights join the map's own
 * tree, bush and bollard lists, so they cost no extra draw calls; the rest is a few dozen boxes
 * drawn in one instanced mesh, and two water surfaces. Sizes are in map units.
 */
export const GARDEN={
 /** Space kept clear inside the green's edge, and in front of the mall's back wall. */
 edge:.3,back:.25,
 /** Reflecting canal half width, path offset/width, and the cypress allee line. */
 canalHalf:.3,path:.72,pathW:.44,allee:1.12,treeStep:1.1,
 basinR:.75,terraceD:.8,
 /** Parterre beds: inner edge offset from the axis, gap between beds, hedge height and thickness. */
 bedInner:1.5,bedGap:.32,hedgeH:.12,hedgeT:.07,
 /** Below this the green is too small for the layout to read, so no garden is drawn. */
 minHalf:3.2,minDepth:6,
} as const;

/** Flower fills, from the design tokens' gold, blush and ivory. */
const BLOOMS=['#d0ad69','#e7b7c0','#f3efe4'];
const HEDGE='#3f6b45',LAWN='#6f9d55',GRAVEL='#e8dcc0',STONE='#efe9da',PAVING='#e6d6b4';

/** A box standing on the terrace: y is the height of its base above the terrace top. */
export interface GardenBox {x:number;z:number;w:number;d:number;h:number;y:number;c:string}
export interface MallGarden {
 rect:Rect;axis:number;
 canal:Rect;basin:{x:number;z:number;r:number};
 boxes:GardenBox[];trees:Tree[];bushes:Point[];bollards:Point[];
}

const inRect=(r:Rect,x:number,z:number,pad=0)=>x>=r.x-pad&&x<=r.x+r.w+pad&&z>=r.z-pad&&z<=r.z+r.d+pad;

/**
 * One parterre bed: four hedge sides round a lawn, with raised rows of flowers running its long way
 * (offsets are fractions of the short side), so it reads as planting rather than a painted slab.
 */
function bed(out:GardenBox[],x:number,z:number,w:number,d:number,rows:[number,string][]){
 const t=GARDEN.hedgeT,h=GARDEN.hedgeH,iw=w-2*t,id=d-2*t,long=iw>=id;
 out.push({x,z:z-d/2+t/2,w,d:t,h,y:0,c:HEDGE},{x,z:z+d/2-t/2,w,d:t,h,y:0,c:HEDGE},
  {x:x-w/2+t/2,z,w:t,d:id,h,y:0,c:HEDGE},{x:x+w/2-t/2,z,w:t,d:id,h,y:0,c:HEDGE},
  {x,z,w:iw,d:id,h:.04,y:0,c:LAWN});
 const short=long?id:iw,len=(long?iw:id)-.16,row=Math.min(.16,short*.2);
 for(const [f,c] of rows)out.push(long?{x,z:z+f*short,w:len,d:row,h:.09,y:0,c}:{x:x+f*short,z,w:row,d:len,h:.09,y:0,c});
}
/**
 * Lays the garden out on the green that the mall backs on to. Returns nothing when that green is
 * missing, too small, or has something standing on it, so nothing is ever drawn over a building.
 */
export function planMallGarden(mall:MallPlan,land:Rect[],blockers:Rect[],y:number):MallGarden|undefined{
 const axis=mall.cx;
 const green=land.find(r=>inRect(r,axis,mall.z-1)&&r.w>=6&&r.d>=6);
 if(!green)return;
 const half=Math.min(axis-(green.x+GARDEN.edge),green.x+green.w-GARDEN.edge-axis);
 const z0=green.z+GARDEN.edge,z1=mall.z-GARDEN.back;
 if(half<GARDEN.minHalf||z1-z0<GARDEN.minDepth)return;
 const rect={x:axis-half,z:z0,w:half*2,d:z1-z0};
 if(blockers.some(b=>b.x<rect.x+rect.w&&b.x+b.w>rect.x&&b.z<rect.z+rect.d&&b.z+b.d>rect.z))return;

 const boxes:GardenBox[]=[],trees:Tree[]=[],bushes:Point[]=[],bollards:Point[]=[];
 const basin={x:axis,z:z0+1.9,r:GARDEN.basinR};
 const tz=z1-GARDEN.terraceD,start=basin.z+basin.r+.2,end=tz-.25;
 const canal={x:axis-GARDEN.canalHalf,z:start,w:GARDEN.canalHalf*2,d:end-start};

 // Stone terrace along the mall's back wall, gravel pad round the basin, and the two promenades.
 boxes.push({x:axis,z:tz+GARDEN.terraceD/2,w:rect.w,d:GARDEN.terraceD,h:.02,y:0,c:PAVING});
 boxes.push({x:axis,z:basin.z,w:basin.r*2+.9,d:basin.r*2+.6,h:.015,y:0,c:GRAVEL});
 for(const side of [-1,1])boxes.push({x:axis+side*GARDEN.path,z:(basin.z+tz)/2,w:GARDEN.pathW,d:tz-basin.z,h:.015,y:0,c:GRAVEL});
 // Canal coping; the water sits in it (drawn in Mall.tsx).
 boxes.push({x:axis,z:canal.z+canal.d/2,w:canal.w+.16,d:canal.d+.16,h:.05,y:0,c:STONE});
 // A clipped hedge closes the garden's far end.
 boxes.push({x:axis,z:z0+.08,w:rect.w,d:.16,h:.18,y:0,c:HEDGE});

 // Cypress allee either side of the promenades, a path light between each pair.
 const n=Math.max(1,Math.floor((end-start-.6)/GARDEN.treeStep));
 for(let i=0;i<=n;i++){
  const z=start+.3+i*(end-start-.6)/n;
  for(const side of [-1,1]){
   trees.push({x:axis+side*GARDEN.allee,y,z,s:.24,kind:'cone'});
   if(i%2===0)bollards.push({x:axis+side*(GARDEN.canalHalf+.17),y,z,s:0});
  }
 }
 // Parterres: hedged beds of flowers, a clipped topiary in each.
 const bx0=GARDEN.bedInner,bx1=half-.75;
 if(bx1-bx0>=1){
  const beds=Math.max(1,Math.floor((end-start+GARDEN.bedGap)/2.6)),len=(end-start-GARDEN.bedGap*(beds-1))/beds;
  for(let k=0;k<beds;k++){
   const z=start+k*(len+GARDEN.bedGap)+len/2;
   for(const side of [-1,1]){
    const x=axis+side*(bx0+bx1)/2;
    const a=BLOOMS[(k+(side>0?1:0))%BLOOMS.length],b=BLOOMS[(k+(side>0?1:0)+1)%BLOOMS.length];
    bed(boxes,x,z,bx1-bx0,len,[[-.36,a],[-.18,b],[.18,b],[.36,a]]);
    bushes.push({x,y,z,s:.19});
   }
  }
 }
 // Ornamental trees along the garden's sides, blossom alternating with shade trees.
 const m=Math.max(1,Math.floor((tz-z0-.8)/1.5));
 for(let i=0;i<=m;i++){
  const z=z0+.5+i*(tz-z0-.8)/m;
  for(const side of [-1,1])trees.push({x:axis+side*(half-.3),y,z,s:.26,kind:i%2?'round':'blossom'});
 }
 // A ring of blossom trees round the basin, open on the canal side.
 for(let k=0;k<5;k++){const a=Math.PI*(1+(k+.5)/5),r=basin.r+.6;trees.push({x:basin.x+Math.cos(a)*r,y,z:basin.z+Math.sin(a)*r,s:.22,kind:'blossom'});}

 // Front plaza: a hedged flower bed each side of the fountain, a blossom tree at each outer end.
 const f=mall.fountain,pw=Math.min(2.4,mall.plaza.w/2-f.r-1.4);
 if(pw>1)for(const side of [-1,1]){
  const x=f.x+side*(f.r+.7+pw/2);
  bed(boxes,x,f.z,pw,.7,[[-.28,BLOOMS[0]],[.28,BLOOMS[1]]]);
  // Clipped box balls down the bed's middle.
  for(let i=0;i<4;i++)bushes.push({x:x-pw/2+.3+i*(pw-.6)/3,y,z:f.z,s:.11});
  trees.push({x:x+side*(pw/2+.35),y,z:f.z,s:.24,kind:'blossom'});
 }
 return {rect,axis,canal,basin,boxes,trees,bushes,bollards};
}

/** Pieces the garden adds to the map; held to a budget in mallGarden.test.ts. */
export function gardenPieceCount(g:MallGarden){
 // Each round or blossom tree is a trunk and four blobs; a cypress is a trunk and two cones.
 const trees=g.trees.reduce((n,t)=>n+(t.kind==='cone'?3:5),0);
 return g.boxes.length+trees+g.bushes.length*2+g.bollards.length*3+4;
}
