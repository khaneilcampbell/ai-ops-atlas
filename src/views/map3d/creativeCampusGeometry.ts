import * as THREE from 'three';
import {CAMPUS,barCorners,inBuilding,type CreativeCampusPlan,type WingBar} from './creativeCampusPlan';
import type {Pt} from './roads';

/**
 * Atlas Creative Campus, built once as plain triangle lists and merged per material: white fins,
 * slabs and roofs; the banded glass behind the fins (its night map lights the floors); the dark red
 * glass of the leaning end blocks and skylights; the solid red ribbons and stair bands; the atrium's
 * clear glass; and one vertex-coloured mesh for everything on the ground (fields, courts, car park,
 * road, bridge, plaza steps, paths and trees). World coordinates, y up from sea level.
 */
type V3=[number,number,number];
type UV=[number,number];
type RGB=[number,number,number];

class Builder{
 pos:number[]=[];uv:number[]=[];col:number[]=[];
 constructor(readonly colored=false){}
 tri(a:V3,b:V3,c:V3,ua:UV=[0,0],ub:UV=[0,0],uc:UV=[0,0],k?:RGB){
  this.pos.push(...a,...b,...c);this.uv.push(...ua,...ub,...uc);
  if(this.colored){const c3=k??[1,1,1];this.col.push(...c3,...c3,...c3);}
 }
 /** A quad a-b-c-d, wound so its face points along `out`. */
 quad(a:V3,b:V3,c:V3,d:V3,out:V3,uv?:[UV,UV,UV,UV],k?:RGB){
  const u=uv??[[0,0],[0,0],[0,0],[0,0]];
  const e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],e2=[d[0]-a[0],d[1]-a[1],d[2]-a[2]];
  const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
  if(n[0]*out[0]+n[1]*out[1]+n[2]*out[2]>=0){this.tri(a,b,c,u[0],u[1],u[2],k);this.tri(a,c,d,u[0],u[2],u[3],k);}
  else{this.tri(a,c,b,u[0],u[2],u[1],k);this.tri(a,d,c,u[0],u[3],u[2],k);}
 }
 /** A box centred at (x, y0..y1, z), size w (along yaw) by d, turned by yaw about y. */
 box(x:number,z:number,y0:number,y1:number,w:number,d:number,yaw=0,k?:RGB,faces={bottom:false}){
  const c=Math.cos(yaw),s=Math.sin(yaw),at=(u:number,v:number,y:number):V3=>[x+u*c-v*s,y,z+u*s+v*c];
  const hw=w/2,hd=d/2,ex:V3=[c,0,s],ez:V3=[-s,0,c];
  this.quad(at(-hw,-hd,y1),at(hw,-hd,y1),at(hw,hd,y1),at(-hw,hd,y1),[0,1,0],undefined,k);
  if(faces.bottom)this.quad(at(-hw,-hd,y0),at(hw,-hd,y0),at(hw,hd,y0),at(-hw,hd,y0),[0,-1,0],undefined,k);
  this.quad(at(hw,-hd,y0),at(hw,hd,y0),at(hw,hd,y1),at(hw,-hd,y1),ex,undefined,k);
  this.quad(at(-hw,-hd,y0),at(-hw,hd,y0),at(-hw,hd,y1),at(-hw,-hd,y1),[-ex[0],0,-ex[2]],undefined,k);
  this.quad(at(-hw,hd,y0),at(hw,hd,y0),at(hw,hd,y1),at(-hw,hd,y1),ez,undefined,k);
  this.quad(at(-hw,-hd,y0),at(hw,-hd,y0),at(hw,-hd,y1),at(-hw,-hd,y1),[-ez[0],0,-ez[2]],undefined,k);
 }
 build(){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));
  if(this.colored)g.setAttribute('color',new THREE.Float32BufferAttribute(this.col,3));
  g.computeVertexNormals();return g;
 }
 /** An upright n-sided column (a round pillar at map scale), sides only. */
 column(x:number,z:number,y0:number,y1:number,r:number,n=8){
  for(let i=0;i<n;i++){const a0=i/n*Math.PI*2,a1=(i+1)/n*Math.PI*2,am=(a0+a1)/2,P=(a:number,y:number):V3=>[x+Math.cos(a)*r,y,z+Math.sin(a)*r];
   this.quad(P(a0,y0),P(a1,y0),P(a1,y1),P(a0,y1),[Math.cos(am),0,Math.sin(am)]);}
 }
 get triangles(){return this.pos.length/9;}
}

