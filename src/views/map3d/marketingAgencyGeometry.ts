import * as THREE from 'three';
import {AGENCY,agencyRoof,archSpan,archTop,cutAt,sweepSpan,sweepTop} from './marketingAgencyPlan';

/**
 * Benjaire Marketing Agency shell, built once as plain triangle lists and merged per material:
 * the cream screen (one texture carries the diamond perforations and their night glow), the
 * copper frames and reveals, and the bronze glass. Local x runs east along the long side, local z
 * south toward the plaza, y up from the plinth.
 */
type V3=[number,number,number];
type UV=[number,number];
class Builder{
 pos:number[]=[];uv:number[]=[];
 tri(a:V3,b:V3,c:V3,ua:UV=[0,0],ub:UV=[0,0],uc:UV=[0,0]){this.pos.push(...a,...b,...c);this.uv.push(...ua,...ub,...uc);}
 /** A quad a-b-c-d, wound so its face points along `out`. */
 quad(a:V3,b:V3,c:V3,d:V3,out:V3,uv?:[UV,UV,UV,UV]){
  const u=uv??[[0,0],[0,0],[0,0],[0,0]];
  const e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],e2=[d[0]-a[0],d[1]-a[1],d[2]-a[2]];
  const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
  if(n[0]*out[0]+n[1]*out[1]+n[2]*out[2]>=0){this.tri(a,b,c,u[0],u[1],u[2]);this.tri(a,c,d,u[0],u[2],u[3]);}
  else{this.tri(a,c,b,u[0],u[2],u[1]);this.tri(a,d,c,u[0],u[3],u[2]);}
 }
 build(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));g.computeVertexNormals();return g;}
}

/** Height used to normalise the screen texture's v coordinate. */
const SCREEN_H=4;
/** Screen texture u: the density fade follows the long side; the end walls take one slice each. */
const screenU=(lx:number)=>SCREEN_LONG[0]+(SCREEN_LONG[1]-SCREEN_LONG[0])*lx/AGENCY.length;
/** Texture regions (u): the west end wall, the long faces with the fade, and a plain strip for roofs. */
export const SCREEN_WEST=[0,.3] as const,SCREEN_LONG=[.3,.9] as const,SCREEN_PLAIN=.975;

export interface AgencyGeometry{shell:THREE.BufferGeometry;copper:THREE.BufferGeometry;glass:THREE.BufferGeometry;triangles:number}

/** A wall from p to q (plan points), bottom 0, top given per end, facing `out`. */
function wall(b:Builder,p:[number,number],q:[number,number],hp:number,hq:number,out:V3,u:(t:number)=>number,from=0){
 b.quad([p[0],from,p[1]],[q[0],from,q[1]],[q[0],hq,q[1]],[p[0],hp,p[1]],out,[[u(0),from/SCREEN_H],[u(1),from/SCREEN_H],[u(1),hq/SCREEN_H],[u(0),hp/SCREEN_H]]);
}

/**
 * A flat wall with a curved opening at its foot. along(u) gives the plan point at distance u,
 * top(u) the wall top, open(u) the opening's height (0 outside it). The opening is glazed a
 * little inside the wall, lined with a copper reveal and edged with a raised copper frame.
 */
