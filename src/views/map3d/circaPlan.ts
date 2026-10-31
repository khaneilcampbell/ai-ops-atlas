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
 podium:{w:7.4,d:8.6,h:1.65,retail:.4},
 tower:{rx:1.25,rz:.95,turn:.42,centres:[[-1.75,1.95],[1.75,-1.95]] as Pt[],floors:27,balconySide:.1},
 crown:.6,
 /** Minimum distance from the highway centreline to any corner of the parcel. */
 highwayClearance:1.2,
 /** Instance budget for the whole complex (towers, podium, deck, palms, street). */
 maxPieces:1200,
 screen:{y0:.46,y1:1.5,inset:.12,waves:1.5,amplitude:.22},
 /** Second, flat screen on the street front, west of the entrance. */
 frontScreen:{x0:-3.45,x1:-.9,y0:.5,y1:1.48,offset:.13},
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
}

const rotate=([x,z]:Pt,a:number):Pt=>[x*Math.cos(a)+z*Math.sin(a),z*Math.cos(a)-x*Math.sin(a)];

/** All parts in building-local coordinates. `height` is the tower roof above the terrace. */
export function circaParts(height:number,palette:{white:string;stone:string;trim:string;core:string;green:string;turquoise:string;wood:string}):CircaParts{
 const out:CircaParts={solid:[],storefront:[],towerGlass:[],slabs:[],balconies:[],roundWater:[],lapWater:[],rounds:[],leaves:[],fronds:[]};
 const P=CIRCA.podium,T=CIRCA.tower,hw=P.w/2,hd=P.d/2;
 const box=(t:Inst[],x:number,y:number,z:number,w:number,h:number,d:number,c:string,r=0)=>t.push({p:[x,y,z],s:[w,h,d],c,...(r?{r}:{})});

 // Podium: dark garage core behind white louvers, retail glass at street level.
 box(out.solid,0,0,0,P.w-.12,P.h,P.d-.12,palette.core);
 box(out.storefront,0,.04,hd-.04,P.w-.3,P.retail-.08,.04,'#ffffff');
 box(out.storefront,hw-.04,.04,0,.04,P.retail-.08,P.d-.3,'#ffffff');
 for(let x=-hw+.4;x<hw-.2;x+=.62)if(Math.abs(x)>.45)box(out.solid,x,.04,hd-.01,.03,P.retail-.08,.03,palette.white);
 for(let z=-hd+.4;z<hd-.2;z+=.62)box(out.solid,hw-.01,.04,z,.03,P.retail-.08,.03,palette.white);
 // Retail canopy along the street and the east side.
 box(out.solid,0,P.retail-.04,hd+.12,P.w+.1,.05,.3,palette.white);
 box(out.solid,hw+.12,P.retail-.04,0,.3,.05,P.d+.1,palette.white);
 // Entrance portal at the street door.
 box(out.solid,0,P.retail,hd+.2,1.2,.06,.42,palette.trim);
 // Vertical louvers screen the parking levels on the north, south and east faces.
 const louverY=P.retail+.06,louverH=P.h-louverY-.1;
 for(let x=-hw+.12;x<=hw-.1;x+=.2){box(out.solid,x,louverY,hd+.03,.035,louverH,.1,palette.white);box(out.solid,x,louverY,-hd-.03,.035,louverH,.1,palette.white);}
 for(let z=-hd+.12;z<=hd-.1;z+=.2)box(out.solid,hw+.03,louverY,z,.1,louverH,.035,palette.white);
 // Floor bands every two parking levels.
 for(const y of [louverY,louverY+louverH/2])for(const side of [-1,1]){box(out.solid,0,y-.03,side*(hd+.02),P.w+.06,.04,.14,palette.white);box(out.solid,side*(hw+.02),y-.03,0,.14,.04,P.d+.06,palette.white);}
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
 for(let x=-hw+.5;x<=hw-.3;x+=1.15)if(Math.abs(x)>.8)palm(x,hd+.75,1.05+(seed++%3)*.12,seed);
 for(let z=-hd+.6;z<=hd-.4;z+=1.4)palm(hw+.45,z,1.0+(seed++%3)*.12,seed);
 return out;
}

/** Wave-shaped LED screen on the west facade, building-local (x,z) samples along z. */
export function circaScreenPath(samples=40):Pt[]{
 const P=CIRCA.podium,S=CIRCA.screen,span=P.d-.5,points:Pt[]=[];
 for(let i=0;i<=samples;i++){const t=i/samples,z=-span/2+t*span;points.push([-P.w/2-S.inset-S.amplitude*(1+Math.sin(t*Math.PI*2*S.waves))/2,z]);}
 return points;
}

export const circaPieceCount=(p:CircaParts)=>Object.values(p).reduce((n,list)=>n+list.length,0);