const hex=(h:string):RGB=>{const c=new THREE.Color(h);return [c.r,c.g,c.b];};
const K={
 grass:hex('#7fb05a'),pitch:hex('#4f9a48'),pitchDark:hex('#468c40'),line:hex('#f6f6f0'),clay:hex('#c46a4a'),sandCourt:hex('#e3c58f'),court:hex('#3f8f86'),
 asphalt:hex('#3d4146'),kerb:hex('#e6e1d6'),stall:hex('#eeeeea'),pave:hex('#eae6dd'),paveDark:hex('#d9d4c8'),step:hex('#f1eee8'),
 trunk:hex('#6e5338'),leaf:[hex('#3f7a3a'),hex('#4d8a3f'),hex('#5a9446'),hex('#356b33')],deck:hex('#cfc9bc'),pier:hex('#bdb59e'),rail:hex('#9aa0a3'),
 cars:[hex('#c8d0d6'),hex('#2f3a45'),hex('#b23b2f'),hex('#e9e6df'),hex('#3f5f86')],net:hex('#2b2a28'),
};

export interface CampusGeometry{white:THREE.BufferGeometry;inner:THREE.BufferGeometry;red:THREE.BufferGeometry;ribbon:THREE.BufferGeometry;atrium:THREE.BufferGeometry;ground:THREE.BufferGeometry;
 /** Bright red trim on the building itself: roof skylight frames, skylight ribs, the atrium balcony band. */
 trim:THREE.BufferGeometry;
 /** The ribbons cut back to the parts outside the building, for the interior's view out. */
 ribbonOutside:THREE.BufferGeometry;triangles:number}

const rad=(d:number)=>d*Math.PI/180;
const along=(b:WingBar,s:number,v:number):Pt=>[b.a[0]+b.dir[0]*s-b.dir[1]*v,b.a[1]+b.dir[1]*s+b.dir[0]*v];

