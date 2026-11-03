import {CIRCA_CORRIDOR as C,CIRCA_PARTY_WALL,CIRCA_PLATE,CIRCA_UNITS_EAST,circaEdgeX,circaEdgeZ,circaRim,circaUnits,mirrorX} from "./circaFloors";

/**
 * Pure part lists for Circa's pool deck and apartment floors inside "Enter building".
 * Every list renders as one instanced mesh per material, so a floor costs a handful of draw calls
 * however much furniture it holds. A stylized, unofficial take: no signage, logos or real floor plans.
 * Coordinates are on the oval plate (CIRCA_PLATE, x ±10.2, z ±7.4); rooms keep the 16 × 12 grid inside it. `p` is the centre of each piece.
 */
export type V3=[number,number,number];
/** r turns about y; rx then tilts the piece (Euler order YXZ). */
export type Part={p:V3;s:V3;c:string;r?:number;rx?:number};
export type Parts={
  /** Opaque boxes. */ box:Part[];
  /** Opaque cylinders (unit cylinder: s = [diameter x, height, diameter z]). */ round:Part[];
  /** Emissive boxes: lamps, lantern strips, pendants. Night glow comes only from these. */ glow:Part[];
  /** Clear glass boxes. */ glass:Part[];
  /** Pool water cylinders and boxes are split so each keeps one draw call. */ waterRound:Part[];
  waterBox:Part[];
};
export const emptyParts=():Parts=>({box:[],round:[],glow:[],glass:[],waterRound:[],waterBox:[]});

/** Wall height on the far sides and the cutaway height used on near partitions. */
export const WALL={full:3.2,low:1.1,t:.1};
const col={
  oak:"#d8c09a",plank:"#c8ae86",wall:"#f1eee8",black:"#1b1b1d",cabinet:"#c9c6c0",quartz:"#f6f4ef",steel:"#a9abad",
  walnut:"#5b3a26",liveEdge:"#a8743f",cognac:"#9a5a2e",rug:"#8e8f8c",brass:"#c9a35a",marble:"#f3efe8",bathStone:"#bdbab4",
  hex:"#9d9c98",sheet:"#f4f1ea",duvet:"#e3ddd2",greySofa:"#a9aaa8",bronze:"#7a5a36",champagne:"#d8cbb0",column:"#f2f0ec",
  paving:"#d9d2c2",stone:"#bfb7a6",white:"#f7f5f0",turquoise:"#4fa7a6",green:"#4f6b3f",palm:"#6f5a43",teak:"#8b6a4a",ember:"#3a3a3a",
};
/** Sofa colours rotate by floor so the stacked floors don't look cloned. */
const SOFAS=["#36533c","#26314f","#cdbfa6"];

/** Push a box whose base sits at y0. */
function b(out:Part[],x:number,y0:number,z:number,w:number,h:number,d:number,c:string,r=0){out.push({p:[x,y0+h/2,z],s:[w,h,d],c,...(r?{r}:{})});}
/** A wall along x (constant z) from xa to xb, leaving any door gaps open. */
function wallX(out:Part[],z:number,xa:number,xb:number,h:number,gaps:[number,number][]=[],c=col.wall){
  let x=xa;for(const [g0,g1] of [...gaps].sort((a,b2)=>a[0]-b2[0])){if(g0>x)b(out,(x+g0)/2,0,z,g0-x,h,WALL.t,c);x=Math.max(x,g1);}
  if(xb>x)b(out,(x+xb)/2,0,z,xb-x,h,WALL.t,c);
}
/** A wall along z (constant x) from za to zb, leaving any door gaps open. */
function wallZ(out:Part[],x:number,za:number,zb:number,h:number,gaps:[number,number][]=[],c=col.wall){
  let z=za;for(const [g0,g1] of [...gaps].sort((a,b2)=>a[0]-b2[0])){if(g0>z)b(out,x,0,(z+g0)/2,WALL.t,h,g0-z,c);z=Math.max(z,g1);}
  if(zb>z)b(out,x,0,(z+zb)/2,WALL.t,h,zb-z,c);
}

