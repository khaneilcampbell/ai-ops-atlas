import {CIRCA_CORRIDOR as C,CIRCA_NORTH_WEST,CIRCA_PARTY_WALL,CIRCA_PLATE as P,CIRCA_STAIR_EAST,CIRCA_UNITS_EAST,circaEdgeZ,circaEllipse,circaUnits,mirrorX} from "./circaFloors";

/**
 * Pure part lists for Circa's pool deck and apartment floors inside "Enter building".
 * Every list renders as one instanced mesh per material, so a floor costs a handful of draw calls
 * however much furniture it holds. A stylized, unofficial take: no signage, logos or real floor plans.
 * The pool deck uses the 16 × 12 podium plate (x -8..8, z -6..6). Apartment floors are the oval tower plate
 * (CIRCA_PLATE in circaFloors.ts) with curved glass all round. `p` is the centre of each piece.
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

function bed(o:Parts,x:number,z:number,r:number,w=1.6){
  // Bed runs along x when r = 0 with the headboard at the low-x end.
  const L=2.05,c=Math.cos(r),s=Math.sin(r),at=(dx:number,dz:number):[number,number]=>[x+dx*c+dz*s,z-dx*s+dz*c];
  const put=(dx:number,dz:number,y0:number,lw:number,h:number,ld:number,cc:string)=>{const [px,pz]=at(dx,dz);b(o.box,px,y0,pz,lw,h,ld,cc,r);};
  put(0,0,0,L,.3,w+.1,col.walnut);put(.05,0,.3,L-.15,.18,w,col.sheet);put(.35,0,.48,L*.55,.05,w+.02,col.duvet);
  put(-L/2+.04,0,0,.1,1.05,w+.2,col.walnut);
  for(const side of [-1,1]){put(-L/2+.35,side*w*.25,.48,.35,.12,w*.42,col.white);put(-L/2+.2,side*(w/2+.4),0,.42,.5,.42,col.walnut);
    const [lx,lz]=at(-L/2+.2,side*(w/2+.4));o.glow.push({p:[lx,.62,lz],s:[.16,.18,.16],c:"#fff1d6"});}
}
function bath(o:Parts,x0:number,x1:number,z0:number,z1:number,flip:number){
  b(o.box,(x0+x1)/2,.03,(z0+z1)/2,x1-x0-.1,.012,z1-z0-.1,col.hex);
  for(let x=x0+.25;x<x1-.1;x+=.25)b(o.box,x,.043,(z0+z1)/2,.01,.002,z1-z0-.12,"#8a8985");
  // Tub on the corridor side with a grey marble surround, white floating vanity with a lit mirror, toilet.
  const tz=flip>0?z0+.42:z1-.42;b(o.box,x0+.85,.04,tz,1.5,.5,.72,col.white);b(o.box,x0+.85,.4,tz,1.3,.12,.5,"#d9e7ea");b(o.box,x0+.85,.54,tz-flip*.38,1.6,1.4,.04,col.bathStone);
  const vx=x1-.55,vz=flip>0?z1-.33:z0+.33;b(o.box,vx,.35,vz,.9,.4,.48,col.white);b(o.box,vx,.75,vz,.95,.04,.5,col.quartz);
  o.glow.push({p:[vx,1.5,flip>0?z1-.07:z0+.07],s:[.7,.75,.02],c:"#eef3f2"});
  o.round.push({p:[x0+.45,.22,flip>0?z1-.4:z0+.4],s:[.36,.42,.5],c:col.white});
}

/** The oval plate: slab, oak floor clipped to the curve, and floor-to-ceiling glass with black mullions all round. */
function plate(o:Parts){
  o.round.push({p:[P.cx,-.15,0],s:[P.rx*2,.3,P.rz*2],c:"#e7dfcf"},{p:[P.cx,.025,0],s:[P.rx*2-.12,.03,P.rz*2-.12],c:col.oak});
  for(let z=-P.rz+.5;z<P.rz-.1;z+=.5){const half=P.rx*Math.sqrt(1-(z/P.rz)**2)-.4;if(half>.2)b(o.box,P.cx,.04,z,half*2,.002,.015,col.plank);}
  // Stone lift lobby at the east tip, under the shaft.
  b(o.box,8.5,.04,0,2.7,.012,2.5,"#9a9893");
  // Glass runs full height on the far (north) arc and drops to a low rail on the near (south) arc so the cutaway stays readable.
  const ring=circaEllipse(48);
  ring.forEach(([xa,za],i)=>{
    const [xb,zb]=ring[(i+1)%ring.length],len=Math.hypot(xb-xa,zb-za),r=-Math.atan2(zb-za,xb-xa),mx=(xa+xb)/2,mz=(za+zb)/2,h=mz<0?WALL.full:.95;
    o.glass.push({p:[mx,.12+(h-.12)/2,mz],s:[len,h-.12,.04],c:"#cfe3ea",r});
    b(o.box,mx,0,mz,len,.12,.12,col.black,r);
    if(h===WALL.full)b(o.box,mx,WALL.full-.08,mz,len,.08,.12,col.black,r);
    b(o.box,xa,0,za,.07,h,.07,col.black);
  });
}