/** One wing bar: banded glass body, white floor bands and roof, sawtooth fins, pilotis, skylight, end block. */
function wing(parts:{white:Builder;inner:Builder;red:Builder},b:WingBar,base:number,rib:Builder){
 const C=CAMPUS,H=C.storeys*C.storey,hw=b.width/2,yaw=Math.atan2(b.dir[1],b.dir[0]);
 const s0=b.index>0?-hw:0,end=b.last?b.length-C.endBlock.length:b.length+(b.index===0&&!b.last?hw:0),len=end-s0;
 const mid=along(b,s0+len/2,0),pil=s0+len*C.pilotis.share;
 // Banded glass body: upper storeys full width, the ground storey pulled in under the atrium half.
 const body=(sa:number,sb:number,y0:number,y1:number,half:number)=>{const m=along(b,(sa+sb)/2,0),l=sb-sa;
  const c=Math.cos(yaw),s=Math.sin(yaw),at=(u:number,v:number,y:number):V3=>[m[0]+u*c-v*s,y,m[1]+u*s+v*c];
  for(const side of [-1,1]){const n:V3=[-s*side,0,c*side];parts.inner.quad(at(-l/2,side*half,y0),at(l/2,side*half,y0),at(l/2,side*half,y1),at(-l/2,side*half,y1),n,[[sa,y0-base],[sb,y0-base],[sb,y1-base],[sa,y1-base]]);}
  for(const side of [-1,1]){const e:V3=[c*side,0,s*side];parts.inner.quad(at(side*l/2,-half,y0),at(side*l/2,half,y0),at(side*l/2,half,y1),at(side*l/2,-half,y1),e,[[0,y0-base],[b.width,y0-base],[b.width,y1-base],[0,y1-base]]);}
 };
 body(s0,end,base+C.storey,base+H,hw-.02);
 body(s0,pil,base,base+C.storey,hw-C.pilotis.inset);
 body(pil,end,base,base+C.storey,hw-.06);
 // White floor bands at every storey (they read through the fins) and the roof with its parapet.
 for(let k=1;k<C.storeys;k++)parts.white.box(mid[0],mid[1],base+k*C.storey-.03,base+k*C.storey+.03,len,b.width+.06,yaw);
 // Roof deck sunk behind a white parapet rim on both long faces, so the rim throws a thin shadow line.
 const roofW=b.width+2*C.fin.depth+.04,rim=.08;
 parts.white.box(mid[0],mid[1],base+H-.04,base+H+.03,len,roofW,yaw);
 for(const side of [-1,1]){const q=along(b,s0+len/2,side*(roofW/2-rim/2));parts.white.box(q[0],q[1],base+H-.04,base+H+C.parapet,len,rim,yaw);}
 // Rooftop plant behind a low white louvred screen, near the atrium end.
 const pl=along(b,s0+Math.min(1.4,len*.2),0);parts.white.box(pl[0],pl[1],base+H+.03,base+H+.17,.7,.42,yaw);
 parts.white.box(mid[0],mid[1],base+C.storey-.05,base+C.storey+.02,len,b.width+2*C.fin.depth,yaw);
 // Lit soffit under the first floor where the ground storey is pulled in: it samples the glass map's ceiling-light row.
 {const v=hw+C.fin.depth,y=base+C.storey-.052,q=(s:number,w:number):V3=>{const r=along(b,s,w);return [r[0],y,r[1]];},lv=C.storey*.9;
  parts.inner.quad(q(s0,-v),q(pil,-v),q(pil,v),q(s0,v),[0,-1,0],[[s0,lv],[pil,lv],[pil,lv],[s0,lv]]);}
 // Pilotis: round columns along both edges where the ground storey is pulled in.
 for(let s=s0+.5;s<pil;s+=1.1)for(const side of [-1,1]){const p=along(b,s,side*(hw-.1));parts.white.column(p[0],p[1],base,base+C.storey,.06);}
 // Sawtooth fins: a zigzag skin over both long faces from the first floor to the roof.
 // Each tooth is a folded white panel over part of its pitch; between teeth the storey-tall glass shows.
 // Fin UVs: u runs .05 at the wall to .95 at the fold, v one per storey, so the fin map draws panel joints.
 const n=Math.max(2,Math.round(len/C.fin.pitch)),pitch=len/n,y0=base+C.storey+.02,y1=base+H-.04,gap=pitch*(1-C.fin.blade)/2,vt=(y1-y0)/C.storey+.5;
 for(const side of [-1,1]){
  const out:V3=[-b.dir[1]*side,0,b.dir[0]*side];
  for(let i=0;i<n;i++){
   const sa=s0+i*pitch+gap,sb=s0+(i+1)*pitch-gap,sm=(sa+sb)/2;
   const pa=along(b,sa,side*hw),pm=along(b,sm,side*(hw+C.fin.depth)),pb=along(b,sb,side*hw);
   // Each tooth's two faces lean toward and away from the wing's end, so the facade catches light in stripes.
   const fa:V3=[out[0]-b.dir[0]*.6,0,out[2]-b.dir[1]*.6],fb:V3=[out[0]+b.dir[0]*.6,0,out[2]+b.dir[1]*.6];
   parts.white.quad([pa[0],y0,pa[1]],[pm[0],y0,pm[1]],[pm[0],y1,pm[1]],[pa[0],y1,pa[1]],fa,[[.05,.5],[.95,.5],[.95,vt],[.05,vt]]);
   parts.white.quad([pm[0],y0,pm[1]],[pb[0],y0,pb[1]],[pb[0],y1,pb[1]],[pm[0],y1,pm[1]],fb,[[.95,.5],[.05,.5],[.05,vt],[.95,vt]]);
  }
 }
 // A raked red skylight on the roof, over the studios: a bright red frame round darker red glass.
 const sk=along(b,s0+len*.56,0);rib.box(sk[0],sk[1],base+H+.02,base+H+.1,len*.48+.12,.98,yaw);parts.red.box(sk[0],sk[1],base+H+.02,base+H+.14,len*.48,.86,yaw);
 if(!b.last)return;
 // The end block: dark red glass, wider than the wing, leaning outward and rising above the roof.
 const E=C.endBlock,lean=Math.tan(rad(E.lean))*E.h,ehw=hw+E.wide/2,sa=end-.08,sb=b.length;
 const P=(s:number,v:number,y:number):V3=>{const t=(y-base)/E.h*lean,q=along(b,s+t,v);return [q[0],y,q[1]];};
 const yt=base+E.h,o=(v:V3)=>v;
 const sideN=(k:number):V3=>[-b.dir[1]*k,0,b.dir[0]*k];
 for(const k of [-1,1])parts.red.quad(P(sa,k*ehw,base),P(sb,k*ehw,base),P(sb,k*ehw,yt),P(sa,k*ehw,yt),sideN(k),[[sa,0],[sb,0],[sb,E.h],[sa,E.h]]);
 parts.red.quad(P(sb,-ehw,base),P(sb,ehw,base),P(sb,ehw,yt),P(sb,-ehw,yt),o([b.dir[0],-.2,b.dir[1]]),[[0,0],[ehw*2,0],[ehw*2,E.h],[0,E.h]]);
 parts.red.quad(P(sa,-ehw,base),P(sa,ehw,base),P(sa,ehw,yt),P(sa,-ehw,yt),[-b.dir[0],.2,-b.dir[1]],[[0,0],[ehw*2,0],[ehw*2,E.h],[0,E.h]]);
 parts.white.quad(P(sa,-ehw,yt),P(sb,-ehw,yt),P(sb,ehw,yt),P(sa,ehw,yt),[0,1,0]);
 // A thin white edge round its top.
 for(const k of [-1,1]){const q0=P(sa,k*ehw,yt),q1=P(sb,k*ehw,yt),m=[(q0[0]+q1[0])/2,(q0[2]+q1[2])/2];parts.white.box(m[0],m[1],yt,yt+.05,sb-sa+.06,.06,yaw);}
 for(const s of [sa,sb]){const q=P(s,0,yt);parts.white.box(q[0],q[2],yt,yt+.05,.06,ehw*2+.06,yaw);}
}