/** Oval floor finish filling the plate, with faint lines `step` apart running along x (or along z when `alongZ`). */
function ovalFloor(o:Parts,c:string,line:string,step:number,alongZ=false){
  o.round.push({p:[0,.025,0],s:[CIRCA_PLATE.rx*2,.03,CIRCA_PLATE.rz*2],c});
  if(alongZ){for(let x=-CIRCA_PLATE.rx+step;x<CIRCA_PLATE.rx;x+=step){const d=circaEdgeZ(x)*2-.12;if(d>.2)b(o.box,x,.04,0,.012,.002,d,line);}}
  else for(let z=-CIRCA_PLATE.rz+step;z<CIRCA_PLATE.rz;z+=step){const w=circaEdgeX(z)*2-.12;if(w>.2)b(o.box,0,.04,z,w,.002,.015,line);}
}
/**
 * The curved glass around the plate: black sill, mullions and head with clear glass between.
 * Full height where `tall` says so (the far side of the cutaway), otherwise a low glass rail so the rooms stay visible.
 */
function glassRim(o:Parts,tall:(x:number,z:number)=>boolean,full=WALL.full,rail=.95){
  circaRim(64,.06).forEach((seg,i)=>{
    const h=tall(seg.x,seg.z)?full:rail;
    o.glass.push({p:[seg.x,h/2,seg.z],s:[seg.len,h,.04],c:"#cfe3ea",r:seg.r});
    if(i%2===0)b(o.box,seg.xa,0,seg.za,.04,h,.06,col.black,seg.r);
    b(o.box,seg.x,0,seg.z,seg.len,.1,.1,col.black,seg.r);
    b(o.box,seg.x,h-.035,seg.z,seg.len,.035,.07,col.black,seg.r);
  });
  // Night: a warm LED cove under the head of the tall glass and a low step light along the rail.
  for(const seg of circaRim(64,.16)){const t=tall(seg.x,seg.z);o.glow.push({p:[seg.x,t?full-.1:.12,seg.z],s:[seg.len,t?.03:.015,t?.05:.03],c:"#ffe6bf",r:seg.r});}
}

function bed(o:Parts,x:number,z:number,r:number,w=1.6){
  // Bed runs along x when r = 0 with the headboard at the low-x end.
  const L=2.05,c=Math.cos(r),s=Math.sin(r),at=(dx:number,dz:number):[number,number]=>[x+dx*c+dz*s,z-dx*s+dz*c];
  const put=(dx:number,dz:number,y0:number,lw:number,h:number,ld:number,cc:string)=>{const [px,pz]=at(dx,dz);b(o.box,px,y0,pz,lw,h,ld,cc,r);};
  put(0,0,0,L,.3,w+.1,col.walnut);put(.05,0,.3,L-.15,.18,w,col.sheet);put(.35,0,.48,L*.55,.05,w+.02,col.duvet);
  put(-L/2+.04,0,0,.1,1.05,w+.2,col.walnut);
  for(const side of [-1,1]){put(-L/2+.35,side*w*.25,.48,.35,.12,w*.42,col.white);put(-L/2+.2,side*(w/2+.4),0,.42,.5,.42,col.walnut);
    const [lx,lz]=at(-L/2+.2,side*(w/2+.4));o.glow.push({p:[lx,.62,lz],s:[.16,.18,.16],c:"#fff1d6"});}
}
function bath(o:Parts,x0:number,x1:number,z0:number,z1:number,tubAlongX:boolean,flip:number){
  b(o.box,(x0+x1)/2,.03,(z0+z1)/2,x1-x0-.1,.012,z1-z0-.1,col.hex);
  for(let x=x0+.25;x<x1-.1;x+=.25)b(o.box,x,.043,(z0+z1)/2,.01,.002,z1-z0-.12,"#8a8985");
  // Tub against the far wall, grey marble surround, white floating vanity with a lit mirror, toilet.
  // Slim tub and vanity so there's a clear standing spot between them.
  if(tubAlongX){const tz=flip>0?z0+.36:z1-.36;b(o.box,x0+.85,.04,tz,1.5,.5,.6,col.white);b(o.box,x0+.85,.4,tz,1.3,.12,.42,"#d9e7ea");b(o.box,x0+.85,.54,tz-flip*.32,1.6,1.4,.04,col.bathStone);}
  const vx=x1-.55,vz=flip>0?z1-.28:z0+.28;b(o.box,vx,.35,vz,.9,.4,.4,col.white);b(o.box,vx,.75,vz,.95,.04,.42,col.quartz);
  o.glow.push({p:[vx,1.5,flip>0?z1-.07:z0+.07],s:[.7,.75,.02],c:"#eef3f2"});
  // Toilet in the corner away from the vanity; without a tub it moves to the other wall to keep the doorway clear.
  o.round.push({p:[x0+.45,.22,(flip>0)===tubAlongX?z1-.4:z0+.4],s:[.36,.42,.5],c:col.white});
}

