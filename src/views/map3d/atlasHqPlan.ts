import type {Pt} from './roads';

/**
 * Atlas HQ, the map's centerpiece: a curving glass office tower. A tall blue tower with a sloped
 * roof, a shorter gold wing that sways in an S against it, a three-storey ribbed podium with a
 * roof garden, and a glass lobby under a wavy canopy.
 *
 * Proportions follow an 81 m, 21-storey tower on a 72 x 40 m site (3.6 m floors, 5 m podium
 * floors), stylized to the map's scale: the plan is squeezed into the old square footprint so
 * the plaza, fountain, roads and links around it are unchanged.
 *
 * Plain numbers only (no three.js), in coordinates local to the tower: x across the front, z
 * toward the viewer (+z is the entrance side), y up from the floor base. Everything scales with
 * the tower's footprint `size`.
 */
export const HQ = {
 /** The old landmark's footprint; the reference plan below is drawn for it. */
 refSize:1.734,
 floors:21,
 /** 3.6 m storeys. */
 floor:.26,
 /** Roof slopes from its high west corner (81 m) down to 74 m at the east edge of the tower. */
 roofHigh:6.05,
 roofLow:5.55,
 /** The gold wing stops near 70 m. */
 wingTop:5.25,
 podiumLevels:3,
 /** 5 m podium storeys. */
 podiumFloor:.34,
 /** Samples around each plan outline and up the swaying wing. */
 ring:40,
 wingSteps:22,
 /** Fins stand on every `finEvery`-th outline point. */
 finEvery:2,
 finDepth:.028,
 bladeDepth:.06,
 bandDepth:.016,
 bandHeight:.012,
 /** Glass texture: one tile is 4 bays by 4 floors. */
 bay:.085,
 lobbyHeight:.56,
 canopyY:.6,
 trees:5,
} as const;

export type Pt3=[number,number,number];

/** A rounded rectangle (superellipse), counter-clockwise seen from above. */
export function superellipse(cx:number,cz:number,a:number,b:number,n:number,steps:number=HQ.ring,turn=0):Pt[]{
 const pts:Pt[]=[],c=Math.cos(turn),s=Math.sin(turn);
 for(let i=0;i<steps;i++){
  // Counter-clockwise in x/z seen from +y means clockwise in the usual x/y sense: walk the angle down.
  const t=-i/steps*Math.PI*2,ct=Math.cos(t),st=Math.sin(t);
  const x=a*Math.sign(ct)*Math.abs(ct)**(2/n),z=b*Math.sign(st)*Math.abs(st)**(2/n);
  pts.push([cx+x*c-z*s,cz+x*s+z*c]);
 }
 return pts;
}

/** The blue tower: a softly rounded slab on the west half of the site. */
export function towerOutline(k=1):Pt[]{return superellipse(-.39*k,-.03*k,.47*k,.56*k,4.2);}
/** Roof height over the blue tower: highest on the west side, sloping east. */
export function towerRoof(x:number,k=1){
 const t=Math.min(1,Math.max(0,(x/k+.86)/.96));
 return (HQ.roofHigh-(HQ.roofHigh-HQ.roofLow)*t)*k;
}

/**
 * The gold wing's sway at height t (0 base, 1 top): its plan centre swings east, back west into
 * the tower, then east again, and the plan turns a little as it goes, so the wing reads as an S
 * twisting against the straight tower.
 */
export function wingSway(t:number){
 const w=Math.sin(Math.PI*2*t);
 return {x:.2-.15*w,z:.06+.03*Math.cos(Math.PI*2*t),turn:.28*w};
}
export function wingOutline(t:number,k=1):Pt[]{
 const s=wingSway(t);return superellipse(s.x*k,s.z*k,.27*k,.5*k,2.6,HQ.ring,s.turn);
}
/** Levels of the wing from the ground to its curved top; the top dips toward its east edge. */
export function wingLevels(k=1):Pt3[][]{
 const out:Pt3[][]=[];
 for(let i=0;i<=HQ.wingSteps;i++){
  const t=i/HQ.wingSteps,y=HQ.wingTop*k*t,pts=wingOutline(t,k),cx=wingSway(t).x*k;
  out.push(pts.map(([x,z])=>[x,i===HQ.wingSteps?y+(cx-x)*.35:y,z]));
 }
 return out;
}
export function towerLevels(k=1):Pt3[][]{
 const pts=towerOutline(k);
 return [pts.map(([x,z])=>[x,0,z]),pts.map(([x,z])=>[x,towerRoof(x,k),z])];
}

/** The podium: east of the tower and behind it, its front east corner rounded. */
export function podiumOutline(k=1):Pt[]{return superellipse(.38*k,-.18*k,.48*k,.68*k,3.2);}
export const podiumHeight=(k=1)=>HQ.podiumLevels*HQ.podiumFloor*k;

/** Roof garden on the podium, in the part the towers leave open (back and east). */
export function roofGarden(k=1){
 const y=podiumHeight(k);
 const pools=[{x:.55*k,z:-.48*k,a:.2*k,b:.07*k,turn:.5},{x:.66*k,z:-.08*k,a:.14*k,b:.05*k,turn:-.35}];
 const trees:Pt[]=[[.38*k,-.7*k],[.74*k,-.68*k],[.78*k,-.3*k],[.48*k,-.24*k],[.72*k,.16*k]];
 return {y,pools,trees:trees.slice(0,HQ.trees)};
}

/** The lobby glass, two floors tall across the tower front, and the wavy canopy above it. */
export function lobby(k=1){return {x0:-.8*k,x1:.36*k,z:.535*k,h:HQ.lobbyHeight*k};}
/** Canopy edge: front edge waves out and back, the whole lid dips gently in the middle. */
export function canopyAt(u:number,k=1){
 const x=(-.85+1.4*u)*k;
 return {x,front:(.76+.08*Math.sin(u*Math.PI*2.4))*k,back:.4*k,y:(HQ.canopyY-.07*Math.sin(u*Math.PI))*k};
}

/** Every outline the building puts on the ground, for clearance checks. */
export function footprint(k=1):Pt[]{
 const canopy=Array.from({length:12},(_,i)=>{const c=canopyAt(i/11,k);return [c.x,c.front] as Pt;});
 return [...towerOutline(k),...podiumOutline(k),...wingLevels(k).flatMap(l=>l.map(([x,,z])=>[x,z] as Pt)),...canopy];
}
export const hqTop=(k=1)=>HQ.roofHigh*k;

/**
 * Pieces the building draws, for the performance budget: merged meshes and instances. Every part
 * is static; nothing here adds a light.
 */
export function hqPieceCount(){
 const towerFins=Math.ceil(HQ.ring/HQ.finEvery),wingFins=towerFins,podiumFins=HQ.ring*2;
 const meshes=['towerGlass','wingGlass','podiumGlass','roofs','bands','fins','lobby','canopy','garden','pools','trunks','canopies','signs'].length;
 return {meshes,instances:podiumFins+HQ.trees*2,finStrips:towerFins+wingFins};
}