/** A flat ribbon along a 3D polyline (x, y, z): top, underside and both edges. */
function ribbon(bld:Builder,pts:V3[],w:number,t:number){
 for(let i=1;i<pts.length;i++){
  const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dz=b[2]-a[2],l=Math.hypot(dx,dz)||1,nx=-dz/l*w/2,nz=dx/l*w/2;
  const pa=pts[Math.max(0,i-2)],pb=pts[Math.min(pts.length-1,i+1)];
  // Mitre the joints: each end's side vector averages the neighbouring segments'.
  const side=(p:V3,q:V3):[number,number]=>{const ddx=q[0]-p[0],ddz=q[2]-p[2],ll=Math.hypot(ddx,ddz)||1;return [-ddz/ll*w/2,ddx/ll*w/2];};
  const sa=i>1?(([u,v],[p,q])=>[(u+p)/2,(v+q)/2])(side(pa,a),[nx,nz]):[nx,nz],sb=i<pts.length-1?(([u,v],[p,q])=>[(u+p)/2,(v+q)/2])(side(b,pb),[nx,nz]):[nx,nz];
  const L=(p:V3,s:number[],k:number,dy:number):V3=>[p[0]+s[0]*k,p[1]+dy,p[2]+s[1]*k];
  bld.quad(L(a,sa,-1,0),L(b,sb,-1,0),L(b,sb,1,0),L(a,sa,1,0),[0,1,0]);
  bld.quad(L(a,sa,-1,-t),L(b,sb,-1,-t),L(b,sb,1,-t),L(a,sa,1,-t),[0,-1,0]);
  for(const k of [-1,1])bld.quad(L(a,sa,k,-t),L(b,sb,k,-t),L(b,sb,k,0),L(a,sa,k,0),[nx*k,0,nz*k]);
 }
}
/** Smooth a polyline with Catmull-Rom, `n` points per span. */
function smooth(pts:V3[],n=6,closed=false):V3[]{
 const c=new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p)),closed,'centripetal');
 return c.getPoints(pts.length*n).map(v=>[v.x,v.y,v.z]);
}

