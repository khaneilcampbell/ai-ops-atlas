import type {Inst} from './models';
import type {Pt} from './roads';

/**
 * Circa: a stylized twin-tower landmark, inspired by the 2018 Downtown Los Angeles complex
 * (twin elliptical towers on an eight-storey podium). Not a replica: no real signage or ads.
 * Coordinates: site values are Financial District local; parts are building-local, base y=0.
 */
export const CIRCA={
 /** Waterfront parcel width west of the district's west wall (district-local x -w..0). */
 siteWidth:9.2,
 /** Building centre, district-local. */
 x:-4.6,z:6.2,
 rise:1.04,
 /** Circa's roof rises this far above the tallest other Financial District tower (the Wells Fargo-scaled one). */
 lead:1.2,
 podium:{w:7.4,d:8.6,h:1.65,retail:.4},
 tower:{rx:1.25,rz:.95,turn:.42,centres:[[-1.75,1.95],[1.75,-1.95]] as Pt[],floors:46,balconySide:.1},
 crown:.6,
 /** Glass entrance pavilion centred on the street face; everything stays below the LED band (screen.y0). */
 entrance:{w:2.8,depth:.62,canopy:.3,recess:1.3},
 /** Minimum distance from the highway centreline to any corner of the parcel. */
 highwayClearance:1.2,
 /** Instance budget for the whole complex (towers, podium, deck, palms, street). */
 maxPieces:1200,
 /** LED band wrapping all four podium faces: a rounded loop with a gentle wave, the texture repeating a whole number of times. */
 /** y0 sits above the entrance, which matches the Financial District's shared door canopy height (.85). */
 screen:{y0:.94,y1:1.6,inset:.12,corner:.35,waves:7,amplitude:.2,repeats:6},
} as const;

export interface CircaParts{
 /** Box parts, white/stone/trim (m.plain). */
 solid:Inst[];
 /** Retail storefront glass (box). */
 storefront:Inst[];
 /** Elliptical tower bodies (unit cylinder, radius .5, base y=0). */
 towerGlass:Inst[];
 /** Elliptical slab edges and parapets (unit cylinder). */
 slabs:Inst[];
 /** Half-ellipse balcony slabs on the view side (unit half cylinder, +z half). */
 balconies:Inst[];
 /** Pools: round (cylinder) and lap (box). */
 roundWater:Inst[];
 lapWater:Inst[];
 /** Round pool rim and planters (cylinder). */
 rounds:Inst[];
 /** Leaves: trees on the deck and palm fronds (ball / box). */
 leaves:Inst[];
 fronds:Inst[];
 /** Main entrance: clear glass panes and canopy (box, transparent). */
 entryGlass:Inst[];
 /** Revolving-door drums (unit cylinder, transparent glass). */
 entryDrums:Inst[];
 /** Lobby light panels that glow at night (box). */
 lobbyGlow:Inst[];
 /** Lobby finishes (marble, stone, linen) that pick up a warm interior glow at night (box). */
 lobbyFinish:Inst[];
}

const rotate=([x,z]:Pt,a:number):Pt=>[x*Math.cos(a)+z*Math.sin(a),z*Math.cos(a)-x*Math.sin(a)];