function openingWall(parts:{shell:Builder;copper:Builder;glass:Builder},len:number,along:(u:number)=>[number,number],out:V3,top:(u:number)=>number,open:(u:number)=>number,span:readonly [number,number],screen:(u:number)=>number){
 const steps=48,us=new Set<number>();
 for(let i=0;i<=steps;i++)us.add(len*i/steps);
 for(let i=0;i<=64;i++)us.add(span[0]+(span[1]-span[0])*i/64);
 const list=[...us].sort((a,b)=>a-b),inset=AGENCY.inset,f=AGENCY.frame,lift=.025;
 const at=(u:number,y:number,depth=0):V3=>{const [x,z]=along(u);return [x-out[0]*depth,y,z-out[2]*depth];};
 const inside=(u:number)=>u>span[0]-1e-6&&u<span[1]+1e-6;
 for(let i=1;i<list.length;i++){
  const ua=list[i-1],ub=list[i],mid=(ua+ub)/2,ca=inside(mid)?open(ua):0,cb=inside(mid)?open(ub):0;
  parts.shell.quad(at(ua,ca),at(ub,cb),at(ub,top(ub)),at(ua,top(ua)),out,[[screen(ua),ca/SCREEN_H],[screen(ub),cb/SCREEN_H],[screen(ub),top(ub)/SCREEN_H],[screen(ua),top(ua)/SCREEN_H]]);
  if(!inside(mid))continue;
  // Glass set back in the opening; uv in world units so the mullion grid keeps its size.
  parts.glass.quad(at(ua,0,inset),at(ub,0,inset),at(ub,cb,inset),at(ua,ca,inset),out,[[ua,0],[ub,0],[ub,cb],[ua,ca]]);
  // Raised frame band on the face, following the curve's normal in the wall plane.
  const n=(u:number)=>{const e=.02,u1=Math.min(span[1],u+e),u0=Math.max(span[0],u-e),s=open(u1)-open(u0),l=Math.hypot(u1-u0,s)||1;return [-s/l,(u1-u0)/l] as const;};
  const na=n(ua),nb=n(ub),[tx,tz]=(()=>{const p0=along(ua),p1=along(ub),l=Math.hypot(p1[0]-p0[0],p1[1]-p0[1])||1;return [(p1[0]-p0[0])/l,(p1[1]-p0[1])/l];})();
  // Copper reveal: the soffit from the wall face back to the glass, facing down into the opening.
  const nm=[(na[0]+nb[0])/2,(na[1]+nb[1])/2];
  parts.copper.quad(at(ua,ca),at(ub,cb),at(ub,cb,inset),at(ua,ca,inset),[-nm[0]*tx,-nm[1],-nm[0]*tz]);
  const fa=(u:number,c:number,nn:readonly [number,number],k:number):V3=>{const [x,z]=along(u+nn[0]*k);return [x+out[0]*lift,c+nn[1]*k,z+out[2]*lift];};
  parts.copper.quad(fa(ua,ca,na,0),fa(ub,cb,nb,0),fa(ub,cb,nb,f),fa(ua,ca,na,f),out);
 }
 // Jambs at the opening's feet, where the frame meets the plaza.
 for(const u of span){const [x,z]=along(u),d=u===span[0]?-1:1,[dx,dz]=[along(u+d*.01)[0]-x,along(u+d*.01)[1]-z],l=Math.hypot(dx,dz)||1;
  parts.copper.quad([x,0,z],[x-out[0]*inset,0,z-out[2]*inset],[x-out[0]*inset,.3,z-out[2]*inset],[x,.3,z],[dx/l*-d,0,dz/l*-d]);}
}

