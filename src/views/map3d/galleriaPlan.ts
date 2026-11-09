import {carBoxes,galleriaCar,type GalleriaCarKind} from './galleriaFleet';
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
 /** Widest lot it takes: the building at full scale and its parking, so a wider green (a bigger
  *  neighbouring district) leaves open lawn instead of more trees the map has no triangles for. */
 maxW:10.8,
 /** Deepest lot it takes (building, parking and a row of trees), and how far north of the Marketplace it looks. */
 maxD:13.65,search:26,
 /** Depth of the outdoor parking band (two rows of bays and an aisle). */
 parking:2.5,
 /** Pavement round the whole building, plan metres past the ground floor, and past the widest overhang above it. */
 apron:6,apronPastOverhang:4,
} as const;
/** The main entrance: the apex of the V-notch on the ground floor outline, plan metres. */
export const GALLERIA_NOTCH:Pt=[21,24.6];

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
/** The paved apron round the building (plan metres): the forecourt's stone carried all the way round, wide enough to clear every overhang. */
export const apronOutline=()=>shift(GALLERIA_BASE,i=>Math.max(GALLERIA.apron,Math.max(slabOffset(1,i),slabOffset(2,i),slabOffset(3,i))+GALLERIA.apronPastOverhang));

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
 slabs:Pt[][];
 /** The paved apron round the whole building, on the map. */
 apron:Pt[];glass:Pt[][];atrium:Pt[];
 /** Height of each slab's top above y0. */
 levels:number[];roof:number;
 column:{x:number;z:number;r:number;top:number};
 entrance:{x:number;z:number};fountain:{x:number;z:number;r:number};
 boxes:GalleriaBox[];rounds:GalleriaBox[];
 trees:Tree[];bushes:Point[];
 /** The outdoor car park, its drive aisle, and the parked cars that drivers take out (drawn by galleriaLife, not as boxes). */
 parking?:{area:Rect;aisle:number;driven:{x:number;z:number;c:string;kind:GalleriaCarKind;yaw:number}[]};
}

const inRect=(r:Rect,x:number,z:number,pad=0)=>x>=r.x-pad&&x<=r.x+r.w+pad&&z>=r.z-pad&&z<=r.z+r.d+pad;

/** Streets and footpaths the lot keeps clear of: half a road and its sidewalk, or half a walk and a margin. */
export interface GalleriaPaths {roads:Pt[][];walks:Pt[][]}
const ROAD_CLEAR=.95,WALK_CLEAR=.5,LOT_STEP=.1;
const segDist=(x:number,z:number,a:Pt,b:Pt)=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l));return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);};
/**
 * The lot behind the Marketplace, centred on its axis. The green there is often several pieces of
 * land side by side (the Skyline green, a district's spare land, the boulevard's causeway), and when
 * a catalog change moves the Marketplace the boulevard can cut across it. So the lot is found row by
 * row going north from the Marketplace's back wall: a row counts where it is on land, clear of every
 * building, street and walk, and at least minW wide. The first run of such rows deep enough for the
 * building is the lot (beyond a street if the strip in front of it is too shallow), at most maxD deep.
 * `across` is true when a street, not the Marketplace's back wall, bounds the lot's south side.
 */