/** The west 1 bed, a slice of the south arc; the east unit mirrors it about the party wall on the ellipse's centre line. */
function oneBed(o:Parts,mirror:boolean,sofa:string){
  const loc=emptyParts(),X0=CIRCA_STAIR_EAST,Z0=C.z1;
  // Bath in the corridor corner, bedroom behind it on the curved glass, open kitchen and living to the east.
  bath(loc,X0,-2.2,Z0,2.7,1);
  wallX(loc.box,2.7,X0,-2.2,WALL.low);wallZ(loc.box,-2.2,Z0,2.7,WALL.low,[[1.85,2.55]]);
  wallZ(loc.box,-1.45,2.7,circaEdgeZ(-1.45)-.06,WALL.low);
  bed(loc,-3.0,3.9,-Math.PI/2,1.4);
  b(loc.box,-1.75,0,4.3,.45,1.9,1.0,col.walnut);
  // Kitchen along the party wall: grey flat panels, quartz top, stainless range, tall fridge column by the door.
  b(loc.box,.75,0,2.65,.6,.86,2.0,col.cabinet);b(loc.box,.75,.86,2.65,.64,.05,2.04,col.quartz);
  b(loc.box,.75,.86,2.3,.5,.03,.62,col.steel);b(loc.box,.75,.88,3.1,.36,.02,.5,"#6f7173");
  b(loc.box,.77,0,1.35,.56,2.1,.56,col.cabinet);b(loc.box,.47,.95,1.35,.02,.6,.02,col.steel);
  // Live-edge dining table on black trestles, four black shell chairs.
  b(loc.box,-.45,.72,3.3,.8,.07,1.2,col.liveEdge);for(const dz of [-.4,.4])b(loc.box,-.45,0,3.3+dz,.6,.72,.08,col.black);
  for(const [dx,dz] of [[-.55,-.3],[-.55,.3],[.55,-.3],[.55,.3]] as const){b(loc.box,-.45+dx,.42,3.3+dz,.42,.06,.42,col.black);b(loc.box,-.45+dx+Math.sign(dx)*.19,.48,3.3+dz,.05,.38,.42,col.black);
    for(const sz of [-.15,.15])b(loc.box,-.45+dx,0,3.3+dz+sz,.03,.42,.03,col.walnut);}
  // Living room at the glass: velvet sofa, walnut coffee table, brass floor lamp.
  b(loc.box,-.2,.03,4.75,2.4,.012,1.5,col.rug);
  b(loc.box,-.2,0,5.15,2.1,.42,.85,sofa);b(loc.box,-.2,.42,5.5,2.1,.4,.18,sofa);for(const s of [-1,1])b(loc.box,-.2+s*1.0,.42,5.15,.14,.2,.85,sofa);
  b(loc.box,-.2,0,4.3,1.05,.34,.55,col.walnut);
  loc.round.push({p:[.85,.02,4.3],s:[.32,.04,.32],c:col.black},{p:[.85,.85,4.3],s:[.04,1.7,.04],c:col.brass});loc.glow.push({p:[.85,1.75,4.3],s:[.34,.2,.34],c:"#ffe9b8"});
  if(!mirror){for(const k of Object.keys(loc) as (keyof Parts)[])o[k].push(...loc[k]);return;}
  for(const k of Object.keys(loc) as (keyof Parts)[])for(const part of loc[k])o[k].push({...part,p:[mirrorX(part.p[0]),part.p[1],part.p[2]],...(part.r?{r:-part.r}:{})});
}

