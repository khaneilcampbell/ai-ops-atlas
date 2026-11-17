import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {Pt3} from './atlasHqPlan';
import {superellipse} from './atlasHqPlan';
import {bands,compact,fins,lid,skin} from './atlasHqGeometry';
import {CC,ccBay,ccLedges,ccOutline,ccRoof,ccRoofGarden} from './commandCenterPlan';

/**
 * Atlas Command Center geometry, built once into a few merged meshes grouped by material: green
 * glass for the office floors, warm glass for the lobby, cream stone (ledges, pilasters, parapet,
 * entrance bay), one brass line over the lobby, the roof and its lawn.
 */

/** A parapet wall round an outline: outer face, inner face and the coping on top. */
function parapet(pts:Pt3[],y:number,h:number,t:number){
 const pos:number[]=[],n=pts.length,c=pts.reduce((s,p)=>[s[0]+p[0]/n,s[1]+p[2]/n],[0,0]);
 const inner=(p:Pt3):Pt3=>{const dx=p[0]-c[0],dz=p[2]-c[1],l=Math.hypot(dx,dz)||1;return [p[0]-dx/l*t,y,p[2]-dz/l*t];};
 const q=(a:Pt3,b:Pt3,cc:Pt3,d:Pt3)=>pos.push(...a,...b,...cc,...a,...cc,...d);
 const up=(p:Pt3):Pt3=>[p[0],p[1]+h,p[2]];
 for(let i=0;i<n;i++){
  const a:Pt3=[pts[i][0],y,pts[i][2]],b:Pt3=[pts[(i+1)%n][0],y,pts[(i+1)%n][2]],ai=inner(a),bi=inner(b);
  q(a,b,up(b),up(a));q(bi,ai,up(ai),up(bi));q(up(a),up(b),up(bi),up(ai));
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(new Array(pos.length/3*2).fill(0),2));
 g.computeVertexNormals();return g;
}
function box(x:number,y:number,z:number,w:number,h:number,d:number){
 const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y+h/2,z);return g;
}

export function ccGeometry(k=1){
 const out=ccOutline(k),roof=ccRoof(k),lobby=CC.lobby*k;
 const ring=(y:number):Pt3[]=>out.map(([x,z])=>[x,y,z]);
 // Each point carries the roof height as y, so bands() keeps every ledge below the roof.
 const tall=()=>ring(roof);
 const ledges=ccLedges(k).slice(0,-1),bay=ccBay(k),garden=ccRoofGarden(k);
 const lawn=lid(superellipse(CC.cx*k,CC.cz*k,(CC.a-.08)*k,(CC.b-.08)*k,CC.roundness,CC.ring).map(([x,z])=>[x,garden.y+.012*k,z] as Pt3));
 return compact({
  // Office floors: the storey grid starts on the lobby's top, so spandrels meet the stone ledges.
  glass:skin([ring(lobby),ring(roof)],CC.storey*k,lobby),
  // Lobby: one tall pane per bay, no spandrel (its v runs only over the glass part of one tile row).
  lobby:skin([ring(0),ring(lobby)],lobby*1.25,0),
  stone:mergeGeometries([
   bands(tall,ledges,CC.ledgeDepth*k,CC.ledgeHeight*k),
   fins([ring(0),ring(roof)],CC.pierEvery,CC.pierDepth*k),
   parapet(ring(roof),roof,CC.parapet*k,.03*k),
   box(bay.x,0,bay.z,bay.w,bay.h,bay.d),
   // A thin coping cap on the bay, a little proud of it.
   box(bay.x,bay.h,bay.z,bay.w+.03*k,CC.coping*k,bay.d+.03*k),
  ])!,
  // Restrained brass: one hairline round the building at the lobby's head, under its stone ledge.
  brass:bands(tall,[lobby-.014*k],.02*k,.008*k),
  roof:lid(ring(roof+.004*k)),
  lawn,
  trees:garden.trees.map(([x,z])=>({x,z,y:garden.y})),
 });
}
export type CcGeometry=ReturnType<typeof ccGeometry>;
export const ccTriangles=(h:CcGeometry)=>Object.values(h).reduce((n,v)=>n+(v instanceof THREE.BufferGeometry?(v.index?v.index.count:v.getAttribute('position').count)/3:0),0);