/** The red ribbons and stair bands, and the white posts that carry them. */
export function campusRibbons(p:CreativeCampusPlan,base:number):{paths:V3[][];posts:V3[]}{
 const C=CAMPUS,bar=(id:string,i=0)=>p.bars.find(b=>b.wing===id&&b.index===i)!;
 const w=bar('west'),e=bar('east'),s0=bar('south'),s1=bar('south',1);
 const at=(b:WingBar,s:number,v:number,y:number):V3=>{const q=along(b,s,v);return [q[0],base+y,q[1]];};
 const paths:V3[][]=[];
 // West: out of the wing's underside on the courtyard side, sweeping down over the lawn to the loop.
 paths.push(smooth([at(w,2.2,-1.2,C.storey*1.9),at(w,3.6,-2.2,1.05),at(w,4.8,-3.6,.65),[p.loopTree[0]+.6,base+.42,p.loopTree[1]-1.35]]));
 // The loop round the courtyard tree, rising from the lawn and back.
 const L=p.loopTree,loop:V3[]=[];for(let k=0;k<=24;k++){const a=k/24*Math.PI*2-Math.PI/2;loop.push([L[0]+Math.cos(a)*1.45,base+.42+.18*Math.sin(a*2),L[1]+Math.sin(a)*1.25]);}
 paths.push(loop);
 // A stair band from the loop down to the south-west lawn.
 paths.push(smooth([[L[0]-1.2,base+.42,L[1]+.8],[L[0]-2,base+.22,L[1]+2.2],[L[0]-2.2,base+.02,L[1]+3.2]],4));
 // East: a ramp from the first floor on the plaza side, curving down onto the stepped plaza.
 paths.push(smooth([at(e,2.4,1.2,C.storey*1.4),at(e,3.4,2.3,.85),at(e,3,3.6,.45),at(e,2,4.4,.12)]));
 // South: a stair band climbing the kinked wing's plaza face, and a balcony band wrapping the atrium drum.
 paths.push(smooth([at(s1,4.2,-1.25,.05),at(s1,3,-1.4,.6),at(s1,1.4,-1.38,1.1),at(s0,3.6,-1.3,1.55)],5));
 const drum:V3[]=[];for(let k=0;k<=18;k++){const a=rad(15+k*7);drum.push([p.cx+Math.cos(a)*(C.atrium.r+.28),base+C.storey*2+.05,p.cz+Math.sin(a)*(C.atrium.r+.28)]);}
 paths.push(drum);
 // Posts every so often under the parts of the ribbons that are off the ground.
 const posts:V3[]=[];for(const path of paths)for(let i=2;i<path.length-1;i+=4){const q=path[i];if(q[1]-base>.3)posts.push(q);}
 return {paths,posts};
}

function lowTree(g:Builder,x:number,z:number,y:number,s:number,leaf:RGB){
 g.box(x,z,y,y+.42*s,.09*s,.09*s,0,K.trunk);
 const ico=new THREE.IcosahedronGeometry(.5*s,0).toNonIndexed(),pos=ico.getAttribute('position');
 for(let i=0;i<pos.count;i+=3){const v=(j:number):V3=>[pos.getX(i+j)+x,pos.getY(i+j)*1.1+y+.75*s,pos.getZ(i+j)+z];g.tri(v(0),v(1),v(2),[0,0],[0,0],[0,0],leaf);}
 ico.dispose();
}

