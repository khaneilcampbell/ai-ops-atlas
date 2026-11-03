import {WALL,b,bath,bed,col,emptyParts,wallX,wallZ,type Parts} from "./circaInteriorParts";
import {TOWER_CORRIDOR,TOWER_ROOMS_EAST,TOWER_SPLIT,roomPoint,towerRooms,type TowerRoom,type TowerSpec} from "./towerPlan";

/**
 * Part lists for the Financial District interiors (see towerPlan), drawn as instanced meshes like Circa's floors.
 * Same palette as Circa: walnut, white marble, oak floors, black frames, cognac leather, grey upholstery; each building's
 * brand colour shows only as an accent (a glowing strip on the lobby wall and desks, and a rug per room).
 */
const H=3.2;
/** The brand colour mixed toward the warm white walls: `amount` 1 is the full colour. */
export function tint(hex:string,amount:number){
  const n=parseInt(hex.slice(1),16),base=[0xf1,0xee,0xe8],c=[n>>16&255,n>>8&255,n&255];
  return "#"+c.map((v,i)=>Math.round(base[i]+(v-base[i])*amount).toString(16).padStart(2,"0")).join("");
}

/** Floor-to-ceiling glass round the whole plate, with slim black mullions; `door` leaves the lobby's street door open. */
function glassWalls(o:Parts,w:number,d:number,door=0){
  const hw=w/2-.06,hd=d/2-.06;
  const run=(x:number,z:number,len:number,r:number)=>{
    o.glass.push({p:[x,H/2,z],s:[len,H,.04],c:"#dfe9ea",...(r?{r}:{})});
    b(o.box,x,0,z,len,.1,.1,col.black,r);b(o.box,x,H-.035,z,len,.035,.07,col.black,r);
    const n=Math.max(1,Math.round(len/1.5));for(let i=0;i<=n;i++){const t=-len/2+len*i/n;b(o.box,r?x:x+t,0,r?z+t:z,.04,H,.06,col.black,r);}
  };
  run(-hw,0,d-.12,Math.PI/2);run(hw,0,d-.12,Math.PI/2);run(0,-hd,w-.12,0);
  if(door){for(const s of [-1,1]){const x0=s*door,x1=s*hw,len=Math.abs(x1-x0);run((x0+x1)/2,hd,len,0);}
    o.glass.push({p:[0,(2.6+H)/2,hd],s:[door*2,H-2.6,.04],c:"#dfe9ea"});b(o.box,0,2.56,hd,door*2,.04,.08,col.black);b(o.box,0,H-.035,hd,door*2,.035,.07,col.black);}
  else run(0,hd,w-.12,0);
  // Night: a warm cove under the head of the glass.
  for(const [x,z,len,r] of [[-hw+.12,0,d-.4,Math.PI/2],[hw-.12,0,d-.4,Math.PI/2],[0,-hd+.12,w-.4,0],[0,hd-.12,w-.4,0]] as const)o.glow.push({p:[x,H-.1,z],s:[len,.03,.05],c:"#ffe6bf",...(r?{r}:{})});
}
function plant(o:Parts,x:number,z:number){o.round.push({p:[x,.3,z],s:[.7,.6,.7],c:"#e0d9cc"},{p:[x,.95,z],s:[.08,.7,.08],c:"#6f5a43"},{p:[x,1.55,z],s:[1.1,.9,1.1],c:"#8a9a6a"});}
function chair(o:Parts,x:number,z:number,c:string,face:-1|1){b(o.box,x,0,z,.5,.45,.5,c);b(o.box,x,.45,z-face*.22,.5,.5,.08,c);}

