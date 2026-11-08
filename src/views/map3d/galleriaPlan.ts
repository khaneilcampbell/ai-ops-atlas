import type {Point,Rect,Tree} from './scene';
import type {MallPlan} from './mallPlan';
import type {Pt} from './roads';
import {along} from './mallPlan';

export const GALLERIA_KEY='service:atlas-galleria';
export const GALLERIA_ID='atlas-galleria';
export const GALLERIA_NAME='Atlas Galleria';

/**
 * Atlas Galleria: the three-storey shopping mall over a basement car park that replaced the
 * Marketplace Gardens (KC, 2026-11-07, from the Behance "Shopping Mall" reference by My Phuong
 * Nguyen). The plan is drawn in the reference's own metres on its 10 m grid, 80 m (grid 1 to 9,
 * west to east) by 60 m (grid A to G, south to north), and placed on the map at one uniform scale.
 *
 * Massing follows the axonometric: an oval ring split into three leaves round a central atrium.
 * Two curved wings (north-west and south-west) meet in a V-shaped notch, which is the main lobby,
 * and a rounded crescent on the east holds the supermarket. Each slab drifts in and out of the
 * one below, which makes the overhangs and planted terraces, and every slab edge carries a band of
 * white fins whose bottom rises and falls in long waves, with rope lights along the top and bottom.
 */
export const GALLERIA={
 /** Storey heights on the map: ground (tall glass shopfronts), Floor 1, Floor 2. */
 storeys:[1.75,1.5,1.3] as readonly number[],
 slab:.12,
 /** Fin parapet above each slab, and how far a band hangs below it, as a share of the storey. */
 rail:.26,hang:[.18,.95] as readonly [number,number],
 finStep:.17,finT:.018,finD:.07,
 /** Rope-light dot spacing and strip height, map units. */
 dot:.1,lightH:.035,
 /** Space kept clear inside the green's edge and in front of the Marketplace's back wall. */
 edge:.35,back:.3,
 /** Plan metres to map units: never larger, so a big lot does not grow the building. */
 maxScale:.13,minScale:.1,
 /** Planted terraces: a bush every plantStep, a small tree every treeStep, along each lip. */
 plantStep:.75,treeStep:3,
 /** Funnel column foot (plan metres, grid about 4.6/D) and its canopy radius in metres. */
 column:[37.5,30.5] as Pt,canopyR:11.5,
 /** Below this, the green is too small for the building to read, and nothing is drawn. */
 minW:8.5,minD:6.6,
 /** Depth of the outdoor parking band (two rows of bays and an aisle). */
 parking:2.5,
} as const;

/**
 * Ground floor outline in plan metres, traced from the ground floor plan, clockwise from the main
 * lobby notch: up the north-west wing, east along the north side, past the north lobby dip, round
 * the supermarket crescent, west along the south side, past the south lobby dip, and up the
 * south-west wing back to the notch.
 */
export const GALLERIA_OUTLINE:Pt[]=[
 [21,24.6],[17.6,30.6],[12.6,36.8],[6.4,42.8],[1.2,47.4],[-.6,50.4],[1.4,53.6],[6,56.3],[12,58.2],[20,59.4],[30,60.2],[40.5,60.4],[47.6,59.8],
 [51,57.8],[54,56.4],[57.2,57.8],
 [61,58.6],[67,57],[72.8,51.4],[77.4,41.4],[79.7,28.4],[80.2,15.4],[79.2,5],[76.4,.4],[70,-.6],[62.4,-.1],
 [58.6,2.4],[55.4,3.6],[52.2,2.8],
 [48,1.2],[40,.6],[30,.5],[20,.9],[13.6,2],[10,3.8],[10.4,7],[13.2,11.4],[17,17.6],[19.8,22],
];
/** The atrium void on Floors 1 and 2 (a rounded quadrilateral round the funnel), plan metres. */
export const GALLERIA_ATRIUM:Pt[]=[[27,31],[32.8,41.2],[45,43.4],[54.4,39.2],[56.4,26.6],[49.4,13.6],[36.4,13.4],[30,21.6]];

