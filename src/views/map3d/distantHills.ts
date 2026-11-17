/** Distant forested hills across the water, like the hills behind Khaneil's city artwork (2026-11-17).
 * Pale, hazy green so they read as far away. A ring of low, flattened mounds well beyond the island: the haze softens them into a backdrop,
 * they never cast shadows and nothing can be clicked on them. About 80 triangles each. */
import type {Inst} from './models';
import {hash} from '../mapLayout';

export const HILLS={count:40,gap:8,margin:120,minH:22,maxH:48,colors:['#8a9e86','#93a68e','#83977f','#9cae96']} as const;

export function distantHills(bounds:{x0:number;x1:number;z0:number;z1:number},waterY:number):Inst[]{
 const cx=(bounds.x0+bounds.x1)/2,cz=(bounds.z0+bounds.z1)/2,half=Math.max(bounds.x1-bounds.x0,bounds.z1-bounds.z0)/2;
 const r0=half*HILLS.gap+HILLS.margin,out:Inst[]=[];
 for(let i=0;i<HILLS.count;i++){
  const k=hash(`hill:${i}`),a=(i+k*.6)/HILLS.count*Math.PI*2,r=r0+hash(`hill:${i}:r`)*half*.6;
  const h=HILLS.minH+(HILLS.maxH-HILLS.minH)*hash(`hill:${i}:h`),w=h*(2.6+hash(`hill:${i}:w`)*1.6);
  out.push({p:[cx+Math.cos(a)*r,waterY-h*.35,cz+Math.sin(a)*r],s:[w,h,w*(.7+k*.5)],r:a,c:HILLS.colors[i%HILLS.colors.length]});
 }
 return out;
}