/** Furniture and partitions of the west 1 bed; the east unit mirrors it about the party wall. */
function oneBed(o:Parts,mirror:boolean,sofa:string){
  const loc=emptyParts(),X0=-8,Z0=C.z1;
  // Rooms: bath (corridor corner) and bedroom along the west wall, open kitchen, dining and living to the east.
  wallX(loc.box,2.9,-circaEdgeX(2.9)+.12,-5.4,WALL.low);
  wallZ(loc.box,-5.4,Z0,circaEdgeZ(-5.4)-.12,WALL.low,[[1.6,2.2],[3.45,4.35]]);
  bath(loc,X0,-5.4,Z0,2.9,true,1);
  // Bed headboard on the bath wall, foot toward the curved glass; wardrobe on the bedroom's east wall.
  bed(loc,-6.75,4.0,-Math.PI/2,1.4);
  b(loc.box,-5.68,0,5.0,.45,1.9,1.2,col.walnut);
  // Galley kitchen on the corridor wall: grey flat panels, quartz top, stainless range, tall fridge column.
  b(loc.box,-3.9,0,1.38,2.6,.86,.6,col.cabinet);b(loc.box,-3.9,.86,1.38,2.64,.05,.64,col.quartz);
  b(loc.box,-3.5,.86,1.38,.62,.03,.5,col.steel);b(loc.box,-4.6,.88,1.38,.5,.02,.36,"#6f7173");
  b(loc.box,-2.4,0,1.4,.56,2.1,.62,col.cabinet);b(loc.box,-2.4,.95,1.71,.02,.6,.02,col.steel);
  // Stacked washer/dryer closet by the door.
  b(loc.box,-1.0,0,1.38,.45,1.7,.6,col.white);b(loc.box,-1.0,.5,1.08,.3,.3,.02,"#7d8186");
  // Live-edge wood dining table on black trestles, four black shell chairs.
  b(loc.box,-3.3,.72,2.95,1.8,.07,.82,col.liveEdge);for(const dx of [-.6,.6])b(loc.box,-3.3+dx,0,2.95,.08,.72,.6,col.black);
  for(const [dx,dz] of [[-.45,-.62],[.45,-.62],[-.45,.62],[.45,.62]] as const){b(loc.box,-3.3+dx,.42,2.95+dz,.42,.06,.42,col.black);b(loc.box,-3.3+dx,.48,2.95+dz+Math.sign(dz)*.19,.42,.38,.05,col.black);
    for(const sx of [-.15,.15])b(loc.box,-3.3+dx+sx,0,2.95+dz,.03,.42,.03,col.walnut);}
  for(const dx of [-.3,.3]){b(loc.box,-3.3+dx,.79,2.95,.03,.32,.03,col.white);}
  // Living room at the glass: velvet sofa, walnut coffee table, cognac sling chair, brass floor lamp, walnut sideboard.
  b(loc.box,-2.7,.03,4.75,2.9,.012,1.9,col.rug);
  b(loc.box,-3.1,0,5.45,2.1,.42,.85,sofa);b(loc.box,-3.1,.42,5.8,2.1,.4,.18,sofa);for(const s of [-1,1])b(loc.box,-3.1+s*1.0,.42,5.45,.14,.2,.85,sofa);
  b(loc.box,-3.1,0,4.55,1.05,.34,.55,col.walnut);
  b(loc.box,-1.55,0,4.6,.7,.08,.7,col.black);b(loc.box,-1.55,.24,4.6,.62,.14,.6,col.cognac);b(loc.box,-1.25,.38,4.6,.08,.5,.62,col.cognac,0);
  loc.round.push({p:[-4.6,.02,5.5],s:[.32,.04,.32],c:col.black},{p:[-4.6,.85,5.5],s:[.04,1.7,.04],c:col.brass});loc.glow.push({p:[-4.6,1.75,5.5],s:[.34,.2,.34],c:"#ffe9b8"});
  b(loc.box,-1.0,0,3.45,.42,.62,1.4,col.walnut);
  if(!mirror){for(const k of Object.keys(loc) as (keyof Parts)[])o[k].push(...loc[k]);return;}
  for(const k of Object.keys(loc) as (keyof Parts)[])for(const part of loc[k])o[k].push({...part,p:[mirrorX(part.p[0]),part.p[1],part.p[2]],...(part.r?{r:-part.r}:{})});
}

