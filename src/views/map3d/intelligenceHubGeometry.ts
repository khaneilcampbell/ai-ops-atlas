import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {INTELLIGENCE_HUB,faces,offsetPolygon,type IntelligenceHubPlan,type Pt} from './intelligenceHubPlan';
import {compactGeometry} from './atlasHqGeometry';

/** The Intelligence Hub's static meshes, merged by material so the whole building is a few draw calls. */

const merge=(gs:THREE.BufferGeometry[],uv=true)=>{
 const parts=gs.map(g=>{const n=g.index?g.toNonIndexed():g;n.clearGroups();if(!uv)n.deleteAttribute('uv');return n;});
 const m=parts.length?mergeGeometries(parts):new THREE.BufferGeometry();
 if(!m)throw new Error('Intelligence Hub: parts could not be merged');
 for(const g of [...gs,...parts])if(g!==m)g.dispose();
 return compactGeometry(m);
};

/** A plan polygon as a shape (x, -z) with every corner rounded by r. */
function planShape(poly:Pt[],r:number,shape:THREE.Shape|THREE.Path=new THREE.Shape()){
 const n=poly.length,cut=(v:Pt,to:Pt):Pt=>{const d=Math.hypot(to[0]-v[0],to[1]-v[1]),t=Math.min(r,d*.45)/d;return [v[0]+(to[0]-v[0])*t,v[1]+(to[1]-v[1])*t];};
 for(let i=0;i<n;i++){
  const v=poly[i],p=poly[(i-1+n)%n],q=poly[(i+1)%n],a=cut(v,p),b=cut(v,q);
  if(i===0)shape.moveTo(a[0],-a[1]);else shape.lineTo(a[0],-a[1]);
  shape.quadraticCurveTo(v[0],-v[1],b[0],-b[1]);
 }
 shape.closePath();
 return shape;
}

/** Extrude a plan polygon from y0 to y1, optionally with a hole (a ring, for parapets). */
function extrudePlan(poly:Pt[],y0:number,y1:number,r:number,hole?:{poly:Pt[];r:number}){
 const s=planShape(poly,r) as THREE.Shape;
 if(hole)s.holes.push(planShape(hole.poly,hole.r,new THREE.Path()) as THREE.Path);
 const g=new THREE.ExtrudeGeometry(s,{depth:y1-y0,bevelEnabled:false,curveSegments:3});
 g.rotateX(-Math.PI/2);g.translate(0,y0,0);
 return g;
}

function roundedRect(x0:number,y0:number,x1:number,y1:number,r:number,path:THREE.Shape|THREE.Path=new THREE.Shape()){
 path.moveTo(x0+r,y0);path.lineTo(x1-r,y0);path.quadraticCurveTo(x1,y0,x1,y0+r);path.lineTo(x1,y1-r);path.quadraticCurveTo(x1,y1,x1-r,y1);
 path.lineTo(x0+r,y1);path.quadraticCurveTo(x0,y1,x0,y1-r);path.lineTo(x0,y0+r);path.quadraticCurveTo(x0,y0,x0+r,y0);
 return path;
}

/** A rounded-rectangle frame w x h with walls t thick, extruded `depth` out of a wall (local +z). */
function ring(w:number,h:number,t:number,r:number,depth:number){
 const s=roundedRect(-w/2,-h/2,w/2,h/2,r) as THREE.Shape;
 s.holes.push(roundedRect(-w/2+t,-h/2+t,w/2-t,h/2-t,Math.max(.004,r-t*.6),new THREE.Path()) as THREE.Path);
 return new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:3});
}

/**
 * A flat rounded-rectangle frame, facing local +z: a window's black surround, standing just off
 * the fins. Flat rather than extruded, because a hundred extruded frames cost a megabyte.
 */
function flatRing(w:number,h:number,t:number,r:number){
 const s=roundedRect(-w/2,-h/2,w/2,h/2,r) as THREE.Shape;
 s.holes.push(roundedRect(-w/2+t,-h/2+t,w/2-t,h/2-t,Math.max(.004,r-t*.6),new THREE.Path()) as THREE.Path);
 return new THREE.ShapeGeometry(s,2);
}

const box=(w:number,h:number,d:number,x=0,y=0,z=0)=>{const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);return g;};

/** Place a part built facing local +z on a wall: rotated to face `angle`, at x, y, z. */
function place(g:THREE.BufferGeometry,x:number,y:number,z:number,angle:number){
 g.rotateY(angle);g.translate(x,y,z);return g;
}

/** A window's size, as the key its frame geometry is shared under. */
export const windowKey=(w:{w:number;y0:number;y1:number})=>`${w.w.toFixed(4)}x${(w.y1-w.y0).toFixed(4)}`;

/**
 * Merged meshes for the parts drawn once, and one shared geometry for each part that repeats
 * floor after floor (the bands, the loggia frame, each window size), which the renderer instances:
 * a hundred and fifty windows cost one small geometry and their instance matrices.
 */
export interface IntelligenceHubGeometry {
 cladding:THREE.BufferGeometry;trim:THREE.BufferGeometry;stone:THREE.BufferGeometry;
 shopfront:THREE.BufferGeometry;garden:THREE.BufferGeometry;
 /** One floor band, centred on y=0: under the rear wing's roof, and above it. */
 bandFull:THREE.BufferGeometry;bandFront:THREE.BufferGeometry;
 /** The loggia frame, centred on the bay, extruded out along +z. */
 bayRing:THREE.BufferGeometry;
 /** A flat window surround per window size (windowKey), centred, facing +z. */
 windowRings:Record<string,THREE.BufferGeometry>;
}

