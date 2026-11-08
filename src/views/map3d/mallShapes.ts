import * as THREE from 'three';
import type {Pt} from './roads';

/** A flat ribbon between two edges, extruded up by h from y. */
export function ribbon(outer:Pt[],inner:Pt[],y:number,h:number){
 const shape=new THREE.Shape();
 shape.moveTo(outer[0][0],outer[0][1]);for(const [x,z] of outer.slice(1))shape.lineTo(x,z);
 for(const [x,z] of [...inner].reverse())shape.lineTo(x,z);shape.closePath();
 const geo=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,curveSegments:1});
 // Shape y becomes world z; the extrusion then runs downward, so lift it by h.
 geo.rotateX(Math.PI/2);geo.translate(0,y+h,0);
 return geo;
}
/** Pull an edge toward its partner, so glazing sits back behind the fins. */
export const inset=(a:Pt[],b:Pt[],k:number):Pt[]=>a.map(([x,z],i)=>[x+(b[i][0]-x)*k,z+(b[i][1]-z)*k]);