/** The 2 bed along the curved north glass: island kitchen, round column, curved sofa, two bedrooms with baths. */
function twoBed(o:Parts){
  const X0=-8,X1=CIRCA_UNITS_EAST,Z1=C.z0;
  // Master suite (west): bedroom, bath in the corridor corner, wardrobe wall.
  wallZ(o.box,-4,-circaEdgeZ(-4)+.12,Z1,WALL.low,[[-3.3,-2.5]]);
  wallX(o.box,-2.6,-circaEdgeX(-2.6)+.12,-6.2,WALL.low);wallZ(o.box,-6.2,-2.6,Z1,WALL.low,[[-2.4,-1.7]]);
  bath(o,X0,-6.2,-2.6,Z1,true,-1);
  bed(o,-5.9,-3.85,Math.PI/2,1.7);
  b(o.box,-4.32,0,-4.6,.5,1.9,1.6,col.walnut);
  // Second bedroom and bath (east).
  wallZ(o.box,3.6,-circaEdgeZ(3.6)+.12,Z1,WALL.low,[[-4.9,-4.1]]);
  wallX(o.box,-2.6,5,X1,WALL.low);wallZ(o.box,5,-2.6,Z1,WALL.low,[[-2.4,-1.7]]);
  bath(o,5,X1,-2.6,Z1,false,-1);
  // Headboard on the east wall, so a clear aisle runs from the door up to the bathroom.
  bed(o,5.35,-4.4,Math.PI,1.5);
  // Kitchen on the corridor wall, long champagne island with a white top.
  b(o.box,-2.0,0,-1.38,3.2,.86,.6,col.white);b(o.box,-2.0,.86,-1.38,3.24,.05,.64,col.quartz);b(o.box,-1.6,.86,-1.38,.62,.03,.5,col.steel);
  b(o.box,-3.72,0,-1.4,.5,2.1,.62,col.white);
  b(o.box,-1.3,0,-2.55,2.6,.86,.8,col.champagne);b(o.box,-1.3,.86,-2.55,2.7,.05,.9,col.quartz);
  for(const dx of [-.8,0,.8]){o.round.push({p:[-1.3+dx,.35,-3.15],s:[.3,.7,.3],c:col.black});}
  // Dining: round table and chairs under a white sculptural pendant.
  o.round.push({p:[-2.4,.37,-4.5],s:[.2,.74,.2],c:col.black},{p:[-2.4,.76,-4.5],s:[1.1,.05,1.1],c:col.marble});
  for(let i=0;i<4;i++){const a=i*Math.PI/2+Math.PI/4;b(o.box,-2.4+Math.cos(a)*.75,.4,-4.5+Math.sin(a)*.75,.38,.06,.38,col.cognac,-a);}
  b(o.box,-2.4,2.2,-4.5,.01,1,.01,col.black);
  for(const [dx,dz,r] of [[0,0,0],[.15,.1,.8],[-.12,.08,1.6],[.05,-.14,2.4]] as const)o.glow.push({p:[-2.4+dx,2.05,-4.5+dz],s:[.5,.04,.18],c:"#fbf8f2",r,rx:.5});
  // Round white structural column standing in the living room near the glass.
  o.round.push({p:[.3,WALL.full/2,-4.6],s:[.6,WALL.full,.6],c:col.column});
  // Living: curved grey sofa facing the view, two oval marble tables, bronze barrel chair, rug.
  b(o.box,1.9,.03,-3.9,3.6,.012,2.4,"#c8c9c6");
  for(let i=0;i<5;i++){const a=-.6+i*.3,cx=1.9+Math.sin(a)*1.5,cz=-2.6-Math.cos(a)*.25+Math.abs(a)*.25;b(o.box,cx,0,cz,.72,.42,.8,col.greySofa,-a*.6);b(o.box,cx,.42,cz+.33,.72,.38,.16,col.greySofa,-a*.6);}
  o.round.push({p:[1.6,.2,-3.8],s:[1.1,.4,.7],c:col.white},{p:[1.6,.42,-3.8],s:[1.2,.04,.78],c:col.marble});
  o.round.push({p:[2.6,.18,-4.2],s:[.75,.36,.6],c:col.white},{p:[2.6,.38,-4.2],s:[.82,.04,.66],c:col.marble});
  o.round.push({p:[3.15,.25,-3.4],s:[.8,.5,.8],c:col.bronze},{p:[3.15,.5,-3.4],s:[.66,.12,.66],c:"#3b3530"});
  b(o.box,2.4,0,-5.2,.03,1.5,.03,col.black);o.glow.push({p:[2.4,1.55,-5.2],s:[.3,.18,.3],c:"#ffe9b8"});
  for(const [x,z] of [[-.6,-4.9],[3.1,-5.7]] as const){o.round.push({p:[x,.2,z],s:[.4,.4,.4],c:col.white});o.round.push({p:[x,.75,z],s:[.5,.7,.5],c:col.green});}
}