export function agencyGeometry():AgencyGeometry{
 const shell=new Builder(),copper=new Builder(),glass=new Builder(),parts={shell,copper,glass};
 const L=AGENCY.length,D=AGENCY.depth,cw=AGENCY.cutW/2,cN=cutAt(0),cS=cutAt(D),eastStart=cS+cw;
 const hW=AGENCY.westH,roof=(x:number)=>agencyRoof(x,eastStart);
 // West block: plain walls carrying the densest screen.
 const wA:[number,number]=[0,0],wB:[number,number]=[cN-cw,0],wC:[number,number]=[cS-cw,D],wD:[number,number]=[0,D];
 wall(shell,wA,wB,hW,hW,[0,0,-1],t=>screenU(wA[0]+(wB[0]-wA[0])*t));
 wall(shell,wD,wC,hW,hW,[0,0,1],t=>screenU(wD[0]+(wC[0]-wD[0])*t));
 wall(shell,wA,wD,hW,hW,[-1,0,0],t=>SCREEN_WEST[0]+(SCREEN_WEST[1]-SCREEN_WEST[0])*t);
 const cutNormal=(s:number):V3=>{const dx=wC[0]-wB[0],l=Math.hypot(dx,D);return [s*D/l,0,-s*dx/l];};
 // Inside the slot the walls are plain, so the cut reads as one clean gash.
 wall(shell,wB,wC,hW,hW,cutNormal(1),()=>SCREEN_PLAIN);
 shell.quad([wA[0],hW,wA[1]],[wB[0],hW,wB[1]],[wC[0],hW,wC[1]],[wD[0],hW,wD[1]],[0,1,0],[[SCREEN_PLAIN,.02],[SCREEN_PLAIN,.02],[SCREEN_PLAIN,.02],[SCREEN_PLAIN,.02]]);
 // East block: the roof rises toward the river corner.
 const eE:[number,number]=[cN+cw,0],eF:[number,number]=[L,0],eH:[number,number]=[cS+cw,D];
 wall(shell,eE,eF,roof(eE[0]),roof(L),[0,0,-1],t=>screenU(eE[0]+(L-eE[0])*t));
 wall(shell,eH,eE,roof(eH[0]),roof(eE[0]),cutNormal(-1),()=>SCREEN_PLAIN);
 shell.quad([eE[0],roof(eE[0]),0],[L,roof(L),0],[L,roof(L),D],[eH[0],roof(eH[0]),D],[0,1,0],[[SCREEN_PLAIN,.02],[SCREEN_PLAIN,.02],[SCREEN_PLAIN,.02],[SCREEN_PLAIN,.02]]);
 // South face: the copper sweep over the entrance.
 openingWall(parts,L-eH[0],u=>[eH[0]+u,D],[0,0,1],u=>roof(eH[0]+u),u=>sweepTop(eH[0]+u),[sweepSpan()[0]-eH[0],sweepSpan()[1]-eH[0]],u=>screenU(eH[0]+u));
 // East face: a pointed arch toward the river and the BMW showroom.
 const [a0,a1]=archSpan();
 openingWall(parts,D,u=>[L,D-u],[1,0,0],()=>roof(L),u=>archTop(D-u),[D-a1,D-a0],()=>SCREEN_PLAIN);
 // The diagonal slot: bronze glass between the blocks, set back from both long faces, glass roof.
 const h=AGENCY.cutH,i=AGENCY.inset,x0n=cutAt(i)-cw,x1n=cutAt(i)+cw,x0s=cutAt(D-i)-cw,x1s=cutAt(D-i)+cw;
 glass.quad([x0n,0,i],[x1n,0,i],[x1n,h,i],[x0n,h,i],[0,0,-1],[[0,0],[cw*2,0],[cw*2,h],[0,h]]);
 glass.quad([x0s,0,D-i],[x1s,0,D-i],[x1s,h,D-i],[x0s,h,D-i],[0,0,1],[[0,0],[cw*2,0],[cw*2,h],[0,h]]);
 glass.quad([x0n,h,i],[x1n,h,i],[x1s,h,D-i],[x0s,h,D-i],[0,1,0],[[0,0],[cw*2,0],[cw*2,D],[0,D]]);
 // Copper lining the slot's mouths, so the cut reads as one continuous gash.
 for(const [zf,zg,s] of [[0,i,-1],[D,D-i,1]] as const){
  const xa=cutAt(zf)-cw,xb=cutAt(zf)+cw,ya=Math.min(hW,h+.02);
  copper.quad([xa,ya,zf],[xb,ya,zf],[cutAt(zg)+cw,ya,zg],[cutAt(zg)-cw,ya,zg],[0,-1,0]);
  copper.quad([xa,0,zf],[xa,ya,zf],[cutAt(zg)-cw,ya,zg],[cutAt(zg)-cw,0,zg],[1,0,0]);
  copper.quad([xb,0,zf],[xb,ya,zf],[cutAt(zg)+cw,ya,zg],[cutAt(zg)+cw,0,zg],[-1,0,0]);
  void s;
 }
 const out={shell:shell.build(),copper:copper.build(),glass:glass.build(),triangles:0};
 out.triangles=(shell.pos.length+copper.pos.length+glass.pos.length)/9;
 return out;
}