/** The ground floor: walnut back wall with the brand strip, glass on three sides, front desk, two lounges. */
export function towerLobbyParts(spec:TowerSpec):Parts{
  const o=emptyParts(),{w,d}=spec,hd=d/2;
  b(o.box,0,0,0,w,.012,d,col.marble);for(let x=-w/2+2;x<w/2;x+=2)b(o.box,x,.012,0,.012,.002,d-.1,"#e6e1d8");
  // Back wall: walnut in book-matched strips, with a glowing strip in the brand colour.
  b(o.box,0,0,-hd+.08,w,H,.16,col.walnut);
  for(let x=-w/2+.3,i=0;x<w/2-.2;x+=.5,i++)b(o.box,x,.1,-hd+.17,.24,H-.2,.02,i%2?"#76503a":col.walnut);
  o.glow.push({p:[0,2.3,-hd+.2],s:[w*.45,.05,.03],c:spec.accent});
  glassWalls(o,w,d,1.32);
  // Front desk: white marble with a walnut top and a brand-colour reveal.
  const dz=-hd+2.6;b(o.box,-1.5,0,dz,3.2,1,.9,col.marble);b(o.box,-1.5,1,dz,3.4,.08,1.05,col.walnut);o.glow.push({p:[-1.5,.08,dz+.47],s:[3,.04,.02],c:spec.accent});
  // West lounge: grey sofa, walnut table and two cognac chairs on a rug.
  b(o.box,-7,.012,1.6,4.2,.012,3.4,col.rug);
  b(o.box,-7,0,2.8,2.6,.42,.85,col.greySofa);b(o.box,-7,.42,3.18,2.6,.4,.16,col.greySofa);
  b(o.box,-7,0,1.7,1.3,.36,.65,col.walnut);
  chair(o,-7.7,.7,col.cognac,1);chair(o,-6.3,.7,col.cognac,1);
  // East seating: black leather chairs either side of a glass table.
  for(const x of [2.2,3.8])chair(o,x,3.4,col.black,x<3?1:-1);
  o.glass.push({p:[3,.2,3.4],s:[.8,.4,.6],c:"#dfe9ea"});
  // Plants in the corners.
  for(const [x,z] of [[-w/2+1,-hd+1.1],[-w/2+1,hd-1.1],[w/2-1.1,hd-1.1],[w/2-1.1,-hd+1.1]] as const)plant(o,x,z);
  // A runner from the street door to the middle.
  b(o.box,0,.012,(hd+.5)/2,3,.015,hd-.5,"#9a9893");
  return o;
}

