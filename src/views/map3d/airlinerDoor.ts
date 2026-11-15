import * as THREE from "three";
import type {Inst} from "./models";

/**
 * The airliners' (and the gold jet's) forward left passenger door, drawn flush on the curved skin like a real
 * plug door (Khaneil, 2026-11-15: "fix jet door plane design. make it look more realistic"): a panel in the skin
 * colour inside a thin dark seam, a small porthole level with the cabin windows, and a handle recess. The old
 * door was one dark slab hanging from the window line down to the belly, standing off the curved skin.
 * Aircraft-local: nose -z, left -x. `radius` is the outer skin radius at the door, `y0` the fuselage centre height.
 */
export const DOOR={centre:.005,height:.16,width:.09,seam:.007} as const;

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
  const on=(out:number,mid:number,s:[number,number,number],c:string):Inst=>{
    const a=f.phi,r=radius+out,up=mid-s[1]/2;
    return {p:[-Math.cos(a)*r+Math.sin(a)*up,y0+Math.sin(a)*r+Math.cos(a)*up,z],s,rz:-a,c};
  };
  return [
    on(.002,0,[.008,D.height+2*D.seam,D.width+2*D.seam],shade(skin,.5)),
    on(.004,0,[.008,D.height,D.width],skin),
    on(.007,D.height*.33,[.004,.032,.026],glass),
    on(.007,-D.height*.08,[.004,.01,.03],shade(skin,.35)),
  ];
}

/** Cabin windows (half width .015) on the door side keep at least a hand's width clear of the door seam. */
export const clearOfDoor=(windowZ:number,doorZ:number)=>Math.abs(windowZ-doorZ)>DOOR.width/2+DOOR.seam+.015+.006;