export function intelligenceHubGeometry(p:IntelligenceHubPlan):IntelligenceHubGeometry{
 const I=INTELLIGENCE_HUB,k=p.k,r=I.radius*k;
 const cladding:THREE.BufferGeometry[]=[],trim:THREE.BufferGeometry[]=[],stone:THREE.BufferGeometry[]=[],shopfront:THREE.BufferGeometry[]=[],garden:THREE.BufferGeometry[]=[];
 const step=p.lines[p.storeys-I.rear.drop],rearPoly:Pt[]=[[-.5*k,-.5*k],[.5*k,-.5*k],[.5*k,I.rear.from*k],[-.5*k,I.rear.from*k]];
 const inset=(poly:Pt[],d:number)=>offsetPolygon(poly,poly.map(()=>-d));

 // Ground floor: dark glass shopfronts set back under the soffit, stone piers at the corners.
 const groundPoly=inset(p.outline,I.ground.inset*k),soffitY=p.ground-I.soffit.h;
 shopfront.push(extrudePlan(groundPoly,0,soffitY,r*.7));
 for(const f of faces(groundPoly)){
  // A white stone pier at each end of every face, the way the reference frames its glass.
  for(const s of [.06,.94]){
   const x=f.a[0]+(f.b[0]-f.a[0])*s,z=f.a[1]+(f.b[1]-f.a[1])*s;
   stone.push(place(box(.07*k,soffitY,.03*k,0,soffitY/2,0),x,0,z,Math.atan2(f.n[0],f.n[1])));
  }
 }
 // The corner entrance: a stone panel with a big rounded black outline, as in the reference.
 const corner=faces(groundPoly)[2],ca=Math.atan2(corner.n[0],corner.n[1]),cx=(corner.a[0]+corner.b[0])/2,cz=(corner.a[1]+corner.b[1])/2;
 stone.push(place(box(corner.len*.62,soffitY,.035*k,0,soffitY/2,.012*k),cx,0,cz,ca));
 trim.push(place(flatRing(corner.len*.5,soffitY*.86,.012,.09*k).translate(0,soffitY*.45,.031*k),cx,0,cz,ca));

 // The soffit slab the upper floors stand on: rounded, swelling a little past the faces.
 const out=I.soffit.out*k;
 stone.push(extrudePlan(offsetPolygon(p.outline,p.outline.map(()=>out)),soffitY,p.ground+.004,r+out));

 // Upper floors: white fins up to the rear wing's roof, then the front block to the main roof.
 cladding.push(extrudePlan(p.outline,p.ground,step,r));
 const front=p.front,wall=.035*k;
 cladding.push(extrudePlan(front,step,p.roof,r));
 cladding.push(extrudePlan(front,p.roof,p.roof+.09,r,{poly:inset(front,wall),r:r*.5}));
 // Rear wing: a roof slab, a low parapet and a planted roof.
 cladding.push(extrudePlan(rearPoly,step,step+.04,0));
 const rearInner:Pt[]=[[-.5*k+wall,-.5*k+wall],[.5*k-wall,-.5*k+wall],[.5*k-wall,I.rear.from*k],[-.5*k+wall,I.rear.from*k]];
 cladding.push(extrudePlan(rearPoly,step+.04,p.rearTop,0,{poly:rearInner,r:0}));
 garden.push(extrudePlan(rearInner,step+.04,step+.07,0));
 garden.push(extrudePlan(inset(front,wall),p.roof,p.roof+.03,r*.5));

 // Copings on the parapets, in the bands' black.
 const o=I.band.out*k,oc=I.band.corner*k,h=I.band.h;
 trim.push(extrudePlan(offsetPolygon(front,front.map(()=>o*.5)),p.roof+.09,p.roof+.11,r+o*.5,{poly:inset(front,wall),r:r*.5}));
 trim.push(extrudePlan(rearPoly.map(([x,z])=>[x+Math.sign(x)*o*.5,z<0?z-o*.5:z] as Pt),p.rearTop,p.rearTop+.02,0,{poly:rearInner,r:0}));
 // Lit strip under the soffit, like the reference's downlights along the overhang.
 trim.push(extrudePlan(offsetPolygon(groundPoly,groundPoly.map(()=>.004*k)),soffitY-.012,soffitY,r*.7));

 // Black reveal bands, swelling out on the corner face: the wavy lines (instanced at each floor line).
 const band=(poly:Pt[])=>compactGeometry(extrudePlan(offsetPolygon(poly,[o,o,oc,o,o]),-h/2,h/2,r+o).toNonIndexed().deleteAttribute('uv'));
 // Corner loggia frame: deep, rounded, the same for every floor.
 const B=I.bay,bt=B.frame*k*.6,b0=p.bays[0];
 const bayRing=compactGeometry(ring(b0.w,b0.y1-b0.y0,bt,B.radius*k,B.depth*k).translate(0,0,-.004).toNonIndexed().deleteAttribute('uv'));
 const windowRings:Record<string,THREE.BufferGeometry>={};
 for(const w of p.windows){
  const key=windowKey(w);if(windowRings[key])continue;
  const wh=w.y1-w.y0;
  windowRings[key]=compactGeometry(flatRing(w.w,wh,I.windows.frame,Math.min(w.w,wh)*.22).deleteAttribute('uv'));
 }
 return {cladding:merge(cladding),trim:merge(trim,false),stone:merge(stone,false),shopfront:merge(shopfront),garden:merge(garden,false),bandFull:band(p.outline),bandFront:band(front),bayRing,windowRings};
}

/** Every geometry in a built Intelligence Hub, to dispose of or measure. */
export const allGeometries=(g:IntelligenceHubGeometry)=>[g.cladding,g.trim,g.stone,g.shopfront,g.garden,g.bandFull,g.bandFront,g.bayRing,...Object.values(g.windowRings)];