/** Oak floor, curved glass, corridor walls and front doors shared by every apartment floor. Walls run out to the rim. */
function corridor(o:Parts,level:number){
  const units=circaUnits(level),west=-circaEdgeX(C.z1)+.12,rim=(x:number)=>circaEdgeZ(x)-.12;
  // Floor-to-ceiling glass all the way round, so the 1 beds get the same windows as the 2 bed.
  ovalFloor(o,col.oak,col.plank,.5);glassRim(o,()=>true);
  wallX(o.box,C.z0,west,CIRCA_UNITS_EAST,WALL.low,units.filter(u=>u.z1<=C.z0).map(u=>u.door));
  wallX(o.box,C.z1,west,CIRCA_UNITS_EAST,WALL.low,units.filter(u=>u.z0>=C.z1).map(u=>u.door));
  wallZ(o.box,CIRCA_PARTY_WALL,C.z1,rim(CIRCA_PARTY_WALL),WALL.low);
  wallZ(o.box,CIRCA_UNITS_EAST,-rim(CIRCA_UNITS_EAST),C.z0,WALL.low);wallZ(o.box,CIRCA_UNITS_EAST,C.z1,rim(CIRCA_UNITS_EAST),WALL.low);
  for(const u of units){const z=u.z1<=C.z0?C.z0:C.z1,x=(u.door[0]+u.door[1])/2;b(o.box,x,0,z,u.door[1]-u.door[0]+.12,.02,.14,col.black);
    b(o.box,u.door[0]-.04,0,z,.06,2.2,.14,col.black);b(o.box,u.door[1]+.04,0,z,.06,2.2,.14,col.black);b(o.box,x,2.2,z,u.door[1]-u.door[0]+.14,.08,.14,col.black);}
}

