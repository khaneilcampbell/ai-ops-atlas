import * as THREE from "three";
import type {Inst} from "./models";

/**
 * The airliners' (and the gold jet's) forward left passenger door, drawn flush on the curved skin like a real
 * plug door (Khaneil, 2026-11-15: "fix jet door plane design. make it look more realistic"): a panel in the skin
 * colour inside a thin dark seam, rounded corners, a small porthole level with the cabin windows, a handle
 * recess toward the aft edge and a hinge line along the forward edge (Khaneil: "make it look like a aircraft door"). The old
 * door was one dark slab hanging from the window line down to the belly, standing off the curved skin.
 * Aircraft-local: nose -z, left -x. `radius` is the outer skin radius at the door, `y0` the fuselage centre height.
 */
/** Tall and narrow like a real cabin door (about 2:1), with rounded corners (`corner`, outer seam radius). */
export const DOOR={centre:.005,height:.16,width:.085,seam:.007,corner:.022} as const;

/** The door centre's angle below the fuselage centre line, on the left side. */
export function doorFrame(radius:number,y0:number){
  return {phi:Math.asin(DOOR.centre/radius),y0};
}

const shade=(c:string,k:number)=>"#"+new THREE.Color(c).lerp(new THREE.Color("#101418"),k).getHexString();

export function airlinerDoor({radius,y0,z,skin,glass}:{radius:number;y0:number;z:number;skin:string;glass:string}):Inst[]{
  const f=doorFrame(radius,y0),D=DOOR;
  // One flat plug door laid on the skin's tangent at the window line, where the tube is nearly upright, so its
  // edges stay within a hair of the skin all round (a bent, banded door showed steps on the faceted tube).
  // Boxes are drawn up from their base (models.tsx `lifted`), so each part starts half its height below `up`.
  const on=(out:number,mid:number,s:[number,number,number],c:string,across=0):Inst=>{
    const a=f.phi,r=radius+out,up=mid-s[1]/2;
    return {p:[-Math.cos(a)*r+Math.sin(a)*up,y0+Math.sin(a)*r+Math.cos(a)*up,z+across],s,rz:-a,c};
  };
  const H=D.height+2*D.seam,W=D.width+2*D.seam,rs=D.corner,rp=D.corner-D.seam,seam=shade(skin,.5);
  // Each rounded rectangle is a tall box and a wide box crossing; doorCorners fills the four corners with discs.
  return [
    on(.002,0,[.008,H,W-2*rs],seam),
    on(.004,0,[.008,D.height,D.width-2*rp],skin),
    on(.007,D.height*.33,[.004,.032,.026],glass),
    // Flush handle recess, toward the aft edge as on a real plug door, and the hinge line along the forward edge.
    on(.007,-D.height*.08,[.004,.01,.026],shade(skin,.35),D.width*.18),
    on(.0065,0,[.003,D.height*.8,.004],shade(skin,.25),-D.width/2+.006),
    on(.002,0,[.008,H-2*rs,W],seam),
    on(.004,0,[.008,D.height-2*rp,D.width],skin),
  ];
}

/** Rounded corners for the door's seam and panel: flat discs (ball geometry, centred) at each corner. */
export function doorCorners({radius,y0,z,skin}:{radius:number;y0:number;z:number;skin:string}):Inst[]{
  const f=doorFrame(radius,y0),D=DOOR,a=f.phi,seam=shade(skin,.5);
  const disc=(out:number,up:number,across:number,rr:number,c:string):Inst=>{
    const r=radius+out;
    return {p:[-Math.cos(a)*r+Math.sin(a)*up,y0+Math.sin(a)*r+Math.cos(a)*up,z+across],s:[.004,rr,rr],rz:-a,c};
  };
  const out:Inst[]=[];
  for(const [h,w,rr,o,c] of [[D.height/2+D.seam,D.width/2+D.seam,D.corner,.002,seam],[D.height/2,D.width/2,D.corner-D.seam,.004,skin]] as const)
    for(const v of [-1,1])for(const u of [-1,1])out.push(disc(o,v*(h-rr),u*(w-rr),rr,c));
  return out;
}

/** Cabin windows (half width .015) on the door side keep at least a hand's width clear of the door seam. */
export const clearOfDoor=(windowZ:number,doorZ:number)=>Math.abs(windowZ-doorZ)>DOOR.width/2+DOOR.seam+.015+.006;
