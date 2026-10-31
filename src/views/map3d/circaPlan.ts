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
 // w/depth: the projecting entry, sized like the district's other front doors (canopies 1.1 to 1.8 wide, doors .74 x .65).
 // lobby: the wider see-through lobby recessed behind the podium glass.
 entrance:{w:1.8,lobby:2.8,depth:.4,canopy:.3,recess:1.75},
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
 {const cw=P.w-.12,cd=P.d-.12,ex=E.lobby/2,lobbyTop=CIRCA.screen.y0-.04,back=cd/2-E.recess,sideW=(cw/2-ex);
  for(const side of [-1,1])box(out.solid,side*(ex+sideW/2),0,0,sideW,P.h,cd,palette.core);
  box(out.solid,0,0,(-cd/2+back)/2,E.lobby,P.h,back+cd/2,palette.core);
  box(out.solid,0,lobbyTop,back+E.recess/2,E.lobby,P.h-lobbyTop,E.recess,palette.core);}
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
 * Entrance and lobby, building-local. Every part stays at least .04 below the LED band's bottom edge.
 * A black-framed glass storefront with centre double doors steps out from the street face; behind it a
 * double-height lobby runs CIRCA.entrance.recess deep into the podium. Stylized, unofficial take on a modern
 * residential lobby: slatted grey ceiling with black spotlights, faceted white marble on the west wall, a
 * sculpted wavy walnut wall on the east, an elevator vestibule in walnut with a grey stone tile floor and two
 * sculptural pillars, a marble-and-walnut reception desk under pendant rods, a diamond chandelier over a round
 * flower table, black tufted lounge chairs on a cowhide-pattern rug, and a navy sofa with cognac sling chairs
 * and an arc floor lamp on a blue-grey rug. No signage or logos.
 * Returns the doorway's centre x and width so tests can check it meets the front walk.
 */