export function circaApartmentParts(level:number):Parts{
  const o=emptyParts();if(!circaUnits(level).length)return o;
  corridor(o,level);twoBed(o);
  oneBed(o,false,SOFAS[level%SOFAS.length]);oneBed(o,true,SOFAS[(level+1)%SOFAS.length]);
  return o;
}

/** Palm: trunk and a crown of tilted fronds. */
function palm(o:Parts,x:number,z:number,y0:number,h=2.4){
  o.round.push({p:[x,y0+h/2,z],s:[.14,h,.14],c:col.palm});
  for(let i=0;i<7;i++){const a=i*Math.PI*2/7,len=.95;o.box.push({p:[x+Math.sin(a)*len*.42,y0+h-.12,z+Math.cos(a)*len*.42],s:[.22,.03,len],c:col.green,r:a,rx:.35});}
}

/** Floor 2: the outdoor amenity deck on the podium roof, open to the sky. Mirrors the deck seen on the map. */
export function circaPoolDeckParts():Parts{
  const o=emptyParts(),deck=.04;
  ovalFloor(o,col.paving,"#cbc3b2",1,true);
  // Round resort pool on a paved ring, loungers set around it, glow strips on the rim.
  const px=1,pz=3.5;
  o.round.push({p:[px,deck+.015,pz],s:[4.8,.03,4.8],c:"#e6e0d3"},{p:[px,deck+.05,pz],s:[3.6,.1,3.6],c:col.stone});
  o.waterRound.push({p:[px,deck+.06,pz],s:[3.3,.1,3.3],c:"#ffffff"});
  for(let i=0;i<12;i++){const a=i*Math.PI/6;o.glow.push({p:[px+Math.cos(a)*1.72,deck+.11,pz+Math.sin(a)*1.72],s:[.18,.02,.06],c:"#bfe9ff",r:-a+Math.PI/2});}
  for(let i=0;i<9;i++){const a=Math.PI*.95+i*(Math.PI*1.1)/8,x=px+Math.cos(a)*2.25,z=pz+Math.sin(a)*2.25;if(z<1.15||z>5.85)continue;
    const r=-a+Math.PI/2;b(o.box,x,deck,z,.36,.16,.85,col.white,r);b(o.box,x+Math.cos(a)*.3,deck+.16,z+Math.sin(a)*.3,.36,.22,.2,col.white,r);}
  // Lap pool along the north edge with lane lines, under a white colonnade canopy with lantern strips.
  b(o.box,-2.2,deck,-4.2,8,.08,1.7,col.stone);o.waterBox.push({p:[-2.2,deck+.07,-4.2],s:[7.6,.04,1.3],c:"#ffffff"});
  for(const z of [-4.5,-3.9])b(o.box,-2.2,deck+.09,z,7.2,.004,.04,"#24577a");
  for(let i=0;i<6;i++)o.round.push({p:[-5.9+i*1.48,deck+1.3,-5.4],s:[.16,2.6,.16],c:col.white});
  b(o.box,-2.2,deck+2.6,-5.25,8.3,.1,1.1,col.white);o.glow.push({p:[-2.2,deck+2.58,-4.85],s:[7.8,.03,.06],c:"#ffe2b0"});
  // Cabanas along the east curve: teak frame, white canopy, turquoise daybed.
  for(const z of [1.8,3.25,4.7]){
    for(const [dx,dz] of [[-.6,-.6],[.6,-.6],[-.6,.6],[.6,.6]] as const)b(o.box,5.9+dx,deck,z+dz*.85,.07,1.8,.07,col.teak);
    b(o.box,5.9,deck+1.8,z,1.4,.08,1.2,col.white);b(o.box,5.9,deck,z,1.1,.32,.9,col.turquoise);b(o.box,5.9,deck+.32,z,1.05,.08,.85,col.white);
    o.glow.push({p:[5.9,deck+1.74,z],s:[.3,.05,.3],c:"#ffe2b0"});
  }
  // Small round spa.
  o.round.push({p:[4.3,deck+.12,-3.3],s:[1.9,.24,1.9],c:col.stone});o.waterRound.push({p:[4.3,deck+.2,-3.3],s:[1.6,.1,1.6],c:"#ffffff"});
  // Fire pit with a ring of low lounge chairs.
  o.round.push({p:[-4.6,deck+.18,3.2],s:[1.2,.36,1.2],c:"#5d5853"},{p:[-4.6,deck+.37,3.2],s:[.9,.04,.9],c:col.ember});
  o.glow.push({p:[-4.6,deck+.42,3.2],s:[.5,.06,.5],c:"#ff9a4a",r:.4});
  for(let i=0;i<6;i++){const a=i*Math.PI/3,x=-4.6+Math.cos(a)*1.45,z=3.2+Math.sin(a)*1.45;if(z<1.2)continue;b(o.box,x,deck,z,.6,.3,.6,"#6a6f73",-a);b(o.box,x+Math.cos(a)*.26,deck+.3,z+Math.sin(a)*.26,.6,.3,.1,"#6a6f73",-a+Math.PI/2);}
  // Planters with palms and low hedges at the edges, keeping the lift walk along z 0 clear.
  for(const [x,z] of [[-6.2,4.3],[-7.2,-2.2],[2.6,-2.3],[-1.6,5.0]] as const){b(o.box,x,deck,z,.9,.45,.9,col.stone);palm(o,x,z,deck+.45);}
  b(o.box,-7.4,deck,-.0,.6,.5,1.6,col.stone);b(o.box,-7.4,deck+.5,0,.5,.3,1.5,col.green);
  // Glass guard rail around the curved edge of the deck.
  glassRim(o,()=>false,WALL.full,1.1);
  return o;
}