export function galleriaLot(mall:Pick<MallPlan,'cx'|'z'>,land:Rect[],blockers:Rect[],paths:GalleriaPaths):{rect:Rect;across:boolean}|undefined{
 const G=GALLERIA,axis=mall.cx,far=G.maxW/2+G.edge+.2,zEnd=mall.z-G.back,zFar=zEnd-G.search;
 const near=(r:Rect)=>r.x<axis+far&&r.x+r.w>axis-far&&r.z<zEnd+.5&&r.z+r.d>zFar-.5;
 const ground=land.filter(near),blocks=blockers.filter(near);
 const box=(pts:Pt[],pad:number):Rect=>{const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]);return {x:Math.min(...xs)-pad,z:Math.min(...zs)-pad,w:Math.max(...xs)-Math.min(...xs)+pad*2,d:Math.max(...zs)-Math.min(...zs)+pad*2};};
 const segs:[Pt,Pt,number][]=[];
 for(const [lines,pad] of [[paths.roads,ROAD_CLEAR],[paths.walks,WALK_CLEAR]] as const)for(const l of lines)for(let i=1;i<l.length;i++)if(near(box([l[i-1],l[i]],pad)))segs.push([l[i-1],l[i],pad]);
 const ok=(x:number,z:number)=>ground.some(r=>inRect(r,x,z))&&!blocks.some(b=>x>b.x&&x<b.x+b.w&&z>b.z&&z<b.z+b.d)&&segs.every(([a,b,pad])=>segDist(x,z,a,b)>=pad);
 // Half-width open on both sides of the axis along row z (edge included), up to maxW/2.
 const open=(z:number)=>{let h=0;while(h+.05<=G.maxW/2&&ok(axis-h-G.edge-.05,z)&&ok(axis+h+G.edge+.05,z))h+=.05;return h;};
 let south:number|undefined,north:number|undefined,half=Infinity;
 for(let z=zEnd;z>=zFar&&north===undefined;z-=LOT_STEP){
  const h=open(z);
  if(h*2>=G.minW){
   if(south===undefined){south=z;half=h;}
   else if(south-z>=G.maxD+G.edge)north=z;
   else half=Math.min(half,h);
  }else if(south!==undefined){
   // Too shallow in front of a street: look again beyond it.
   if(south-z-2*G.edge>=G.minD)north=z;else{south=undefined;half=Infinity;}
  }
 }
 if(south===undefined)return;
 north??=zFar;
 const z0=north+G.edge,z1=south===zEnd?south:south-G.edge;
 if(z1-z0<G.minD||half*2<G.minW)return;
 return {rect:{x:axis-half,z:z0,w:half*2,d:z1-z0},across:south!==zEnd};
}

/** Height above y0 of the top of slab `level` (0 ground floor, 1 and 2, 3 roof). */
export function slabTop(level:number){let h=0;for(let i=0;i<level;i++)h+=GALLERIA.storeys[i];return h;}

/**
 * Places the mall on the green behind the Marketplace. The main entrance faces east, the
 * supermarket lobe west, and the plan's north side (outdoor parking) faces
 * the Marketplace. Returns nothing when the green is missing, too small, or has anything on it.
 */