export function circaEntrance(out:Pick<CircaParts,'solid'|'entryGlass'|'entryDrums'|'lobbyGlow'|'lobbyFinish'|'rounds'|'leaves'>,palette:{white:string;wood:string;green:string;trim:string}):{door:{x:number;w:number;h:number}}{
 const P=CIRCA.podium,E=CIRCA.entrance,hd=P.d/2,top=CIRCA.screen.y0-.04,front=hd+E.depth,glassH=top-.07,back=hd-.06-E.recess,ex=E.w/2,lx=E.lobby/2;
 const inner=lx-.03,floor=.03;
 const marble='#f3efe8',vein='#b9b4ad',walnut='#5b3a26',walnutLight='#76503a',black='#1b1b1d',tile='#a6a49f',grout='#8e8c87',slat='#8d8e8f',soffit='#5f6062',glow='#ffffff';
 const box=(t:Inst[],x:number,y:number,z:number,w:number,h:number,d:number,c:string,r?:number,rx?:number)=>t.push({p:[x,y,z],s:[w,h,d],c,...(r===undefined?{}:{r}),...(rx===undefined?{}:{rx})});
 const vest=back+.55;
 // Floors: light marble through the lounge and pavilion; grey stone tiles in the elevator vestibule.
 box(out.lobbyFinish,0,0,(vest+hd)/2,E.lobby,floor,hd-vest,marble);box(out.lobbyFinish,0,0,(hd+front)/2,E.w,floor,front-hd,marble);
 box(out.solid,0,0,(back+vest)/2,E.lobby,floor,vest-back,tile);
 for(let x=-inner+.3;x<inner;x+=.3)box(out.solid,x,floor,(back+vest)/2,.006,.002,vest-back,grout);
 box(out.solid,0,floor,back+.28,E.lobby-.06,.002,.006,grout);
 // Storefront: near-frameless glass in slim black mullions, black roof edge and canopy edge.
 box(out.entryGlass,0,floor,front,E.w,glassH,.015,glow);
 for(const side of [-1,1])box(out.entryGlass,side*ex,floor,hd+E.depth/2,.015,glassH,E.depth,glow);
 for(const x of [-ex,-.38,.38,ex])box(out.solid,x,floor,front,.016,glassH,.03,black);
 for(const side of [-1,1])box(out.solid,side*ex,floor,hd+.02,.016,glassH,.03,black);
 box(out.solid,0,floor+glassH,hd+E.depth/2,E.w+.04,.025,E.depth+.04,palette.white);
 box(out.solid,0,floor+glassH+.005,front+.005,E.w+.04,.02,.012,black);
 box(out.entryGlass,0,top-.02,front+E.canopy/2,E.w+.2,.012,E.canopy,glow);
 box(out.solid,0,top-.026,front+E.canopy,E.w+.2,.022,.02,black);
 // Centre double glass doors, the same size as the district's other front doors: black frame, transom, long pulls.
 const doorW=.74,doorH=Math.min(.65,glassH-.1);
 box(out.solid,0,floor+doorH,front,doorW+.03,.02,.035,black);box(out.solid,0,floor+doorH+.12,front,E.w,.012,.025,black);
 box(out.solid,0,floor,front,.012,doorH,.03,black);
 for(const side of [-1,1]){box(out.solid,side*.05,floor+.18,front+.02,.008,.3,.008,'#c9c4bb');box(out.solid,side*.05,floor+.18,front-.02,.008,.3,.008,'#c9c4bb');}
 // Elevator vestibule: walnut back wall in two-tone book-matched strips, two dark elevator doors with black surrounds.
 box(out.lobbyFinish,0,floor,back+.02,E.lobby-.06,glassH,.04,walnut);
 for(let x=-inner+.08,i=0;x<inner-.04;x+=.1,i++)if(Math.abs(Math.abs(x)-.36)>.22)box(out.lobbyFinish,x,floor+.02,back+.045,.05,glassH-.04,.008,i%2?walnutLight:walnut);
 for(const x of [-.36,.36]){box(out.solid,x,floor,back+.043,.36,.6,.012,black);box(out.solid,x,floor,back+.05,.3,.56,.008,'#3d3b38');box(out.solid,x,floor,back+.055,.004,.56,.004,'#26241f');box(out.lobbyGlow,x,floor+.64,back+.05,.12,.012,.006,glow);}
 // Two sculptural textured pillars framing the vestibule.
 for(const side of [-1,1])for(let y=floor,i=0;y<floor+glassH-.04;y+=.04,i++)out.rounds.push({p:[side*.82,y,vest-.08],s:i%2?[.13,.04,.13]:[.16,.04,.16],c:i%2?'#cfc8bb':'#b9b1a3'});
 // West wall: faceted white marble, panels folded at alternating angles with grey veins.
 for(let z=back+.14,i=0;z<hd+.05;z+=.25,i++){const r=i%2?.28:-.28;box(out.lobbyFinish,-(inner-.06),floor,z,.03,glassH,.27,marble,r);box(out.solid,-(inner-.08),floor+.1,z+(i%2?-.04:.05),.004,glassH-.2,.006,vein,r+.4);}
 // East wall: a sculpted wavy walnut wall of vertical slats whose depth follows a slow wave.
 for(let z=back+.06,i=0;z<hd+.05;z+=.05,i++){const d=.03+.08*(1+Math.sin(i*.55))/2;box(out.lobbyFinish,inner-d/2,floor,z,d,glassH,.036,i%3?walnut:walnutLight);}
 // Ceiling: dark grey soffit with lighter linear slats and a grid of black spotlights with warm lenses.
 box(out.lobbyFinish,0,top-.02,(back+hd)/2,E.lobby-.04,.02,hd-back,soffit);
 for(let z=back+.05;z<hd;z+=.07)box(out.lobbyFinish,0,top-.045,z,E.lobby-.1,.025,.026,slat);
 for(const x of [-.9,-.45,0,.45,.9])for(const z of [back+.35,back+.9,back+1.45]){out.rounds.push({p:[x,top-.07,z],s:[.04,.025,.04],c:black});box(out.lobbyGlow,x,top-.073,z,.022,.004,.022,glow);}
 // Reception: white marble base with a walnut top, a glow reveal, and vertical pendant rods above.
 const desk:[number,number]=[.5,back+.9];
 box(out.lobbyFinish,desk[0],floor,desk[1],.72,.13,.16,marble);box(out.lobbyFinish,desk[0],floor+.13,desk[1],.76,.02,.2,walnut);box(out.lobbyGlow,desk[0],floor+.01,desk[1]+.082,.68,.008,.006,glow);
 for(let i=0;i<6;i++){const x=desk[0]-.25+i*.1,len=.12+.05*(i%2);box(out.solid,x,floor+glassH-.3+len,desk[1],.003,top-.07-(floor+glassH-.3+len),.003,black);box(out.lobbyGlow,x,floor+glassH-.3,desk[1],.014,len,.014,glow);}
 // Centre: round dark pedestal table with a white bouquet under a diamond chandelier.
 const ct:[number,number]=[-.45,back+.92];
 out.rounds.push({p:[ct[0],floor,ct[1]],s:[.07,.12,.07],c:'#2a2623'},{p:[ct[0],floor+.12,ct[1]],s:[.2,.02,.2],c:'#2a2623'},{p:[ct[0],floor+.14,ct[1]],s:[.04,.05,.04],c:'#dcdcdc'});
 out.leaves.push({p:[ct[0],floor+.17,ct[1]],s:[.08,.07,.08],c:'#f7f4ee'});
 box(out.solid,ct[0],floor+glassH-.2,ct[1],.003,top-.07-(floor+glassH-.2),.003,black);
 box(out.lobbyGlow,ct[0],floor+glassH-.36,ct[1],.12,.12,.12,glow,Math.PI/4,Math.PI/4);
 // West lounge: black tufted leather chairs facing across a glass table on a black-and-white hide rug.
 const wl:[number,number]=[-.72,hd-.33];
 box(out.solid,wl[0],floor,wl[1],.62,.004,.46,'#efece6');
 for(const [dx,dz,w,d] of [[-.18,-.1,.14,.1],[.12,.08,.16,.12],[.2,-.14,.08,.07],[-.05,.15,.1,.06]] as const)box(out.solid,wl[0]+dx,floor+.004,wl[1]+dz,w,.002,d,'#1c1c1c');
 for(const side of [-1,1]){const x=wl[0]+side*.22;box(out.solid,x,floor+.004,wl[1],.16,.07,.18,black);box(out.solid,x+side*.07,floor+.074,wl[1],.04,.1,.18,black);for(const dz of [-.05,.05])box(out.solid,x+side*.045,floor+.11,wl[1]+dz,.004,.04,.004,'#3a3a3c');}
 box(out.entryGlass,wl[0],floor+.004,wl[1],.16,.06,.12,glow);box(out.solid,wl[0],floor+.064,wl[1],.16,.004,.12,'#cfd6da');
 // East lounge: navy velvet sofa with pillows facing cognac leather sling chairs, dark wood table on a metal base,
 // all on a blue-grey rug, with an arc floor lamp reaching over.
 const el:[number,number]=[.62,hd-.32];
 box(out.solid,el[0],floor,el[1],.7,.004,.5,'#7c8a96');
 box(out.solid,el[0],floor+.004,el[1]-.16,.5,.07,.16,'#26314f');box(out.solid,el[0],floor+.074,el[1]-.23,.5,.09,.04,'#26314f');
 for(const dx of [-.16,.16])box(out.solid,el[0]+dx,floor+.074,el[1]-.19,.1,.06,.03,'#e9e4da');
 box(out.solid,el[0],floor+.004,el[1],.06,.04,.06,'#555a5f');box(out.solid,el[0],floor+.044,el[1],.26,.02,.12,'#3a2a1f');
 for(const dx of [-.14,.14]){const x=el[0]+dx;box(out.solid,x,floor+.004,el[1]+.17,.14,.012,.14,'#2a2a2a');box(out.solid,x,floor+.03,el[1]+.17,.13,.03,.12,'#9a5a2e');box(out.solid,x,floor+.05,el[1]+.235,.13,.08,.02,'#9a5a2e',0,-.3);}
 const lamp:[number,number]=[inner-.14,el[1]-.2];
 out.rounds.push({p:[lamp[0],floor,lamp[1]],s:[.08,.02,.08],c:'#2a2a2a'},{p:[lamp[0],floor+.02,lamp[1]],s:[.01,.42,.01],c:'#2a2a2a'});
 for(let i=0;i<4;i++)box(out.solid,lamp[0]-.05-i*.08,floor+.44-i*i*.012,lamp[1]+.04,.08,.008,.008,'#2a2a2a');
 box(out.lobbyGlow,lamp[0]-.34,floor+.33,lamp[1]+.04,.08,.05,.08,glow);
 // A pair of olive trees in stone pots in the entry's front corners.
 for(const x of [-(ex-.12),ex-.12]){const z=front-.12;out.rounds.push({p:[x,floor,z],s:[.13,.12,.13],c:'#e0d9cc'});box(out.solid,x,floor+.12,z,.012,.16,.012,'#6f5a43');out.leaves.push({p:[x,floor+.24,z],s:[.13,.16,.13],c:'#8a9a6a'});}
 // Outside: planter benches, two short lit bollards and a stone landing meeting the walk.
 for(const side of [-1,1]){box(out.solid,side*(ex+.38),0,front-.12,.5,.1,.22,palette.wood);box(out.solid,side*(ex+.38),.1,front-.12,.46,.05,.18,palette.green);out.leaves.push({p:[side*(ex+.38),.2,front-.12],s:[.2,.16,.2],c:palette.green});}
 for(const side of [-1,1]){out.rounds.push({p:[side*(doorW/2+.25),0,front+.36],s:[.06,.12,.06],c:black});box(out.lobbyGlow,side*(doorW/2+.25),.1,front+.36,.05,.015,.05,glow);}
 box(out.solid,0,0,front+.2,E.w+.6,.025,.4,'#e8e2d4');
 return {door:{x:0,w:doorW,h:doorH}};
}

export const circaPieceCount=(p:CircaParts)=>Object.values(p).reduce((n,list)=>n+list.length,0);