/**
 * The lobby's curved walls, following the oval rim (the furniture stays in CircaLobby):
 * - Back arc (z < -4.6): walnut in book-matched strips with two dark elevator doors, full height.
 * - West arc: faceted white marble panels with grey veins, full height.
 * - East arc: the sculpted wavy walnut slats, full height behind the lift and low toward the street, open where the lift sits.
 * - Street arc: floor-to-ceiling glass in slim black frames either side of the main door, with a glass transom above it.
 * Also the floors: light marble, and grey stone tiles across the elevator vestibule.
 */
export const CIRCA_LOBBY={height:3.4,back:-4.6,front:5,liftGap:1.6,door:1.32,lifts:[-1.4,1.4]};
export function circaLobbyParts():Parts{
  const o=emptyParts(),L=CIRCA_LOBBY,H=L.height,{rx,rz}=CIRCA_PLATE;
  const walnut=col.walnut,walnutLight="#76503a",marble=col.marble,vein="#b9b4ad",black=col.black;
  // Floors: marble oval; grey tile strips across the back of the oval, with grout lines.
  o.round.push({p:[0,.006,0],s:[rx*2,.012,rz*2],c:marble});
  for(let z=-rz+.1;z<-3.6;z+=.2){const w=circaEdgeX(z)*2-.1;if(w>.2)b(o.box,0,.012,z+.1,w,.006,.2,"#a6a49f");}
  for(let x=-6;x<=6;x+=2){const d=circaEdgeZ(x)-3.6-.05;if(d>0)b(o.box,x,.016,-3.6-d/2,.03,.004,d,"#8e8c87");}
  // Point on the rim, inset toward the middle, and the angle that lays a box along the rim there.
  const at=(t:number,inset:number)=>{const x=(rx-inset)*Math.cos(t),z=(rz-inset)*Math.sin(t);return {x,z,r:-Math.atan2(rz*Math.cos(t),-rx*Math.sin(t))};};
  const arc=(t0:number,t1:number,step:number)=>{const n=Math.max(1,Math.round(Math.abs(t1-t0)/step)),out:number[]=[];for(let i=0;i<n;i++)out.push(t0+(t1-t0)*(i+.5)/n);return out;};
  const seg=(t:number,dt:number,inset:number)=>{const a=at(t-dt/2,inset),c=at(t+dt/2,inset);return Math.hypot(c.x-a.x,c.z-a.z);};
  // The z = back line meets the rim at these angles (west and east).
  const tb=Math.asin(L.back/rz),tf=Math.asin(L.front/rz);
  // Back arc: walnut wall with alternating strips; gaps in the strips for the elevator doors.
  const backStep=.05;
  for(const t of arc(Math.PI-tb,2*Math.PI+tb,backStep)){
    const p=at(t,.08),len=seg(t,backStep,.08)+.01;b(o.box,p.x,0,p.z,len,H,.16,walnut,p.r);
  }
  {const span=Math.PI+2*tb,n=Math.round(span/.03);for(let i=0;i<n;i++){const t=Math.PI-tb+(i+.5)*span/n,p=at(t,.17);
    if(L.lifts.some(x=>Math.abs(p.x-x)<.9))continue;if(i%4<2)continue;b(o.box,p.x,.1,p.z,.24,H-.2,.02,(i>>2)%2?walnutLight:walnut,p.r);}}
  for(const x of L.lifts){
    const t=2*Math.PI-Math.acos(x/rx),p=at(t,.2);
    b(o.box,p.x,0,p.z,1.5,2.45,.05,black,p.r);
    const q=at(t,.23);b(o.box,q.x,0,q.z,1.25,2.3,.03,"#3d3b38",q.r);
    const m=at(t,.25);b(o.box,m.x,0,m.z,.02,2.3,.02,"#26241f",m.r);
    o.glow.push({p:[m.x,2.5,m.z],s:[.5,.05,.02],c:"#fff1d6",r:m.r});
  }
  // West arc: faceted marble panels folded at alternating angles.
  const westStep=.2;arc(Math.PI-tf,Math.PI-tb,westStep).forEach((t,i)=>{
    const p=at(t,.12),len=seg(t,westStep,.12)+.06,fold=i%2?.28:-.28;
    b(o.box,p.x,0,p.z,len,H,.12,marble,p.r+fold);
    const v=at(t,.19);b(o.box,v.x,.25,v.z,.03,H-.6,.01,vein,p.r+fold+.4);
  });
  // East arc: wavy walnut slats set on the normal, deeper and shallower along a slow wave; open for the lift.
  const eastStep=.026;arc(tb,tf,eastStep).forEach((t,i)=>{
    const z=rz*Math.sin(t);if(Math.abs(z)<L.liftGap)return;
    const d=.15+.45*(1+Math.sin(i*.45))/2,h=z<0?H:1.2,p=at(t,.04+d/2);
    b(o.box,p.x,0,p.z,.14,h,d,i%3?walnut:walnutLight,p.r);
  });
  // Night: a warm cove light along the top of the tall walls (back, west, and east behind the lift).
  for(const seg of circaRim(72,.27))if(seg.z<0||(seg.x<0&&seg.z<L.front))o.glow.push({p:[seg.x,H-.25,seg.z],s:[seg.len,.03,.06],c:"#ffe6bf",r:seg.r});
  // Street arc: floor-to-ceiling glass in slim black frames, open at the main door with a glass transom above it.
  const frontStep=.08;arc(tf,Math.PI-tf,frontStep).forEach((t,i)=>{
    const p=at(t,.06),len=seg(t,frontStep,.06),door=Math.abs(p.x)<L.door,y0=door?2.6:0;
    if(!door)b(o.box,p.x,0,p.z,len,.1,.1,black,p.r);
    o.glass.push({p:[p.x,(y0+H)/2,p.z],s:[len,H-y0,.04],c:"#dfe9ea",r:p.r});
    b(o.box,p.x,H-.04,p.z,len,.04,.08,black,p.r);
    if(door)b(o.box,p.x,2.56,p.z,len,.04,.08,black,p.r);
    else if(i%12===0)b(o.box,p.x,0,p.z,.04,H,.06,black,p.r);
  });
  return o;
}

/** Count of instances, used by tests and the perf note. */
export const partCount=(p:Parts)=>Object.values(p).reduce((n,l)=>n+l.length,0);