/** One room's furniture, in room-local u/v (see towerPlan.roomPoint). */
function roomParts(o:Parts,r:TowerRoom,spec:TowerSpec){
  const W=r.x1-r.x0,D=r.depth,P=(u:number,v:number)=>roomPoint(r,u,v);
  const box=(u:number,y0:number,v:number,wu:number,h:number,dv:number,c:string)=>{const [x,z]=P(u,v);b(o.box,x,y0,z,wu,h,dv,c);};
  // A rug in the brand colour, toned down, under the room's main piece.
  const rug=(u:number,v:number,wu:number,dv:number)=>box(u,.012,v,wu,.012,dv,tint(spec.accent,.35));
  switch(r.kind){
    case "reception":{
      rug(W/2,D*.55,W*.6,D*.5);
      box(W/2,0,D*.62,2.8,1,.8,col.marble);box(W/2,1,D*.62,3,.08,.95,col.walnut);
      box(W/2,0,D-.9,3,2.4,.12,col.walnut);
      for(const u of [W*.18,W*.18+1])box(u,0,D*.3,.6,.42,.6,col.cognac);
      const [px,pz]=P(W-.8,D-.8);plant(o,px,pz);
      break;}
    case "workspace":{
      rug(W/2,3.4,W*.85,4.6);
      for(const v of D>=6.2?[2.4,4.6]:[2.4])for(const f of [.2,.5,.8]){
        const u=W*f;box(u,.72,v,1.5,.04,.75,col.oak);box(u-.65,0,v,.05,.72,.7,col.black);box(u+.65,0,v,.05,.72,.7,col.black);
        box(u,.76,v+.22,.55,.36,.04,col.black);box(u,0,v-.62,.5,.9,.5,col.black);
      }
      break;}
    case "meeting":{
      const tv=D/2+.2,tw=W*.5;rug(W/2,tv,tw+1.6,3);
      box(W/2,.72,tv,tw,.06,1.3,col.walnut);box(W/2-tw/2+.4,0,tv,.1,.72,.9,col.black);box(W/2+tw/2-.4,0,tv,.1,.72,.9,col.black);
      const n=Math.max(2,Math.floor(tw/1));for(let i=0;i<n;i++){const u=W/2-tw/2+tw*(i+.5)/n;box(u,0,tv-1,.5,.9,.5,col.black);box(u,0,tv+1,.5,.9,.5,col.black);}
      box(W/2,.9,D-.3,2.2,1.2,.08,col.black);
      break;}
    case "private":{
      const dv=D*.62;rug(W*.6,dv,3.2,2.6);
      box(W*.6,.72,dv,1.9,.06,.85,col.walnut);box(W*.6,0,dv,1.7,.72,.6,col.walnut);
      box(W*.6,0,dv+.65,.6,1.1,.6,col.black);
      for(const du of [-.5,.5])box(W*.6+du,0,dv-.75,.55,.75,.55,col.cognac);
      box(W-.55,0,D*.35,.9,.75,2.2,col.greySofa);
      box(W*.25,0,D-.35,2.4,1.9,.4,col.walnut);
      const [px,pz]=P(.8,D-.8);plant(o,px,pz);
      break;}
    case "suite":{
      rug(W*.55,D*.6,W*.7,D*.55);
      // Bath in the corner by the corridor: low walls, door facing the room.
      const [bx0,bz0]=P(0,0),[bx1,bz1]=P(2.6,2.4),z0=Math.min(bz0,bz1),z1=Math.max(bz0,bz1);
      bath(o,bx0,bx1,z0,z1,true,r.side);
      wallX(o.box,r.side*(TOWER_CORRIDOR+2.4),bx0,bx1,WALL.low);
      const gap:[number,number]=r.side>0?[TOWER_CORRIDOR+.6,TOWER_CORRIDOR+1.4]:[-(TOWER_CORRIDOR+1.4),-(TOWER_CORRIDOR+.6)];
      wallZ(o.box,bx1,z0,z1,WALL.low,[gap]);
      // Bed with its headboard to the window; sofa, desk and wardrobe.
      const [kx,kz]=P(W*.4,D-1.3);bed(o,kx,kz,r.side*Math.PI/2,1.6);
      box(W-.55,0,D*.45,.9,.75,2.2,col.greySofa);
      box(W*.78,.72,.55,1.6,.05,.6,col.walnut);box(W*.78,0,.55,1.4,.72,.5,col.walnut);box(W*.78,0,1.05,.5,.9,.5,col.black);
      box(3.1,0,.35,.8,2,.6,col.walnut);
      break;}
  }
}

/** An upper floor: oak, glass all round, a corridor to the lift with four rooms off it. */
export function towerFloorParts(spec:TowerSpec,level:number):Parts{
  const o=emptyParts(),{w,d}=spec,rooms=towerRooms(spec,level),hd=d/2,C=TOWER_CORRIDOR;
  b(o.box,0,0,0,w,.03,d,col.oak);for(let z=-hd+.5;z<hd;z+=.5)b(o.box,0,.03,z,w-.1,.002,.015,col.plank);
  glassWalls(o,w,d);
  const west=-w/2+.1,rim=hd-.1;
  for(const side of [-1,1] as const){
    const mine=rooms.filter(r=>r.side===side);
    wallX(o.box,side*C,west,TOWER_ROOMS_EAST,WALL.low,mine.map(r=>r.door));
    const [za,zb]=side>0?[C,rim]:[-rim,-C];
    wallZ(o.box,TOWER_SPLIT,za,zb,WALL.low);wallZ(o.box,TOWER_ROOMS_EAST,za,zb,WALL.low);
    // Black door frames.
    for(const r of mine){b(o.box,r.door[0]-.04,0,side*C,.06,2.2,.14,col.black);b(o.box,r.door[1]+.04,0,side*C,.06,2.2,.14,col.black);b(o.box,(r.door[0]+r.door[1])/2,2.2,side*C,r.door[1]-r.door[0]+.14,.08,.14,col.black);}
  }
  for(const r of rooms)roomParts(o,r,spec);
  return o;
}