/** All parts in building-local coordinates. `height` is the tower roof above the terrace. */
export function circaParts(height:number,palette:{white:string;stone:string;trim:string;core:string;green:string;turquoise:string;wood:string}):CircaParts{
 const out:CircaParts={solid:[],storefront:[],towerGlass:[],slabs:[],balconies:[],roundWater:[],lapWater:[],rounds:[],leaves:[],fronds:[],entryGlass:[],entryDrums:[],lobbyGlow:[],lobbyFinish:[]};
 const P=CIRCA.podium,T=CIRCA.tower,E=CIRCA.entrance,hw=P.w/2,hd=P.d/2;
 const box=(t:Inst[],x:number,y:number,z:number,w:number,h:number,d:number,c:string,r=0)=>t.push({p:[x,y,z],s:[w,h,d],c,...(r?{r}:{})});

 // Podium: dark garage core behind the LED band.
 // Garage core, with a double-height lobby carved out behind the glass entrance on the street face.
 {const cw=P.w-.12,cd=P.d-.12,ex=E.w/2,lobbyTop=CIRCA.screen.y0-.04,back=cd/2-E.recess,sideW=(cw/2-ex);
  for(const side of [-1,1])box(out.solid,side*(ex+sideW/2),0,0,sideW,P.h,cd,palette.core);
  box(out.solid,0,0,(-cd/2+back)/2,E.w,P.h,back+cd/2,palette.core);
  box(out.solid,0,lobbyTop,back+E.recess/2,E.w,P.h-lobbyTop,E.recess,palette.core);}
 // Double-height retail glass on the street and east faces fills the space under the LED band.
 const shopH=CIRCA.screen.y0-.12;
 for(const side of [-1,1]){const x0=E.w/2+.02,x1=hw-.15;box(out.storefront,side*(x0+x1)/2,.04,hd-.04,x1-x0,shopH,.04,'#ffffff');}
 box(out.storefront,hw-.04,.04,0,.04,shopH,P.d-.3,'#ffffff');
 for(let x=-hw+.4;x<hw-.2;x+=.62)if(Math.abs(x)>E.w/2+.05)box(out.solid,x,.04,hd-.01,.03,shopH,.03,palette.white);
 for(let z=-hd+.4;z<hd-.2;z+=.62)box(out.solid,hw-.01,.04,z,.03,shopH,.03,palette.white);
 // Parking louvers on the north and west faces below the band.
 for(let x=-hw+.12;x<=hw-.1;x+=.2)box(out.solid,x,.06,-hd-.03,.035,CIRCA.screen.y0-.12,.1,palette.white);
 for(let z=-hd+.12;z<=hd-.1;z+=.2)box(out.solid,-hw-.03,.06,z,.1,CIRCA.screen.y0-.12,.035,palette.white);
 // Retail canopy along the street (either side of the main entrance) and the east side.
 const canopyW=(P.w+.1)/2-E.w/2-.05;
 for(const side of [-1,1])box(out.solid,side*(E.w/2+.05+canopyW/2),P.retail-.04,hd+.12,canopyW,.05,.3,palette.white);
 box(out.solid,hw+.12,P.retail-.04,0,.3,.05,P.d+.1,palette.white);
 // Main entrance: a glass pavilion stepping out under the LED band, with a lit lobby inside.
 circaEntrance(out,palette);
 // The parking levels sit behind the LED band that wraps the whole podium, so it needs no louvers or floor bands above the street level.
 // Parapet and amenity deck surface.
 for(const side of [-1,1]){box(out.solid,0,P.h-.1,side*(hd-.02),P.w,.22,.08,palette.white);box(out.solid,side*(hw-.02),P.h-.1,0,.08,.22,P.d,palette.white);}
 box(out.solid,0,P.h-.12,0,P.w-.16,.14,P.d-.16,palette.stone);

 // Elevated amenity deck: round resort pool, lap pool, cabanas, loungers, planting.
 const deck=P.h+.02;
 // Round resort pool on a paved ring, loungers set radially around it (deck plan reference).
 out.rounds.push({p:[1.85,deck,2.05],s:[2.9,.03,2.9],c:'#cfc8b8'});
 out.rounds.push({p:[1.85,deck,2.05],s:[2,.05,2],c:palette.stone});
 for(let i=0;i<9;i++){const a=Math.PI/3+i*(Math.PI*4/3)/8,x=1.85+Math.cos(a)*1.2,z=2.05+Math.sin(a)*1.2;box(out.solid,x,deck+.03,z,.13,.045,.3,palette.white,Math.atan2(Math.cos(a),Math.sin(a)));}
 // Small round fountain between the towers, and two oval cabana pods in the gardens.
 out.rounds.push({p:[.45,deck,.3],s:[.6,.08,.6],c:palette.stone});out.roundWater.push({p:[.45,deck+.02,.3],s:[.48,.07,.48],c:'#ffffff'});
 for(const [x,z]of [[-2.6,.3],[-.4,-.55]] as const){out.rounds.push({p:[x,deck,z],s:[.62,.06,.44],c:'#7a4f35'});for(const side of [-1,1])box(out.solid,x+side*.12,deck+.06,z,.12,.05,.26,palette.white);}
 out.roundWater.push({p:[1.85,deck+.01,2.05],s:[1.7,.05,1.7],c:'#ffffff'});
 box(out.solid,-1.75,deck,-2.05,2.9,.05,1.15,palette.stone);
 out.lapWater.push({p:[-1.75,deck+.01,-2.05],s:[2.65,.05,.6],c:'#ffffff'},{p:[-2.98,deck+.01,-2.05],s:[.24,.05,.98],c:'#ffffff'});
 // Dark lane lines, then a colonnade with a flat canopy along the far side of the lap pool.
 for(const z of [-2.2,-1.9])box(out.solid,-1.75,deck+.062,z,2.3,.004,.035,'#24577a');
 for(let i=0;i<5;i++)out.rounds.push({p:[-3+i*.6,deck,-3.05],s:[.13,.5,.13],c:palette.trim});
 box(out.solid,-1.8,deck+.5,-3.15,2.75,.05,.55,palette.white);
 for(let i=0;i<4;i++){const z=.45+i*.85;box(out.solid,3.2,deck,z,.48,.36,.5,palette.turquoise);box(out.solid,3.2,deck+.36,z,.6,.05,.62,palette.white);}
 for(let i=0;i<7;i++){box(out.solid,-2.95+i*.38,deck,-1.42,.15,.05,.34,'#6f7477');box(out.solid,-2.95+i*.38,deck+.05,-1.3,.15,.07,.08,'#6f7477');}
 for(const [x,z,w,d]of [[-3.35,0,.28,3.4],[0,-3.95,3.6,.28],[3.35,-2.4,.28,2.6],[-1.2,3.95,2.3,.28]] as const){box(out.solid,x,deck,z,w,.12,d,palette.wood);box(out.solid,x,deck+.12,z,w-.04,.1,d-.04,palette.green);}
 for(const [x,z]of [[-3.35,-1],[-3.35,1.2],[3.35,-3.3],[3.35,-1.5],[-.6,3.95]] as const){box(out.solid,x,deck+.12,z,.04,.36,.04,palette.wood);out.leaves.push({p:[x,deck+.6,z],s:[.24,.2,.24],c:palette.green});}

 // Twin elliptical towers: blue glass, white slab edges, ribbed balconies on one side.
 const base=P.h,floor=(height-base)/T.floors;
 for(const [cx,cz]of T.centres){
  const place=(p:Pt):Pt=>{const [x,z]=rotate(p,T.turn);return [cx+x,cz+z];};
  out.towerGlass.push({p:[cx,base,cz],s:[T.rx*2,height-base,T.rz*2],r:T.turn,c:'#ffffff'});
  // A thin slab edge wraps every floor; on the view side each floor carries a deeper balcony strip.
  for(let f=1;f<T.floors;f++){out.slabs.push({p:[cx,base+f*floor-.012,cz],s:[T.rx*2+.05,.024,T.rz*2+.05],r:T.turn,c:palette.trim});out.balconies.push({p:[cx,base+f*floor-.014,cz],s:[(T.rx+T.balconySide)*2,.028,(T.rz+T.balconySide)*2],r:T.turn,c:palette.white});}
  // Slim glass-rail posts at the ends of the balcony strips.
  for(const th of [-1.45,1.45]){
   const [x,z]=place([(T.rx+T.balconySide-.03)*Math.sin(th),(T.rz+T.balconySide-.03)*Math.cos(th)]),normal=Math.atan2(Math.sin(th)/T.rx,Math.cos(th)/T.rz);
   box(out.solid,x,base+.05,z,.03,height-base-.15,.05,palette.white,T.turn+normal);
  }
  // Podium-to-tower plinth, roof parapet and a slim elliptical crown.
  out.slabs.push({p:[cx,base-.02,cz],s:[T.rx*2+.14,.1,T.rz*2+.14],r:T.turn,c:palette.white});
  out.slabs.push({p:[cx,height,cz],s:[T.rx*2+.06,.16,T.rz*2+.06],r:T.turn,c:palette.white});
  out.slabs.push({p:[cx,height+.16,cz],s:[T.rx*1.3,.3,T.rz*1.3],r:T.turn,c:palette.trim});
  out.slabs.push({p:[cx,height+.46,cz],s:[T.rx*1.36,.06,T.rz*1.36],r:T.turn,c:palette.white});
 }

 // Palms along the street front and the east walk (trunk + drooping fronds).
 const palm=(x:number,z:number,h:number,seed:number)=>{
  box(out.solid,x,0,z,.06,h,.06,'#8b7a5c');
  for(let k=0;k<7;k++){const yaw=seed+k*Math.PI*2/7,reach=.22;out.fronds.push({p:[x+Math.sin(yaw)*reach*Math.cos(.5),h-.02-reach*Math.sin(.5),z+Math.cos(yaw)*reach*Math.cos(.5)],s:[.08,.018,.5],r:yaw,rx:.5,c:palette.green});}
 };
 let seed=0;
 for(let x=-hw+.5;x<=hw-.3;x+=1.15)if(Math.abs(x)>E.w/2+.4)palm(x,hd+.75,1.05+(seed++%3)*.12,seed);
 for(let z=-hd+.6;z<=hd-.4;z+=1.4)palm(hw+.45,z,1.0+(seed++%3)*.12,seed);
 return out;
}