/** Closed Catmull-Rom through the points, `sub` samples per span. */
export function smoothClosed(pts:Pt[],sub:number):Pt[]{
 const n=pts.length,out:Pt[]=[];
 for(let i=0;i<n;i++){
  const p0=pts[(i-1+n)%n],p1=pts[i],p2=pts[(i+1)%n],p3=pts[(i+2)%n];
  for(let k=0;k<sub;k++){
   const t=k/sub,t2=t*t,t3=t2*t;
   const f=(a:number,b:number,c:number,d:number)=>.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
   out.push([f(p0[0],p1[0],p2[0],p3[0]),f(p0[1],p1[1],p2[1],p3[1])]);
  }
 }
 return out;
}
/** Signed area; positive is counter-clockwise in x-right, y-up plan axes. */
export const area=(p:Pt[])=>p.reduce((a,[x,y],i)=>{const [u,v]=p[(i+1)%p.length];return a+x*v-u*y;},0)/2;
/** Outward unit normal at each point of a closed clockwise (in plan) outline. */
function normals(p:Pt[]):Pt[]{
 const n=p.length,sign=area(p)<0?1:-1;
 return p.map((_,i)=>{const [ax,ay]=p[(i-1+n)%n],[bx,by]=p[(i+1)%n],dx=bx-ax,dy=by-ay,l=Math.hypot(dx,dy)||1;return [sign*-dy/l,sign*dx/l];});
}
/** Arc-length share (0..1) of each point round a closed outline. */
function shares(p:Pt[]){
 const d=[0];for(let i=1;i<p.length;i++)d.push(d[i-1]+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
 const total=d[d.length-1]+Math.hypot(p[0][0]-p[p.length-1][0],p[0][1]-p[p.length-1][1]);
 return d.map(v=>v/total);
}

/** The ground outline, smoothed: the base every slab drifts from. */
export const GALLERIA_BASE=smoothClosed(GALLERIA_OUTLINE,3);
const BASE_N=normals(GALLERIA_BASE),BASE_U=shares(GALLERIA_BASE);
/**
 * How far (plan metres, outward positive) slab `level` stands from the ground outline at point i:
 * 0 is the ground floor, 1 and 2 the upper slabs, 3 the roof. Floor 1 is the largest, as in the
 * plans; the waves are out of step from slab to slab, so one overhangs where the next steps back.
 */
export function slabOffset(level:number,i:number){
 const t=BASE_U[i]*Math.PI*2;
 if(level===0)return 0;
 if(level===1)return 1.3+2.1*Math.sin(t*3+.4);
 if(level===2)return .2+2.4*Math.sin(t*4+2.1);
 return -.5+1.9*Math.sin(t*3+3.9);
}
const shift=(p:Pt[],d:(i:number)=>number):Pt[]=>untangle(p.map(([x,y],i)=>[x+BASE_N[i][0]*d(i),y+BASE_N[i][1]*d(i)]));
/** Where segments a-b and c-d cross, if they do. */
function meet(a:Pt,b:Pt,c:Pt,d:Pt):Pt|undefined{
 const r=[b[0]-a[0],b[1]-a[1]],q=[d[0]-c[0],d[1]-c[1]],den=r[0]*q[1]-r[1]*q[0];if(Math.abs(den)<1e-12)return;
 const t=((c[0]-a[0])*q[1]-(c[1]-a[1])*q[0])/den,u=((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0])/den;
 return t>0&&t<1&&u>0&&u<1?[a[0]+r[0]*t,a[1]+r[1]*t]:undefined;
}
/**
 * Offsetting a curve outward at a concave corner (the lobby notches) makes a small loop. Cut each
 * loop at its crossing, keeping the longer way round, so every slab stays a simple outline.
 */
export function untangle(p:Pt[]):Pt[]{
 let pts=p;
 for(let pass=0;pass<20;pass++){
  const n=pts.length;let fixed=false;
  for(let i=0;i<n&&!fixed;i++)for(let k=2;k<n/2&&!fixed;k++){
   const j=(i+k)%n,x=meet(pts[i],pts[(i+1)%n],pts[j],pts[(j+1)%n]);
   if(!x)continue;
   // Drop points i+1..j (the loop) and put the crossing in their place.
   const keep:Pt[]=[];for(let m=0;m<n;m++){const off=(m-i-1+n)%n;if(off<k)continue;keep.push(pts[m]);if(m===i)keep.push(x);}
   pts=keep;fixed=true;
  }
  if(!fixed)break;
 }
 return pts;
}
/** Slab edge of a level, plan metres (same point count and order as the base). */
export const slabOutline=(level:number)=>shift(GALLERIA_BASE,i=>slabOffset(level,i));
/**
 * Glazing for storey `storey` (0 ground, 1, 2), set back from both slabs it spans, so it never
 * pokes past an edge. The ground floor's shopfronts sit close to the edge; upper floors sit
 * behind a terrace's width of planting.
 */
export const glassOutline=(storey:number)=>shift(GALLERIA_BASE,i=>Math.min(slabOffset(storey,i),slabOffset(storey+1,i))-(storey===0?.5:1.6));
export const GALLERIA_ATRIUM_LINE=smoothClosed(GALLERIA_ATRIUM,4);

/** The three re-entrant points the roof valleys run to from the canopy: main, north and south lobbies. */
export const GALLERIA_VALLEYS:Pt[]=[[21,24.6],[54,56.4],[55.4,3.6]];

/** One shop or room: a plan-metre quad, what it sells or does, and which floor. */
export type GalleriaKind='shop'|'food'|'market'|'service'|'lobby'|'play'|'office'|'parking';
export interface GalleriaUnit {id:string;floor:number;name:string;kind:GalleriaKind;note:string;poly:Pt[]}
export interface GalleriaFloor {floor:number;label:string;title:string;summary:string}
/** Floors as the section draws them: basement −4.0 m, ground 0.0, Floor 1 +7.0, Floor 2 +13.0, roof +18.0. */
export const GALLERIA_FLOORS:GalleriaFloor[]=[
 {floor:0,label:'Basement',title:'Basement · Car park',summary:'Customer and staff parking, plant and storage rooms, ramp to the north'},
 {floor:1,label:'Ground',title:'Ground floor · Shops and supermarket',summary:'Main lobby, fashion, watches, jewellery, cafe, fast food, bakery and the supermarket'},
 {floor:2,label:'Floor 1',title:'Floor 1 · Food court',summary:'Food court, leather goods, cosmetics, fashion and the supermarket'},
 {floor:3,label:'Floor 2',title:'Floor 2 · Play and management',summary:'Children\'s play, arcade, jewellery, leather goods, management suite and the supermarket'},
];

/** The basement is the reference's plain 80 by 60 m box under the whole building. */
export const GALLERIA_BASEMENT:Pt[]=[[0,0],[80,0],[80,60],[0,60]];
const Q=(x0:number,y0:number,x1:number,y1:number):Pt[]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const u=(floor:number,id:string,name:string,kind:GalleriaKind,poly:Pt[],note='Planned unit · Visual only · Not selling'):GalleriaUnit=>({id:`F${floor}-${id}`,floor,name,kind,note,poly});
/**
 * Units on each floor, laid out from the reference's floor plans: shops along the outer wall of the
 * two wings, the supermarket filling the east lobe, WCs and storage at the cores. Every unit is
 * labelled by what it sells; no real shop names.
 */
export const GALLERIA_UNITS:GalleriaUnit[]=[
 // Basement: parking bays on the 10 m grid, rooms along the east side.
 u(0,'parking','Customer parking','parking',Q(4,6,52,54),'Basement parking bays on the 10 m grid. Visual only.'),
 u(0,'staff','Staff parking','parking',Q(54,10,66,48),'Staff and delivery parking. Visual only.'),
 u(0,'tech','Technical rooms','service',Q(68,30,77,46),'Maintenance staff room, technical area and duty room.'),
 u(0,'store','Central storage','service',Q(68,12,77,28),'Central storage, shop and equipment storage, waste room.'),
 // Ground floor.
 u(1,'lobby','Main lobby','lobby',[[21,24.6],[30,22],[33,30],[26,35]],'Entrance from the forecourt and fountain.'),
 u(1,'cafe','Cafe','food',[[4,46],[12,38],[19,44],[13,54]]),
 u(1,'fastfood','Fast food','food',Q(14,50,28,58)),
 u(1,'bakery','Bakery','food',Q(29,51,39,58.6)),
 u(1,'wc','WCs','service',Q(40,52,47,58.6),'Men\'s and women\'s WCs.'),
 u(1,'fashion','Fashion','shop',[[13,4],[28,2.4],[28,12],[17,14]]),
 u(1,'watches','Watches & eyewear','shop',Q(29,2.2,38,11)),
 u(1,'jewellery','Jewellery','shop',Q(39,2.2,48,11)),
 u(1,'market','Supermarket','market',[[59,10],[72,8],[77.5,24],[76,44],[66,54],[59,52]],'Supermarket: checkouts, bag check, customer service, fresh bakery, fruit and vegetables, household goods, fresh food.'),
 u(1,'goods','Goods-in & storage','service',Q(62,1.4,75,7.4),'Storage, waste room and goods-in lobby.'),
 // Floor 1.
 u(2,'leather','Leather shoes & bags','shop',[[2,48],[11,40],[17,46],[10,55]]),
 u(2,'cosmetics','Cosmetics','shop',Q(14,50,24,57.6)),
 u(2,'food','Food court','food',[[24,46],[44,47],[46,58.6],[25,58.6]],'Shared seating round the atrium. Visual only.'),
 u(2,'fashion','Fashion','shop',[[12,4],[30,2],[30,12],[16,15]]),
 u(2,'wc','WCs & storage','service',Q(31,2,40,10),'Men\'s and women\'s WCs and storage.'),
 u(2,'market','Supermarket','market',[[59,10],[72,8],[77.5,24],[76,44],[66,54],[59,52]],'Supermarket: processed foods, cosmetics, household goods, sweets and drinks.'),
 // Floor 2.
 u(3,'play','Children\'s play','play',[[13,5],[26,3.6],[27,13],[16,15]],'Children\'s play area. Visual only.'),
 u(3,'arcade','Arcade','play',Q(28,3.4,40,11),'Arcade games. Visual only.'),
 u(3,'jewellery','Jewellery','shop',Q(41,2.4,50,10)),
 u(3,'leather','Leather shoes & bags','shop',[[5,47],[12,41],[16,45],[9,54]]),
 u(3,'office','Management suite','office',Q(14,48,40,58.6),'Reception, accounts, cash office, IT, open office, director and deputy offices, meeting room. Visual only.'),
 u(3,'wc','WCs & storage','service',Q(41,51,46,57.6),'WCs and storage.'),
 u(3,'market','Supermarket','market',[[59,10],[72,8],[77.5,24],[76,44],[66,54],[59,52]],'Supermarket: dry goods and grains, household goods, sweets and drinks.'),
];

/** Point-in-polygon, even-odd. */
export function insidePoly(p:Pt[],[x,y]:Pt){
 let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const [xi,yi]=p[i],[xj,yj]=p[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;
}

/** A box standing on the ground: y is its base above the terrace top. */
export interface GalleriaBox {x:number;z:number;w:number;d:number;h:number;y:number;c:string;r?:number}
export interface GalleriaPlan {
 /** The lot (the old garden green) and the building's own bounding box on the map. */
 rect:Rect;footprint:Rect;
 /** Plan metres to map units, and back. */
 s:number;toMap:(p:Pt)=>Pt;
 y0:number;
 /** Slab outlines (ground, Floor 1, Floor 2, roof), glazing per storey, atrium, all on the map. */
 slabs:Pt[][];glass:Pt[][];atrium:Pt[];
 /** Height of each slab's top above y0. */
 levels:number[];roof:number;
 column:{x:number;z:number;r:number;top:number};
 entrance:{x:number;z:number};fountain:{x:number;z:number;r:number};
 boxes:GalleriaBox[];rounds:GalleriaBox[];
 trees:Tree[];bushes:Point[];
 /** Street lamps round the building and along the entrance promenade, facing the ground they light. */
 lamps:GalleriaLamp[];
 /** The entrance promenade's centre line, from the forecourt out to the lot edge and along the front. */
 promenade:Pt[];
 /** Outdoor parking, when the lot is deep enough for it, and the bays kept free for drivers. */
 parking?:{x0:number;x1:number;z0:number;z1:number;aisleZ:number;slots:{x:number;z:number}[]};
}
export interface GalleriaLamp {x:number;z:number;yaw:number}

const inRect=(r:Rect,x:number,z:number,pad=0)=>x>=r.x-pad&&x<=r.x+r.w+pad&&z>=r.z-pad&&z<=r.z+r.d+pad;
const overlaps=(a:Rect,b:Rect)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.z<b.z+b.d&&a.z+a.d>b.z;

/** Height above y0 of the top of slab `level` (0 ground floor, 1 and 2, 3 roof). */
export function slabTop(level:number){let h=0;for(let i=0;i<level;i++)h+=GALLERIA.storeys[i];return h;}

/**
 * Places the mall on the green behind the Marketplace. The main entrance faces east, the
 * supermarket lobe west, and the plan's north side (outdoor parking and the basement ramp) faces
 * the Marketplace. Returns nothing when the green is missing, too small, or has anything on it.
 */
export function planGalleria(mall:MallPlan,land:Rect[],blockers:Rect[],y:number):GalleriaPlan|undefined{
 const G=GALLERIA,axis=mall.cx;
 const green=land.find(r=>inRect(r,axis,mall.z-1)&&r.w>=6&&r.d>=6);
 if(!green)return;
 const half=Math.min(axis-(green.x+G.edge),green.x+green.w-G.edge-axis);
 const z0=green.z+G.edge,z1=mall.z-G.back;
 if(half*2<G.minW||z1-z0<G.minD)return;
 const rect={x:axis-half,z:z0,w:half*2,d:z1-z0};
 if(blockers.some(b=>overlaps(b,rect)))return;
 // Every slab's extent, so overhangs stay on the lot too.
 const all=[0,1,2,3].flatMap(slabOutline);
 const minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),maxY=Math.max(...all.map(p=>p[1]));
 const s=Math.min(G.maxScale,rect.w/(maxX-minX),rect.d/(maxY-minY));
 if(s<G.minScale)return;
 // 180° turn: plan east is map west (-x), plan north is map south (+z).
 // The building takes the lot's north end; parking and trees fill the south toward the Marketplace.
 const ox=rect.x+rect.w/2+(maxX+minX)/2*s,oz=rect.z-minY*s;
 const toMap=([px,py]:Pt):Pt=>[ox-px*s,oz+py*s];
 const footprint={x:ox-maxX*s,z:oz+minY*s,w:(maxX-minX)*s,d:(maxY-minY)*s};
 const slabs=[0,1,2,3].map(l=>slabOutline(l).map(toMap)),glass=[0,1,2].map(l=>glassOutline(l).map(toMap));
 const atrium=GALLERIA_ATRIUM_LINE.map(toMap),levels=[0,1,2,3].map(slabTop),roof=levels[3];
 const [cx,cz]=toMap(G.column);
 const column={x:cx,z:cz,r:G.canopyR*s,top:roof+G.slab+.34};

 const boxes:GalleriaBox[]=[],rounds:GalleriaBox[]=[],trees:Tree[]=[],bushes:Point[]=[];
 // Forecourt in the entrance notch, a round white fountain on it, and the name on a low plinth.
 const [ex,ez]=toMap([4,27]),[fx,fz]=toMap([7.5,27.5]),fr=3*s;
 const [fa,fb]=[toMap([-3,8]),toMap([24,46])];
 boxes.push({x:(fa[0]+fb[0])/2,z:(fa[1]+fb[1])/2,w:Math.abs(fb[0]-fa[0]),d:Math.abs(fb[1]-fa[1]),h:.02,y:0,c:'#dcd3bd'});
 rounds.push({x:fx,z:fz,w:fr*2,d:fr*2,h:.12,y:0,c:'#f7f7f0'},{x:fx,z:fz,w:fr*1.7,d:fr*1.7,h:.01,y:.12,c:'#5aaac0'},{x:fx,z:fz,w:fr*.5,d:fr*.5,h:.3,y:.12,c:'#f7f7f0'});
 // A path from the forecourt out to the walkway on the lot's east edge.
 boxes.push({x:(rect.x+rect.w+ex)/2+.2,z:ez,w:rect.x+rect.w-ex+.7,d:.55,h:.015,y:0,c:'#dcd3bd'});
 // Outdoor parking between the building and the Marketplace, with the basement ramp at its head.
 const pz0=footprint.z+footprint.d+.25,pz1=Math.min(rect.z+rect.d-.15,pz0+G.parking);
 let parking:GalleriaPlan['parking'];
 if(pz1-pz0>=1.4){
  const px0=rect.x+.3,px1=rect.x+rect.w-.3;
  const lot={x0:px0,x1:px1,z0:pz0,z1:pz1,aisleZ:(pz0+pz1)/2,slots:[] as {x:number;z:number}[]};parking=lot;
  boxes.push({x:(px0+px1)/2,z:(pz0+pz1)/2,w:px1-px0,d:pz1-pz0,h:.012,y:0,c:'#5d6360'});
  const rows=pz1-pz0>=2.6?2:1,rowD=.62,bay=.34;
  for(let r=0;r<rows;r++){
   const zr=r===0?pz0+.1+rowD/2:pz1-.1-rowD/2;
   for(let x=px0+.15,k=0;x<=px1-.1;x+=bay,k++){
    boxes.push({x,z:zr,w:.025,d:rowD,h:.004,y:.012,c:'#f3efe4'});
    // A few parked cars, deterministic.
    // Two bays in the row by the building stay empty for the drivers' own cars (galleriaLife).
    if(r===0&&k%3===0&&x+bay<px1&&(k===3||k===12))lot.slots.push({x:x+bay/2,z:zr});
    if(k%3===1&&x+bay<px1){const c=['#b7c2c7','#2f3a45','#e8e4da','#8c3b34'][k%4];boxes.push({x:x+bay/2,z:zr,w:.2,d:.38,h:.1,y:.012,c},{x:x+bay/2,z:zr,w:.17,d:.2,h:.07,y:.11,c:'#26323a'});}
   }
  }
  // Ramp down to the basement, as the basement plan draws it, from the plan's north side.
  const [rx]=toMap([30,0]);
  boxes.push({x:rx,z:footprint.z+footprint.d+.05,w:1.2,d:.6,h:.006,y:.012,c:'#2b302e'});
  for(const side of [-1,1])boxes.push({x:rx+side*.62,z:footprint.z+footprint.d+.05,w:.05,d:.6,h:.16,y:0,c:'#e8e4da'});
 }
 // Roof valleys from the canopy out to the three lobbies, a shade darker than the leaves.
 for(const v of GALLERIA_VALLEYS){
  const [vx,vz]=toMap(v),dx=vx-cx,dz=vz-cz,len=Math.hypot(dx,dz)-column.r*.95;
  const k=column.r*.95/Math.hypot(dx,dz);
  boxes.push({x:cx+dx*(k+(1-k)/2),z:cz+dz*(k+(1-k)/2),w:.16,d:len,h:.03,y:roof+G.slab,c:'#b7bab4',r:Math.atan2(dx,dz)});
 }
 // Planted terraces on every slab lip: bushes along the planter, a small tree now and then.
 for(let l=1;l<=3;l++){
  const lip=shift(GALLERIA_BASE,i=>slabOffset(l,i)-1.1).map(toMap),top=y+levels[l]+G.slab+.05;
  const ring=[...lip,lip[0]];
  for(const [i,p] of along(ring,G.plantStep).entries())bushes.push({x:p.x,y:top,z:p.z,s:.085+.03*((i*7)%3)/2});
  for(const p of along(ring,G.treeStep))trees.push({x:p.x,y:top,z:p.z,s:.15,kind:'round'});
 }
 // Trees round the lot, clear of the building, the forecourt and the parking.
 const clear=(x:number,z:number)=>!inRect(footprint,x,z,.4)&&!inRect({x:Math.min(fa[0],fb[0]),z:Math.min(fa[1],fb[1]),w:Math.abs(fb[0]-fa[0]),d:Math.abs(fb[1]-fa[1])},x,z,.2)&&z<pz0-.3;
 for(let z=rect.z+.35;z<rect.z+rect.d-.3;z+=1.15)for(const x of [rect.x+.3,rect.x+rect.w-.3])if(clear(x,z))trees.push({x,y,z,s:.24,kind:z%2>1?'blossom':'round'});
 for(let x=rect.x+1.2;x<rect.x+rect.w-1;x+=1.15)if(clear(x,rect.z+.3))trees.push({x,y,z:rect.z+.3,s:.24,kind:'round'});
 // A row of blossom trees between the parking and the Marketplace, where there is room.
 if(rect.z+rect.d-pz1>.8)for(let x=rect.x+.9;x<rect.x+rect.w-.6;x+=1.05)trees.push({x,y,z:(pz1+rect.z+rect.d)/2,s:.22,kind:'blossom'});
 // Entrance promenade: the forecourt path runs out to a paved walk along the lot's front edge.
 const fx1=Math.max(fa[0],fb[0]),pxw=Math.min(rect.x+rect.w-.45,fx1+.55),zTop=rect.z+.45,zEnd=Math.min(rect.z+rect.d-.45,parking?parking.z1:rect.z+rect.d-.45);
 boxes.push({x:pxw,z:(zTop+zEnd)/2,w:.5,d:zEnd-zTop,h:.016,y:0,c:'#e3dccb'});
 for(let z=zTop+.3;z<zEnd;z+=.5)boxes.push({x:pxw,z,w:.5,d:.02,h:.004,y:.016,c:'#cbbf9f'});
 const promenade:Pt[]=[[ex,ez],[pxw,ez],[pxw,zTop],[pxw,zEnd]];
 for(let i=trees.length-1;i>=0;i--)if(trees[i].y===y&&Math.abs(trees[i].x-pxw)<.5&&trees[i].z>zTop-.4&&trees[i].z<zEnd+.4)trees.splice(i,1);
 // Street lamps: along the promenade's outer side, and round the lot just inside its tree line.
 const lamps:GalleriaLamp[]=[];
 // Clear of the real (curved) building outline on every floor, not its bounding box: the lot's corners are open ground.
 const nearSlab=(x:number,z:number)=>slabs.some(sl=>insidePoly(sl,[x,z])||sl.some((a,i)=>{const b=sl[(i+1)%sl.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(a[0]+dx*t-x,a[1]+dz*t-z)<.3;}));
 const free=(x:number,z:number)=>!nearSlab(x,z)&&!(parking&&inRect({x:parking.x0,z:parking.z0,w:parking.x1-parking.x0,d:parking.z1-parking.z0},x,z,-.05))&&!lamps.some(l=>Math.hypot(l.x-x,l.z-z)<1.25)&&Math.hypot(x-fx,z-fz)>fr+.4;
 for(let z=zTop+.2;z<=zEnd;z+=1.6){const x=pxw+.42;if(free(x,z))lamps.push({x,z,yaw:-Math.PI/2});}
 for(let x=rect.x+.35;x<pxw-.4;x+=1.3)if(free(x,rect.z+.2))lamps.push({x,z:rect.z+.2,yaw:0});
 for(let z=rect.z+.6;z<(parking?parking.z0:rect.z+rect.d-.4);z+=1.3)if(free(rect.x+.2,z))lamps.push({x:rect.x+.2,z,yaw:Math.PI/2});
 // Round the building's own curves too: one lamp a little out from the ground floor every so often.
 {const g0=slabs[0],cxm=g0.reduce((a,p)=>a+p[0],0)/g0.length,czm=g0.reduce((a,p)=>a+p[1],0)/g0.length;
  for(let i=0;i<g0.length;i+=Math.max(1,Math.round(g0.length/14))){const [px,pz]=g0[i],dx=px-cxm,dz=pz-czm,l=Math.hypot(dx,dz)||1,x=px+dx/l*.45,z=pz+dz/l*.45;if(inRect(rect,x,z,-.15)&&free(x,z))lamps.push({x,z,yaw:Math.atan2(-dx,-dz)});}}
 if(parking)for(const x of [parking.x0+.6,(parking.x0+parking.x1)/2,parking.x1-.9])if(!lamps.some(l=>Math.hypot(l.x-x,l.z-parking.z1-.12)<1.25))lamps.push({x,z:parking.z1+.12,yaw:Math.PI});
 // A lamp takes the place of any lot tree it would stand in.
 for(let i=trees.length-1;i>=0;i--)if(trees[i].y===y&&lamps.some(l=>Math.hypot(l.x-trees[i].x,l.z-trees[i].z)<.35))trees.splice(i,1);
 return {rect,footprint,s,toMap,y0:y,slabs,glass,atrium,levels,roof,column,entrance:{x:ex,z:ez},fountain:{x:fx,z:fz,r:fr},boxes,rounds,trees,bushes,lamps,promenade,parking};
}

export interface GalleriaFin {x:number;z:number;y:number;h:number;a:number;level:number}
/** White fins on every band: from the parapet above a slab down to a wavy hem below it. */
export function galleriaFins(p:Pick<GalleriaPlan,'slabs'|'levels'|'y0'>):GalleriaFin[]{
 const G=GALLERIA,fins:GalleriaFin[]=[];
 for(let l=1;l<=3;l++){
  const line=[...p.slabs[l],p.slabs[l][0]],top=p.y0+p.levels[l]+G.slab+G.rail,below=G.storeys[l-1];
  for(const f of along(line,G.finStep)){const h=G.rail+G.slab+below*hem(f.u,l);fins.push({x:f.x,z:f.z,a:f.a,y:top-h,h,level:l});}
 }
 return fins;
}
/** How far a band hangs below its slab, as a share of the storey below, at distance u round it. */
export function hem(u:number,level:number){
 const [lo,hi]=GALLERIA.hang,w=.5+.55*Math.sin(u*.36+level*1.9)+.12*Math.sin(u*1.1+level);
 return lo+(hi-lo)*Math.min(1,Math.max(0,w));
}

/** Every instanced piece the mall adds (fins, boxes, rounds, plants); held to a budget in galleriaPlan.test.ts. */
export function galleriaPieceCount(p:GalleriaPlan){
 const trees=p.trees.length*5;
 return galleriaFins(p).length+p.boxes.length+p.rounds.length+trees+p.bushes.length*2;
}