/** Everything on the ground in one coloured mesh: fields, courts, car park, road and bridge, plaza, paths, trees. */
function ground(p:CreativeCampusPlan,base:number,top:number){
 const g=new Builder(true),C=CAMPUS,y=base+.012;
 // Sports: a full pitch with stripes and markings, then the courts.
 for(const c of p.courts){
  const r=c.rect,cx=r.x+r.w/2,cz=r.z+r.d/2,ln=.06;
  const line=(x:number,z:number,w:number,d:number)=>g.box(x,z,y,y+.014,w,d,0,K.line);
  if(c.kind==='pitch'){
   for(let k=0;k<8;k++)g.box(cx,r.z+r.d*(k+.5)/8,base,y,r.w,r.d/8,0,k%2?K.pitch:K.pitchDark);
   const m=.3,x0=r.x+m,x1=r.x+r.w-m,z0=r.z+m,z1=r.z+r.d-m;
   line(cx,z0,x1-x0,ln);line(cx,z1,x1-x0,ln);line(x0,cz,ln,z1-z0);line(x1,cz,ln,z1-z0);line(cx,cz,x1-x0,ln);
   for(let k=0;k<20;k++){const a0=k/20*Math.PI*2,a1=(k+1)/20*Math.PI*2,ra=.9;g.box(cx+Math.cos((a0+a1)/2)*ra,cz+Math.sin((a0+a1)/2)*ra,y,y+.014,ra*.32,ln,-(a0+a1)/2+Math.PI/2,K.line);}
   for(const [zz,sg] of [[z0,1],[z1,-1]] as const){const bw=3.2,bd=1.6;line(cx,zz+sg*bd,bw,ln);line(cx-bw/2,zz+sg*bd/2,ln,bd);line(cx+bw/2,zz+sg*bd/2,ln,bd);
    g.box(cx,zz-sg*.1,y,y+.24,.75,.14,0,K.line);}
  }else{
   const tone=c.kind==='basketball'?K.clay:c.kind==='volleyball'?K.sandCourt:K.court;
   g.box(cx,cz,base,y,r.w+.3,r.d+.3,0,K.paveDark);g.box(cx,cz,y-.004,y+.004,r.w,r.d,0,tone);
   line(cx,r.z,r.w,.04);line(cx,r.z+r.d,r.w,.04);line(r.x,cz,.04,r.d);line(r.x+r.w,cz,.04,r.d);line(cx,cz,.04,r.d);
   if(c.kind==='basketball')for(const x of [r.x+.1,r.x+r.w-.1])g.box(x,cz,y,y+.42,.04,.04,0,K.line);
   else g.box(cx,cz,y,y+.2,.03,r.d+.2,0,K.net);
  }
 }
 // Car park: asphalt, white stalls, and a few parked cars.
 const P=p.parking;g.box(P.x+P.w/2,P.z+P.d/2,base,y,P.w,P.d,0,K.asphalt);
 let car=0;for(let row=0;row<3;row++){const z=P.z+.8+row*2.2;for(let x=P.x+.5;x<P.x+P.w-.4;x+=.62){g.box(x,z,y,y+.015,.03,1.1,0,K.stall);
  if((Math.floor(x*7)+row)%3!==0&&x+.31<P.x+P.w-.3){g.box(x+.31,z,y,y+.16,.32,.72,0,K.cars[car++%K.cars.length]);g.box(x+.31,z+.05,y+.16,y+.25,.27,.4,0,K.cars[(car+2)%K.cars.length]);}}}
 // The road: from the drop-off over the bridge and along the meadow to the city street, kerbed walks either side.
 const R=C.road,b=p.bridge,deck=base+b.deck,rampI=C.bridge.rampIsland,rampC=C.bridge.rampCity;
 const lift=(x:number)=>x>b.x0&&x<b.x1?b.deck:x>b.x0-rampI&&x<=b.x0?b.deck*(x-(b.x0-rampI))/rampI:x>=b.x1&&x<b.x1+rampC?b.deck*(1-(x-b.x1)/rampC):0;
 const xs=[p.road[0][0],b.x0-rampI,b.x0,b.x1,b.x1+rampC,p.cityJoin[0]];
 for(let i=1;i<xs.length;i++){
  const xa=xs[i-1],xb=xs[i],ya=base+lift(xa)+.03,yb=base+lift(xb)+.03,z=b.z,hw=R.width/2;
  const slabTop=(dz0:number,dz1:number,dy:number,k:RGB)=>{g.quad([xa,ya+dy,z+dz0],[xb,yb+dy,z+dz0],[xb,yb+dy,z+dz1],[xa,ya+dy,z+dz1],[0,1,0],undefined,k);
   for(const dz of [dz0,dz1])g.quad([xa,ya-.18,z+dz],[xb,yb-.18,z+dz],[xb,yb+dy,z+dz],[xa,ya+dy,z+dz],[0,0,dz>0?1:-1],undefined,k);};
  slabTop(-hw,hw,0,K.asphalt);slabTop(hw,hw+R.walk,.05,K.kerb);slabTop(-hw-R.walk,-hw,.05,K.kerb);
  // Dashed centre line.
  const n=Math.floor(Math.abs(xb-xa)/.6);for(let k=0;k<n;k++){const t0=(k+.2)/Math.max(1,n),t1=(k+.6)/Math.max(1,n);const x0=xa+(xb-xa)*t0,x1=xa+(xb-xa)*t1,y0=ya+(yb-ya)*t0+.006,y1=ya+(yb-ya)*t1+.006;g.quad([x0,y0,z-.025],[x1,y1,z-.025],[x1,y1,z+.025],[x0,y0,z+.025],[0,1,0],undefined,K.line);}
 }
 // Bridge: railings along both edges of the deck and its ramps, and piers into the water.
 for(const side of [-1,1]){const z=b.z+side*(R.width/2+R.walk-.03);
  for(const [xa,xb] of [[b.x0-rampI,b.x0],[b.x0,b.x1],[b.x1,b.x1+rampC]] as const){const ya=base+lift(xa)+.08,yb=base+lift(xb)+.08;
   g.quad([xa,ya+.32,z-.02],[xb,yb+.32,z-.02],[xb,yb+.36,z+.02],[xa,ya+.36,z+.02],[0,1,0],undefined,K.rail);
   for(let x=xa;x<=xb;x+=.5){const yy=base+lift(x)+.08;g.box(x,z,yy,yy+.34,.04,.04,0,K.rail);}}}
 for(let x=b.x0+.8;x<b.x1;x+=1.6)g.box(x,b.z,-1.6,deck-.2,.32,R.width,0,K.pier);
 g.box((b.x0+b.x1)/2,b.z,deck-.22,deck,b.x1-b.x0,R.width+2*R.walk,0,K.deck);
 // Drop-off turning circle at the plaza end.
 const [dx,dz]=p.road[0];g.box(dx-.6,dz,base,base+.035,1.6,2.2,0,K.asphalt);
 // Stepped plaza: arc steps fanning out from the atrium, highest at the entrance.
 p.plaza.steps.forEach((s,k)=>{const y1=base+p.plaza.top-k*p.plaza.fall,n=Math.max(6,Math.round((s.a1-s.a0)*s.r1/.35));
  const at=(a:number,r:number,yy:number):V3=>[p.cx+Math.cos(a)*r,yy,p.cz+Math.sin(a)*r];
  for(let i=0;i<n;i++){const a0=s.a0+(s.a1-s.a0)*i/n,a1=s.a0+(s.a1-s.a0)*(i+1)/n,am=(a0+a1)/2,tone=k%2?K.step:K.pave;
   g.quad(at(a0,s.r0,y1),at(a1,s.r0,y1),at(a1,s.r1,y1),at(a0,s.r1,y1),[0,1,0],undefined,tone);
   g.quad(at(a0,s.r1,base),at(a1,s.r1,base),at(a1,s.r1,y1),at(a0,s.r1,y1),[Math.cos(am),0,Math.sin(am)],undefined,K.paveDark);}
  for(const a of [s.a0,s.a1])g.quad(at(a,s.r0,base),at(a,s.r1,base),at(a,s.r1,y1),at(a,s.r0,y1),[Math.cos(a+(a===s.a0?-Math.PI/2:Math.PI/2)),0,Math.sin(a+(a===s.a0?-Math.PI/2:Math.PI/2))],undefined,K.paveDark);});
 // Paths.
 for(const path of p.paths)for(let i=1;i<path.length;i++){const a=path[i-1],c=path[i],l=Math.hypot(c[0]-a[0],c[1]-a[1]);g.box((a[0]+c[0])/2,(a[1]+c[1])/2,base,base+.025,l+.5,.5,Math.atan2(c[1]-a[1],c[0]-a[0]),K.pave);}
 // Entrance forecourt in front of the atrium.
 g.box(p.entry[0],p.entry[1],base,base+.03,2.2,2.2,rad(45),K.pave);
 // Trees, with the ribbon loop's tree a size larger.
 p.trees.forEach(([x,z],i)=>lowTree(g,x,z,base,.85+(i%3)*.12,K.leaf[i%K.leaf.length]));
 lowTree(g,p.loopTree[0],p.loopTree[1],base,1.25,K.leaf[0]);
 void top;
 return g;
}