/** The 2 bed across the north arc: master suite in the west tip, island kitchen and curved sofa in the middle, second bedroom east. */
function twoBed(o:Parts){
  const Z1=C.z0;
  // Master suite: bath on the corridor, bed facing the curved glass, wardrobe.
  bath(o,-6.9,CIRCA_STAIR_EAST,-2.7,Z1,-1);
  wallX(o.box,-2.7,-6.9,CIRCA_STAIR_EAST,WALL.low);wallZ(o.box,CIRCA_STAIR_EAST,-2.7,Z1,WALL.low,[[-2.3,-1.5]]);
  wallZ(o.box,-1.9,-circaEdgeZ(-1.9)+.06,Z1,WALL.low,[[-2.5,-1.7]]);
  bed(o,-3.3,-3.8,Math.PI/2,1.4);
  b(o.box,-5.0,0,-3.4,.5,1.9,1.2,col.walnut);
  // Second bedroom and bath (east).
  wallZ(o.box,3.6,-circaEdgeZ(3.6)+.06,Z1,WALL.low,[[-4.9,-4.1]]);
  wallX(o.box,-2.6,5,CIRCA_UNITS_EAST,WALL.low);wallZ(o.box,5,-2.6,Z1,WALL.low,[[-2.4,-1.7]]);
  bath(o,5,CIRCA_UNITS_EAST,-2.6,Z1,-1);
  bed(o,4.9,-3.75,Math.PI/2,1.5);
  // Kitchen on the corridor wall, long champagne island with a white top.
  b(o.box,-.6,0,-1.38,2.4,.86,.6,col.white);b(o.box,-.6,.86,-1.38,2.44,.05,.64,col.quartz);b(o.box,-.2,.86,-1.38,.62,.03,.5,col.steel);
  b(o.box,.95,0,-1.4,.5,2.1,.62,col.white);
  b(o.box,-.6,0,-2.55,2.2,.86,.8,col.champagne);b(o.box,-.6,.86,-2.55,2.3,.05,.9,col.quartz);
  for(const dx of [-.7,0,.7]){o.round.push({p:[-.6+dx,.35,-3.15],s:[.3,.7,.3],c:col.black});}
  // Dining: round table and chairs under a white sculptural pendant.
  o.round.push({p:[-.9,.37,-4.4],s:[.2,.74,.2],c:col.black},{p:[-.9,.76,-4.4],s:[1.1,.05,1.1],c:col.marble});
  for(let i=0;i<4;i++){const a=i*Math.PI/2+Math.PI/4;b(o.box,-.9+Math.cos(a)*.75,.4,-4.4+Math.sin(a)*.75,.38,.06,.38,col.cognac,-a);}
  b(o.box,-.9,2.2,-4.4,.01,1,.01,col.black);
  for(const [dx,dz,r] of [[0,0,0],[.15,.1,.8],[-.12,.08,1.6],[.05,-.14,2.4]] as const)o.glow.push({p:[-.9+dx,2.05,-4.4+dz],s:[.5,.04,.18],c:"#fbf8f2",r,rx:.5});
  // Round white structural column standing in the living room near the glass.
  o.round.push({p:[.5,WALL.full/2,-4.9],s:[.6,WALL.full,.6],c:col.column});
  // Living: curved grey sofa facing the view, two oval marble tables, bronze barrel chair, rug.
  b(o.box,1.9,.03,-3.9,3.2,.012,2.4,"#c8c9c6");
  for(let i=0;i<5;i++){const a=-.6+i*.3,cx=1.9+Math.sin(a)*1.5,cz=-2.6-Math.cos(a)*.25+Math.abs(a)*.25;b(o.box,cx,0,cz,.72,.42,.8,col.greySofa,-a*.6);b(o.box,cx,.42,cz+.33,.72,.38,.16,col.greySofa,-a*.6);}
  o.round.push({p:[1.6,.2,-3.8],s:[1.1,.4,.7],c:col.white},{p:[1.6,.42,-3.8],s:[1.2,.04,.78],c:col.marble});
  o.round.push({p:[2.6,.18,-4.2],s:[.75,.36,.6],c:col.white},{p:[2.6,.38,-4.2],s:[.82,.04,.66],c:col.marble});
  o.round.push({p:[3.1,.25,-3.3],s:[.8,.5,.8],c:col.bronze},{p:[3.1,.5,-3.3],s:[.66,.12,.66],c:"#3b3530"});
  b(o.box,2.4,0,-5.2,.03,1.5,.03,col.black);o.glow.push({p:[2.4,1.55,-5.2],s:[.3,.18,.3],c:"#ffe9b8"});
  o.round.push({p:[3.2,.2,-5.2],s:[.4,.4,.4],c:col.white});o.round.push({p:[3.2,.75,-5.2],s:[.5,.7,.5],c:col.green});
}