export function planGalleria(mall:MallPlan,land:Rect[],blockers:Rect[],y:number,paths:GalleriaPaths={roads:[],walks:[]}):GalleriaPlan|undefined{
 const G=GALLERIA,lot=galleriaLot(mall,land,blockers,paths);
 if(!lot)return;
 const rect=lot.rect;
 // Every slab's extent, so overhangs stay on the lot too.
 const all=[0,1,2,3].flatMap(slabOutline);
 const minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),maxY=Math.max(...all.map(p=>p[1]));
 const s=Math.min(G.maxScale,rect.w/(maxX-minX),rect.d/(maxY-minY));
 if(s<G.minScale)return;
 // Across a street from the Marketplace, the building and its car park sit on the street side of the
 // lot, so the car park opens onto the street; the rest stays open meadow, with no extra trees.
 const apronPlan=apronOutline(),apronMaxY=Math.max(...apronPlan.map(p=>p[1]));
 if(lot.across){const d=Math.min(rect.d,(Math.max(maxY,apronMaxY)-minY)*s+.15+G.parking+.2);rect.z+=rect.d-d;rect.d=d;}
 // 180° turn: plan east is map west (-x), plan north is map south (+z).
 // The building takes the lot's north end; parking and trees fill the south toward the Marketplace.
 const ox=rect.x+rect.w/2+(maxX+minX)/2*s,oz=rect.z-minY*s;
 const toMap=([px,py]:Pt):Pt=>[ox-px*s,oz+py*s];
 const footprint={x:ox-maxX*s,z:oz+minY*s,w:(maxX-minX)*s,d:(maxY-minY)*s};
 const slabs=[0,1,2,3].map(l=>slabOutline(l).map(toMap)),glass=[0,1,2].map(l=>glassOutline(l).map(toMap));
 const apron=apronPlan.map(toMap);
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
 // Outdoor parking between the building and the Marketplace, shifted out past the apron so the pavement runs right round.
 const pz0=Math.max(footprint.z+footprint.d+.25,oz+apronMaxY*s+.15),pz1=Math.min(rect.z+rect.d-.15,pz0+G.parking);
 let parking:GalleriaPlan['parking'];
 if(pz1-pz0>=1.4){
  const px0=rect.x+.3,px1=rect.x+rect.w-.3;
  boxes.push({x:(px0+px1)/2,z:(pz0+pz1)/2,w:px1-px0,d:pz1-pz0,h:.012,y:0,c:'#5d6360'});
  const rows=pz1-pz0>=2.6?2:1,rowD=.62,bay=.34;
  // One row backs onto the aisle beside the other; with a single row the aisle runs along its open side.
  parking={area:{x:px0,z:pz0,w:px1-px0,d:pz1-pz0},aisle:rows===2?(pz0+pz1)/2:pz1-.25,driven:[]};let cars=0;
  for(let r=0;r<rows;r++){
   const zr=r===0?pz0+.1+rowD/2:pz1-.1-rowD/2;
   for(let x=px0+.15,k=0;x<=px1-.1;x+=bay,k++){
    boxes.push({x,z:zr,w:.025,d:rowD,h:.004,y:.012,c:'#f3efe4'});
    // Two bays in three are taken, by a deterministic mix of the fleet, nose in toward the building.
    if(k%3!==0&&x+bay<px1){const {kind,c}=galleriaCar(cars),yaw=r===0?Math.PI:0;
     // Every third car in the first row belongs to a driver who comes and goes (up to five).
     if(r===0&&cars++%3===0&&parking.driven.length<5)parking.driven.push({x:x+bay/2,z:zr,c,kind,yaw});
     else{if(r!==0)cars++;for(const b of carBoxes(kind,c,[x+bay/2,zr],yaw,.012))boxes.push(b);}}
   }
  }
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
 const clear=(x:number,z:number)=>!inRect(footprint,x,z,.4)&&!insidePoly(apron,[x,z])&&!inRect({x:Math.min(fa[0],fb[0]),z:Math.min(fa[1],fb[1]),w:Math.abs(fb[0]-fa[0]),d:Math.abs(fb[1]-fa[1])},x,z,.2)&&z<pz0-.3;
 for(let z=rect.z+.35;z<rect.z+rect.d-.3;z+=1.15)for(const x of [rect.x+.3,rect.x+rect.w-.3])if(clear(x,z))trees.push({x,y,z,s:.24,kind:z%2>1?'blossom':'round'});
 for(let x=rect.x+1.2;x<rect.x+rect.w-1;x+=1.15)if(clear(x,rect.z+.3))trees.push({x,y,z:rect.z+.3,s:.24,kind:'round'});
 // A row of blossom trees between the parking and the Marketplace, where there is room.
 if(rect.z+rect.d-pz1>.8)for(let x=rect.x+.9;x<rect.x+rect.w-.6;x+=1.05)trees.push({x,y,z:(pz1+rect.z+rect.d)/2,s:.22,kind:'blossom'});
 return {parking,rect,footprint,s,toMap,y0:y,slabs,apron,glass,atrium,levels,roof,column,entrance:{x:ex,z:ez},fountain:{x:fx,z:fz,r:fr},boxes,rounds,trees,bushes};
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