/**
 * Wave-shaped LED band wrapping the whole podium, building-local (x,z) samples.
 * The loop runs south face west to east, then east, north and west faces, so text reads left to right from outside.
 * The last sample repeats the first, closing the band.
 */
export function circaScreenPath(samples=240):Pt[]{
 const P=CIRCA.podium,S=CIRCA.screen,a=P.w/2+S.inset,b=P.d/2+S.inset,r=S.corner;
 // Base rounded rectangle as (point, outward normal) samples along its length.
 const base:{p:Pt;n:Pt}[]=[];
 const line=(x0:number,z0:number,x1:number,z1:number,n:Pt)=>{for(let i=0;i<12;i++){const t=i/12;base.push({p:[x0+(x1-x0)*t,z0+(z1-z0)*t],n});}};
 const arc=(cx:number,cz:number,from:number)=>{for(let i=0;i<6;i++){const th=from-i/6*Math.PI/2;base.push({p:[cx+r*Math.cos(th),cz+r*Math.sin(th)],n:[Math.cos(th),Math.sin(th)]});}};
 line(-(a-r),b,a-r,b,[0,1]);arc(a-r,b-r,Math.PI/2);
 line(a,b-r,a,-(b-r),[1,0]);arc(a-r,-(b-r),0);
 line(a-r,-b,-(a-r),-b,[0,-1]);arc(-(a-r),-(b-r),-Math.PI/2);
 line(-a,-(b-r),-a,b-r,[-1,0]);arc(-(a-r),b-r,Math.PI);
 base.push(base[0]);
 const len=[0];for(let i=1;i<base.length;i++)len.push(len[i-1]+Math.hypot(base[i].p[0]-base[i-1].p[0],base[i].p[1]-base[i-1].p[1]));
 const total=len[len.length-1],points:Pt[]=[];
 for(let k=0;k<=samples;k++){
  const d=k/samples*total;let i=1;while(i<base.length-1&&len[i]<d)i++;
  const t=(d-len[i-1])/((len[i]-len[i-1])||1),A=base[i-1],B=base[i],nx=A.n[0]+(B.n[0]-A.n[0])*t,nz=A.n[1]+(B.n[1]-A.n[1])*t,nl=Math.hypot(nx,nz)||1;
  const off=S.amplitude*(1-Math.cos(k/samples*Math.PI*2*S.waves))/2;
  points.push([A.p[0]+(B.p[0]-A.p[0])*t+nx/nl*off,A.p[1]+(B.p[1]-A.p[1])*t+nz/nl*off]);
 }
 return points;
}