/** The fire stair in the west tip, at the corridor's end: two short flights, cut low for the cutaway. */
function stair(o:Parts){
  wallZ(o.box,CIRCA_STAIR_EAST,C.z0,circaEdgeZ(CIRCA_STAIR_EAST)-.06,WALL.low,[[-.45,.45]]);
  b(o.box,-5.9,.03,.2,2.6,.012,1.8,col.stone);
  for(let i=0;i<7;i++){b(o.box,-5.0-i*.27,0,-.35,.27,.15*(i+1),.8,col.stone);b(o.box,-5.0-i*.27,0,.75,.27,.15*(7-i),.8,col.stone);}
  b(o.box,-7.05,0,.2,.35,1.05,1.9,col.stone);
  b(o.box,-5.8,1.05,.2,2.2,.04,.04,col.black);
}

/** Corridor walls and front doors shared by every apartment floor. */
function corridor(o:Parts,level:number){
  const units=circaUnits(level);
  wallX(o.box,C.z0,CIRCA_NORTH_WEST,CIRCA_UNITS_EAST,WALL.low,units.filter(u=>u.z1<=C.z0).map(u=>u.door));
  wallX(o.box,C.z1,CIRCA_STAIR_EAST,CIRCA_UNITS_EAST,WALL.low,units.filter(u=>u.z0>=C.z1).map(u=>u.door));
  wallZ(o.box,CIRCA_PARTY_WALL,C.z1,circaEdgeZ(CIRCA_PARTY_WALL)-.06,WALL.low);
  wallZ(o.box,CIRCA_UNITS_EAST,-circaEdgeZ(CIRCA_UNITS_EAST)+.06,C.z0,WALL.low);wallZ(o.box,CIRCA_UNITS_EAST,C.z1,circaEdgeZ(CIRCA_UNITS_EAST)-.06,WALL.low);
  for(const u of units){const z=u.z1<=C.z0?C.z0:C.z1,x=(u.door[0]+u.door[1])/2;b(o.box,x,0,z,u.door[1]-u.door[0]+.12,.02,.14,col.black);
    b(o.box,u.door[0]-.04,0,z,.06,2.2,.14,col.black);b(o.box,u.door[1]+.04,0,z,.06,2.2,.14,col.black);b(o.box,x,2.2,z,u.door[1]-u.door[0]+.14,.08,.14,col.black);}
}