export function campusGeometry(p:CreativeCampusPlan,base:number):CampusGeometry{
 const parts={white:new Builder(),inner:new Builder(),red:new Builder()},rib=new Builder(),atr=new Builder(),trim=new Builder(),outside=new Builder();
 for(const b of p.bars)wing(parts,b,base,trim);
 // Atrium: a clear glass drum with white bands at each floor, a white crown and a low red glass cone.
 const C=CAMPUS,A=C.atrium,n=48;
 for(let k=0;k<n;k++){
  const a0=k/n*Math.PI*2,a1=(k+1)/n*Math.PI*2,am=(a0+a1)/2,P=(a:number,r:number,y:number):V3=>[p.cx+Math.cos(a)*r,y,p.cz+Math.sin(a)*r];
  atr.quad(P(a0,A.r,base),P(a1,A.r,base),P(a1,A.r,base+A.h),P(a0,A.r,base+A.h),[Math.cos(am),0,Math.sin(am)],[[a0*A.r,0],[a1*A.r,0],[a1*A.r,A.h],[a0*A.r,A.h]]);
  for(let f=1;f<=Math.floor(A.h/C.storey);f++){const y=base+f*C.storey;parts.white.quad(P(a0,A.r+.04,y-.03),P(a1,A.r+.04,y-.03),P(a1,A.r+.04,y+.03),P(a0,A.r+.04,y+.03),[Math.cos(am),0,Math.sin(am)]);}
  const yc=base+A.h;parts.white.quad(P(a0,A.r-.12,yc+.1),P(a1,A.r-.12,yc+.1),P(a1,A.r+.12,yc+.1),P(a0,A.r+.12,yc+.1),[0,1,0]);
  parts.white.quad(P(a0,A.r+.12,yc-.02),P(a1,A.r+.12,yc-.02),P(a1,A.r+.12,yc+.1),P(a0,A.r+.12,yc+.1),[Math.cos(am),0,Math.sin(am)]);
  // Triangulated glass skylight on top, with red ribs every few panels.
  // Its UVs pick the drum map's clear upper glass, so the skylight reads as glass, not a wall.
  const g:UV=[.25,C.storey*.82];atr.tri(P(a0,A.r-.1,yc+.1),[p.cx,yc+.1+A.cone,p.cz],P(a1,A.r-.1,yc+.1),g,g,g);
  if(k%6===0){const q=P(a0,A.r-.1,yc+.1);ribbon(trim,[[q[0],q[1]+.03,q[2]],[p.cx,yc+.13+A.cone,p.cz]],.07,.04);}
 }
 // Ribbons and their posts.
 const r=campusRibbons(p,base);
 r.paths.forEach((path,i)=>{
  const drum=i===r.paths.length-1;ribbon(drum?trim:rib,path,.46,.08);if(drum)return;
  // Interior view out: keep only the runs clear of the building, so no ribbon passes through a room.
  let run:V3[]=[];for(const q of [...path,null]){if(q&&!inBuilding(p,[q[0],q[2]],.15)&&Math.hypot(q[0]-p.cx,q[2]-p.cz)>C.atrium.r+.3){run.push(q);continue;}if(run.length>1)ribbon(outside,run,.46,.08);run=[];}
 });
 for(const q of r.posts)parts.white.box(q[0],q[2],base,q[1]-.07,.07,.07);
 const g=ground(p,base,base);
 const out={white:parts.white.build(),inner:parts.inner.build(),red:parts.red.build(),ribbon:rib.build(),atrium:atr.build(),ground:g.build(),trim:trim.build(),ribbonOutside:outside.build()};
 const triangles=parts.white.triangles+parts.inner.triangles+parts.red.triangles+rib.triangles+atr.triangles+g.triangles+trim.triangles;
 return {...out,triangles};
}

/** The building's outline on the ground (wing bars and drum), for a soft contact shadow and tests. */
export function campusOutline(p:CreativeCampusPlan):Pt[][]{return p.bars.map(b=>barCorners(b));}