/**
 * Entrance pavilion and lobby, building-local. Every part stays at least .04 below the LED band's bottom edge.
 * Near-frameless clear glass steps out from the street face; behind it a double-height lobby runs
 * CIRCA.entrance.recess deep into the podium: book-matched marble, a walnut wall with a backlit onyx panel,
 * linear pendant lights, a stone reception desk, a lounge, gold columns and potted olive trees.
 */
export function circaEntrance(out:Pick<CircaParts,'solid'|'entryGlass'|'entryDrums'|'lobbyGlow'|'lobbyFinish'|'rounds'|'leaves'>,palette:{white:string;wood:string;green:string;trim:string}){
 const P=CIRCA.podium,E=CIRCA.entrance,hd=P.d/2,top=CIRCA.screen.y0-.04,front=hd+E.depth,glassH=top-.07,back=hd-.06-E.recess,ex=E.w/2;
 const depth=front-back,mid=(front+back)/2,inner=ex-.03;
 const marble='#f3efe8',vein='#d9d1c4',walnut='#5b3a26',gold='#c9b07a',stone='#ebe5da',linen='#e9e0d0',onyx='#ffffff';
 const box=(t:Inst[],x:number,y:number,z:number,w:number,h:number,d:number,c:string)=>t.push({p:[x,y,z],s:[w,h,d],c});
 // Floor: white marble through pavilion and lobby, a darker border and a round medallion at the centre.
 box(out.lobbyFinish,0,0,mid,E.w,.03,depth,marble);
 for(const side of [-1,1])box(out.solid,side*(inner-.04),.03,mid,.03,.002,depth-.1,vein);
 out.rounds.push({p:[0,.03,mid+.1],s:[.62,.003,.62],c:vein},{p:[0,.031,mid+.1],s:[.5,.003,.5],c:marble});
 // Near-frameless glass: front and sides, slim gold fins at the corners and between bays, a thin roof and a glass canopy.
 box(out.entryGlass,0,.03,front,E.w,glassH,.015,'#ffffff');
 for(const side of [-1,1])box(out.entryGlass,side*ex,.03,hd+E.depth/2,.015,glassH,E.depth,'#ffffff');
 for(const x of [-ex,-ex/2,ex/2,ex])box(out.solid,x,.03,front,.014,glassH,.03,gold);
 for(const side of [-1,1])box(out.solid,side*ex,.03,hd+.02,.014,glassH,.03,gold);
 box(out.solid,0,.03+glassH,hd+E.depth/2,E.w+.04,.025,E.depth+.04,palette.white);
 box(out.solid,0,.03+glassH+.005,front+.005,E.w+.04,.02,.012,gold);
 box(out.entryGlass,0,top-.02,front+E.canopy/2,E.w+.4,.012,E.canopy,'#ffffff');
 box(out.solid,0,top-.026,front+E.canopy,E.w+.4,.022,.02,gold);
 // Two glass revolving doors with gold crowns, and a slim transom rail.
 const doorH=Math.min(.5,glassH-.04);
 for(const x of [-.42,.42]){out.entryDrums.push({p:[x,.03,front],s:[.34,doorH,.34],c:'#ffffff'});out.rounds.push({p:[x,.03+doorH,front],s:[.36,.03,.36],c:gold});box(out.solid,x,.03,front,.01,doorH-.01,.32,gold);}
 box(out.solid,0,.03+doorH+.03,front,E.w,.012,.02,gold);
 // Lobby walls: walnut back wall with a backlit onyx panel and gold reveals; marble side walls with walnut fins.
 box(out.solid,0,.03,back+.02,E.w-.06,glassH,.04,walnut);
 box(out.lobbyGlow,0,.12,back+.045,1.0,glassH-.26,.012,onyx);
 for(const side of [-1,1])box(out.solid,side*.52,.12,back+.05,.012,glassH-.26,.015,gold);
 for(const side of [-1,1]){box(out.lobbyFinish,side*(inner-.01),.03,(back+hd)/2,.02,glassH,hd-back,stone);for(let z=back+.2;z<hd-.05;z+=.22)box(out.solid,side*(inner-.03),.03,z,.02,glassH,.04,walnut);}
 // Ceiling: white soffit with three linear pendant lights on fine rods.
 box(out.lobbyFinish,0,top-.02,(back+hd)/2,E.w-.04,.02,hd-back,palette.white);
 for(const z of [back+.35,back+.75,hd+.15]){box(out.lobbyGlow,0,glassH-.14,z,E.w*.55,.018,.03,onyx);for(const x of [-E.w*.25,E.w*.25])box(out.solid,x,glassH-.122,z,.006,top-(glassH-.122)-.02,.006,gold);}
 // Reception: stone-topped walnut desk in front of the onyx wall.
 box(out.solid,0,.03,back+.32,1.0,.13,.16,walnut);box(out.lobbyFinish,0,.16,back+.32,1.06,.015,.2,stone);box(out.lobbyGlow,0,.04,back+.415,.96,.008,.006,onyx);
 // Lounge: linen sofas facing a dark stone table on a rug, gold columns and potted olive trees.
 box(out.solid,0,.03,mid+.25,1.1,.004,.6,'#8c7b6a');
 for(const side of [-1,1]){box(out.lobbyFinish,side*.42,.034,mid+.25,.16,.07,.5,linen);box(out.lobbyFinish,side*.5,.104,mid+.25,.04,.06,.5,linen);}
 box(out.solid,0,.034,mid+.25,.26,.05,.26,'#2d2a26');
 for(const side of [-1,1])out.rounds.push({p:[side*(ex-.32),.03,hd+.1],s:[.07,glassH-.03,.07],c:gold});
 for(const [x,z] of [[-(inner-.18),back+.2],[inner-.18,back+.2],[-(inner-.18),front-.15],[inner-.18,front-.15]] as const){out.rounds.push({p:[x,.03,z],s:[.14,.12,.14],c:'#e0d9cc'});box(out.solid,x,.15,z,.012,.16,.012,'#6f5a43');out.leaves.push({p:[x,.27,z],s:[.13,.16,.13],c:'#8a9a6a'});}
 // Outside: planter benches either side of the door and a stone landing meeting the walk.
 for(const side of [-1,1]){box(out.solid,side*(ex+.38),0,front-.12,.5,.1,.22,palette.wood);box(out.solid,side*(ex+.38),.1,front-.12,.46,.05,.18,palette.green);out.leaves.push({p:[side*(ex+.38),.2,front-.12],s:[.2,.16,.2],c:palette.green});}
 box(out.solid,0,0,front+.2,E.w+.6,.025,.4,'#e8e2d4');
}

export const circaPieceCount=(p:CircaParts)=>Object.values(p).reduce((n,list)=>n+list.length,0);