export function circaApartmentParts(level:number):Parts{
  const o=emptyParts();if(!circaUnits(level).length)return o;
  plate(o);corridor(o,level);stair(o);twoBed(o);
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
  b(o.box,0,.01,0,16,.03,12,col.paving);
  for(let x=-7;x<8;x+=1)b(o.box,x,.04,0,.012,.002,11.9,"#cbc3b2");
  // Round resort pool on a paved ring, loungers set around it, glow strips on the rim.
  const px=1,pz=3.5;
  o.round.push({p:[px,deck+.015,pz],s:[4.8,.03,4.8],c:"#e6e0d3"},{p:[px,deck+.05,pz],s:[3.6,.1,3.6],c:col.stone});
  o.waterRound.push({p:[px,deck+.06,pz],s:[3.3,.1,3.3],c:"#ffffff"});
  for(let i=0;i<12;i++){const a=i*Math.PI/6;o.glow.push({p:[px+Math.cos(a)*1.72,deck+.11,pz+Math.sin(a)*1.72],s:[.18,.02,.06],c:"#bfe9ff",r:-a+Math.PI/2});}
  for(let i=0;i<9;i++){const a=Math.PI*.95+i*(Math.PI*1.1)/8,x=px+Math.cos(a)*2.25,z=pz+Math.sin(a)*2.25;if(z<1.15||z>5.85)continue;
    const r=-a+Math.PI/2;b(o.box,x,deck,z,.36,.16,.85,col.white,r);b(o.box,x+Math.cos(a)*.3,deck+.16,z+Math.sin(a)*.3,.36,.22,.2,col.white,r);}
  // Lap pool along the north edge with lane lines, under a white colonnade canopy with lantern strips.
  b(o.box,-2.6,deck,-4.2,8.8,.08,1.7,col.stone);o.waterBox.push({p:[-2.6,deck+.07,-4.2],s:[8.4,.04,1.3],c:"#ffffff"});
  for(const z of [-4.5,-3.9])b(o.box,-2.6,deck+.09,z,8,.004,.04,"#24577a");
  for(let i=0;i<6;i++)o.round.push({p:[-6.8+i*1.68,deck+1.3,-5.45],s:[.16,2.6,.16],c:col.white});
  b(o.box,-2.6,deck+2.6,-5.35,9.1,.1,1.1,col.white);o.glow.push({p:[-2.6,deck+2.58,-4.95],s:[8.6,.03,.06],c:"#ffe2b0"});
  // Cabanas along the east edge: teak frame, white canopy, turquoise daybed.
  for(const z of [2.0,3.6,5.1]){
    for(const [dx,dz] of [[-.6,-.6],[.6,-.6],[-.6,.6],[.6,.6]] as const)b(o.box,6.4+dx,deck,z+dz*.85,.07,1.8,.07,col.teak);
    b(o.box,6.4,deck+1.8,z,1.4,.08,1.2,col.white);b(o.box,6.4,deck,z,1.1,.32,.9,col.turquoise);b(o.box,6.4,deck+.32,z,1.05,.08,.85,col.white);
    o.glow.push({p:[6.4,deck+1.74,z],s:[.3,.05,.3],c:"#ffe2b0"});
  }
  // Small round spa.
  o.round.push({p:[4.3,deck+.12,-3.3],s:[1.9,.24,1.9],c:col.stone});o.waterRound.push({p:[4.3,deck+.2,-3.3],s:[1.6,.1,1.6],c:"#ffffff"});
  // Fire pit with a ring of low lounge chairs.
  o.round.push({p:[-4.6,deck+.18,3.2],s:[1.2,.36,1.2],c:"#5d5853"},{p:[-4.6,deck+.37,3.2],s:[.9,.04,.9],c:col.ember});
  o.glow.push({p:[-4.6,deck+.42,3.2],s:[.5,.06,.5],c:"#ff9a4a",r:.4});
  for(let i=0;i<6;i++){const a=i*Math.PI/3,x=-4.6+Math.cos(a)*1.45,z=3.2+Math.sin(a)*1.45;if(z<1.2)continue;b(o.box,x,deck,z,.6,.3,.6,"#6a6f73",-a);b(o.box,x+Math.cos(a)*.26,deck+.3,z+Math.sin(a)*.26,.6,.3,.1,"#6a6f73",-a+Math.PI/2);}
  // Planters with palms and low hedges at the edges, keeping the lift walk along z 0 clear.
  for(const [x,z] of [[-7.2,4.9],[-7.2,-2.2],[2.6,-2.3],[-1.6,5.0]] as const){b(o.box,x,deck,z,.9,.45,.9,col.stone);palm(o,x,z,deck+.45);}
  b(o.box,-7.4,deck,-.0,.6,.5,1.6,col.stone);b(o.box,-7.4,deck+.5,0,.5,.3,1.5,col.green);
  // The oval tower rises from the back of the deck: a bronze inlay traces its footprint, and slim white columns stand on
  // the line wherever the deck is clear, so the shape carries down from the apartment floors above.
  const ring=circaEllipse(64),onPlate=([x,z]:[number,number])=>Math.abs(x)<7.95&&Math.abs(z)<5.95;
  ring.forEach((a,i)=>{const n=ring[(i+1)%ring.length];if(!onPlate(a)||!onPlate(n))return;const len=Math.hypot(n[0]-a[0],n[1]-a[1]);b(o.box,(a[0]+n[0])/2,deck,(a[1]+n[1])/2,len,.006,.08,col.bronze,-Math.atan2(n[1]-a[1],n[0]-a[0]));});
  const solid=[...o.box,...o.round].filter(p=>p.p[1]+p.s[1]/2>deck+.03);
  const clear=(x:number,z:number)=>Math.abs(z)>1.2&&solid.every(p=>{const r=Math.max(p.s[0],p.s[2])/2+.25;return Math.abs(p.p[0]-x)>r||Math.abs(p.p[2]-z)>r;});
  circaEllipse(36).filter(([x,z])=>onPlate([x,z])&&z<0&&clear(x,z)).forEach(([x,z])=>o.round.push({p:[x,deck+1.83,z],s:[.24,3.66,.24],c:col.column}));
  // Glass guard rail along the open street edge.
  b(o.box,0,deck,5.98,16,.1,.06,col.black);b(o.glass,0,deck+.1,5.98,16,1,.04,"#dfeef0");
  return o;
}

/** Count of instances, used by tests and the perf note. */
export const partCount=(p:Parts)=>Object.values(p).reduce((n,l)=>n+l.length,0);
