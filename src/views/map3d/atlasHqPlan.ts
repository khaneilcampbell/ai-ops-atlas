import type {Pt} from './roads';

/**
 * Atlas Command Center (Atlas HQ), the map's centerpiece: a corporate headquarters with a lobby and
 * four office floors, drawn from the same floor plate as its interior (Khaneil, 2026-11-17: "one
 * coherent corporate headquarters" from the city through the entrance to the floors). A rounded
 * rectangle of glass with a forest-green spandrel at every floor, cream stone slabs, a stone lift
 * core rising through the roof at the back, brass trim, and an entrance canopy on the +z front.
 *
 * Plain numbers only (no three.js), in coordinates local to the building: x across the front, z
 * toward the viewer (+z is the entrance side), y up from the floor base. Everything scales with the
 * footprint `size`; the interior plate scales down by `plateScale` to the exterior.
 */
export const HQ = {
 /** The old landmark's footprint; the plan below fits inside it, so the plaza and roads stay put. */
 refSize:1.734,
 /**
  * The interior floor plate (office units, src/views/office/atlasHqInteriorPlan.ts): curtain-wall half
  * axes for the current Atlas plan, its squareness, mullion count, level spacing and level count.
  */
 plate:{a:5.93,b:10.2,roundness:5,points:64,level:3.4,levels:5},
 /** Half-depth of the exterior over the reference footprint, leaving room for the canopy. */
 depth:.4,
 /** Green panels stand on every `panelEvery`-th mullion, outside and inside. */
 panelEvery:8,
 panelDepth:.022,
 /** Cream stone slab edge at every floor. */
 bandDepth:.02,
 bandHeight:.03,
 /** Lift core: width and depth in plate units, and how far it rises above the roof. */
 core:{w:3.4,d:2.2,rise:.32},
 /** Glass texture tiles 4 bays by 4 floors; floor and bay come from the plate. */
 bay:.085,
 floor:.26,
 trees:4,
} as const;

/** Shared palette, so the outside and the floors inside are built from the same materials. */
export const HQ_COLORS={stone:'#e6dcc6',green:'#2f4a3b',brass:'#c9a66b',glass:'#cfe3e6',mullion:'#eef1f2'} as const;

export type Pt3=[number,number,number];

/** A rounded rectangle (superellipse), counter-clockwise seen from above. */
export function superellipse(cx:number,cz:number,a:number,b:number,n:number,steps:number=HQ.plate.points,turn=0):Pt[]{
 const pts:Pt[]=[],c=Math.cos(turn),s=Math.sin(turn);
 for(let i=0;i<steps;i++){
  // Counter-clockwise in x/z seen from +y means clockwise in the usual x/y sense: walk the angle down.
  const t=-i/steps*Math.PI*2,ct=Math.cos(t),st=Math.sin(t);
  const x=a*Math.sign(ct)*Math.abs(ct)**(2/n),z=b*Math.sign(st)*Math.abs(st)**(2/n);
  pts.push([cx+x*c-z*s,cz+x*s+z*c]);
 }
 return pts;
}

/** Map units per interior unit: the interior plate shrunk to the exterior's depth. */
export const plateScale=(k=1)=>HQ.depth*HQ.refSize*k/HQ.plate.b;
/** One storey outside: the interior's level spacing at the exterior's scale. */
export const storey=(k=1)=>HQ.plate.level*plateScale(k);
/** The curtain wall outline: the interior's, point for point, at map scale. */
export function outline(k=1):Pt[]{
 const s=plateScale(k);return superellipse(0,0,HQ.plate.a*s,HQ.plate.b*s,HQ.plate.roundness);
}
/** Roof over the lobby and four office floors (the roof slab sits on the last). */
export const hqTop=(k=1)=>storey(k)*HQ.plate.levels;
/** Lift core at the back, as in the interior (behind the wall display), up through the roof. */
export function core(k=1){
 const s=plateScale(k),w=HQ.core.w*s,d=HQ.core.d*s;
 return {x:0,z:-HQ.plate.b*s+d/2+.02*k,w,d,h:hqTop(k)+HQ.core.rise*k};
}
/** Entrance canopy on the +z front over the lobby doors, with a brass fascia. */
export function entrance(k=1){
 const s=plateScale(k),b=HQ.plate.b*s;
 return {w:.62*k,z0:b-.04*k,z1:b+.15*k,y:storey(k)*.7,t:.035*k};
}
/** Restrained planting: two trees each side of the entrance walk. */
export function trees(k=1):Pt[]{
 const c=entrance(k),x=.48*k,z=c.z1-.05*k;
 return [[-x,z],[x,z],[-x,z-.3*k],[x,z-.3*k]].slice(0,HQ.trees) as Pt[];
}

/** Every outline the building puts on the ground, for clearance checks. */
export function footprint(k=1):Pt[]{
 const c=entrance(k);
 return [...outline(k),[-c.w/2,c.z1],[c.w/2,c.z1],...trees(k)];
}

/** Pieces the building draws, for the performance budget: merged meshes and instances. No lights. */
export function hqPieceCount(){
 const meshes=['lobby','glass','stone','panels','brass','roof','signs','door','worker'].length;
 return {meshes,instances:HQ.trees*2};
}
