import * as THREE from 'three';

/**
 * The city's walking people as little figures with arms and legs, like the agents at their desks (Khaneil, 2026-11-13:
 * "people running loops give them arms and legs like the agents"). Sizes in map units, feet at the figure's ground point:
 * legs from the ground to the hips, the torso above, arms hanging from the shoulders, the head on top. Every part is the
 * shared lifted unit box (base at 0) or the bead sphere, so the crowd stays four instanced meshes plus heads.
 */
export const FIGURE={leg:{h:.075,w:.026,d:.03,x:.017},torso:{y:.075,h:.09,w:.07,d:.055},arm:{h:.075,w:.022,d:.026,x:.047,y:.158},head:{y:.2,r:.034},
 /** Swing at full stride (radians): legs, and arms the other way. */
 legSwing:.5,armSwing:.42,
 /** Map units walked per half stride (one leg forward). */
 step:.16} as const;

/** One figure's walking state: where it was last frame, how far through its stride, and how much it is swinging. */
export interface Gait {x:number;z:number;phase:number;amp:number;seen:boolean}
export const newGait=():Gait=>({x:0,z:0,phase:0,amp:0,seen:false});

/**
 * Advance a figure's stride by how far it moved since the last frame: legs and arms swing while it walks and settle
 * when it stands. Returns the swing angle (radians, legs forward positive). A figure that was hidden starts still.
 */
export function stepGait(g:Gait,x:number,z:number,dt:number){
 const moved=g.seen?Math.hypot(x-g.x,z-g.z):0;g.x=x;g.z=z;g.seen=true;
 // A jump (re-appearing elsewhere) is not a walk.
 const walk=moved<.5?moved:0,target=dt>0&&walk/dt>.05?1:0,blend=Math.min(1,dt*6);
 g.amp+=(target-g.amp)*blend;g.phase=(g.phase+walk/FIGURE.step*Math.PI)%(2*Math.PI);
 return Math.sin(g.phase)*g.amp;
}
export function hideGait(g:Gait){g.seen=false;g.amp=0;}

const turn=new THREE.Euler(0,0,0,'YXZ'),q=new THREE.Quaternion(),v=new THREE.Vector3(),s=new THREE.Vector3();
/** A part hanging from a pivot at local (px, py) that swings `angle` about the figure's side axis, length h. */
function hang(out:THREE.Matrix4,x:number,y:number,z:number,yaw:number,px:number,py:number,angle:number,w:number,h:number,d:number){
 // The lifted box grows up from its base, so put the base at the swung foot (or hand) and tilt it back to the pivot.
 turn.set(angle,yaw,0);q.setFromEuler(turn);
 v.set(px,py-h*Math.cos(angle),-h*Math.sin(angle)).applyAxisAngle(Y,yaw);
 return out.compose(s.set(x,y,z).add(v),q,v.set(w,h,d));
}
const Y=new THREE.Vector3(0,1,0);

/** The six parts of a figure standing at (x, y, z) facing `yaw`, legs swung by `swing`: torso, head, two legs, two arms. */
export function figureParts(x:number,y:number,z:number,yaw:number,swing:number,out:{torso:THREE.Matrix4;head:THREE.Matrix4;legs:[THREE.Matrix4,THREE.Matrix4];arms:[THREE.Matrix4,THREE.Matrix4]}){
 const {leg,torso,arm,head}=FIGURE;
 turn.set(0,yaw,0);q.setFromEuler(turn);
 out.torso.compose(v.set(x,y+torso.y,z),q,s.set(torso.w,torso.h,torso.d));
 out.head.compose(v.set(x,y+head.y,z),q,s.setScalar(head.r));
 for(const [k,side] of [[0,-1],[1,1]] as const){
  hang(out.legs[k],x,y,z,yaw,side*leg.x,leg.h,swing*FIGURE.legSwing*side,leg.w,leg.h,leg.d);
  hang(out.arms[k],x,y,z,yaw,side*arm.x,arm.y,-swing*FIGURE.armSwing*side,arm.w,arm.h,arm.d);
 }
 return out;
}
