import type {Inst} from './models';
import {HILLS} from './hillsPlan';
/** Hills mansion, first draft (KC, 2026-10-31): stacked white slabs, dark timber, clear black-framed glass, a roof helipad and a warm clay interior.
 * Positions are local to the estate parcel with y measured from the terrace top; boxes are base-anchored. */
export const MANSION_COLORS={concrete:'#f2f1ec',stone:'#a39d90',timber:'#5a3f2c',frame:'#1f2326',rail:'#cfe2e4',pad:'#2f3437',green:'#5d8a4f',pink:'#e07fb0'} as const;
/** Warm clay interior palette (travertine, plaster, cream boucle, terracotta, timber lattice). */
export const INTERIOR={floor:'#b8a089',rug:'#e2d6c2',cream:'#efe6d6',clay:'#9a5f3e',top:'#d9c4a5',timber:'#7a5638',throw:'#b98a5a',lattice:'#6e4a31',niche:'#a77a55',plaster:'#cf9f72',ceiling:'#e8d6bf',cactus:'#6f8a4c',dark:'#2b2a28'} as const;
/** Highest point of the house (helipad markings); flight clearance allows HILLS.mansion.h + 1. */
export const MANSION_TOP=3.36;
/** round = cylinders (rugs, clay drums, pots). glow = interior walls and ceilings that light up warm at night (emissive only, no real lights). */
export interface MansionParts {solid:Inst[];glass:Inst[];plants:Inst[];lights:Inst[];glow:Inst[];round:Inst[]}
export function mansionParts():MansionParts{
 const C=MANSION_COLORS,solid:Inst[]=[],glass:Inst[]=[],plants:Inst[]=[],lights:Inst[]=[],glow:Inst[]=[];
 const b=(x:number,y:number,z:number,w:number,h:number,d:number,c='#ffffff'):Inst=>({p:[x,y,z],s:[w,h,d],c});
 const front=HILLS.mansion.z+HILLS.mansion.d/2;
 // Stone plinth.
 solid.push(b(13,0,10,9.6,.15,5.6,C.stone));
 // Level 1: timber back rooms, a full-width glass living floor and white end walls.
 solid.push(b(13,.15,8.6,8.6,1.05,2,C.timber),b(8.75,.15,10,.3,1.05,4.9,C.concrete),b(17.25,.15,10,.3,1.05,4.9,C.concrete));
 glass.push(b(13,.15,11.99,8.4,1.05,.03));
 for(let x=9.4;x<=16.6;x+=.8)solid.push(b(x,.15,front-.48,.04,1.05,.04,C.frame));
 // Slab 1 cantilevers over the entrance and carries a planted terrace on the right.
 solid.push(b(13,1.2,10.15,9.2,.14,5.3,C.concrete));
 // Level 2 steps back to the left.
 solid.push(b(11.8,1.34,8.3,6.4,1,1.2,C.timber),b(8.75,1.34,9.8,.3,1,4.3,C.concrete),b(14.85,1.34,9.8,.3,1,4.3,C.concrete));
 glass.push(b(11.8,1.34,11.89,6,1,.03));
 for(let x=9.4;x<=14.4;x+=.7)solid.push(b(x,1.34,11.92,.04,1,.04,C.frame));
 solid.push(b(16.3,1.34,12.68,2.6,.26,.03,C.rail),b(16.3,1.34,12.25,2.2,.16,.3,C.stone));
 for(const [x,c]of [[15.4,C.green],[15.9,C.pink],[16.4,C.green],[16.9,C.pink],[17.3,C.green]] as const)plants.push(b(x,1.44,12.25,.42,.32,.32,c));
 // Slab 2, then a smaller top floor shifted right so the left side becomes a roof garden.
 solid.push(b(12.6,2.34,10,8.2,.14,5,C.concrete));
 solid.push(b(14,2.48,8.3,4.8,.72,.8,C.timber),b(11.75,2.48,9.8,.3,.72,3.8,C.concrete),b(16.25,2.48,9.8,.3,.72,3.8,C.concrete));
 glass.push(b(14,2.48,11.69,4.4,.72,.03));
 for(let x=12.3;x<=15.8;x+=.7)solid.push(b(x,2.48,11.72,.04,.72,.04,C.frame));
 solid.push(b(10,2.48,12.42,2.9,.24,.03,C.rail),b(10,2.48,11.9,2.6,.14,.4,C.stone));
 for(const [x,c]of [[9,C.pink],[9.6,C.green],[10.2,C.green],[10.8,C.pink]] as const)plants.push(b(x,2.56,11.9,.45,.3,.35,c));
 // Roof slab and helipad with its H mark; pad lights glow only at night.
 solid.push(b(14,3.2,9.9,5.4,.12,4.4,C.concrete),b(14,3.32,9.9,2.6,.03,2.6,C.pad));
 solid.push(b(13.6,3.35,9.9,.12,.01,.9,C.concrete),b(14.4,3.35,9.9,.12,.01,.9,C.concrete),b(14,3.35,9.9,.8,.01,.12,C.concrete));
 for(const [x,z]of [[12.8,8.7],[15.2,8.7],[12.8,11.1],[15.2,11.1],[14,8.7],[14,11.1],[12.8,9.9],[15.2,9.9]])lights.push(b(x,3.32,z,.08,.04,.08));
 // Interior (KC's warm clay hotel references): travertine floors, plaster walls, timber lattice, arched niches,
 // cream rounded sofas on round rugs, clay drum counter and clay pendants. Seen through the clear glass; no lights.
 const I=INTERIOR,round:Inst[]=[];
 glow.push(b(13,.15,10.8,8.2,.012,2.4,I.floor),b(11.8,1.34,10.4,5.8,.012,3,I.floor),b(14,2.48,10.3,4.2,.012,2.8,I.floor));
 const rug=(x:number,y:number,z:number,r:number)=>round.push(b(x,y,z,r,.008,r,I.rug));
 const puff=(x:number,y:number,z:number,w:number,d:number)=>plants.push(b(x,y+.1,z,w,.1,d,I.cream));
 const pendant=(x:number,ceil:number,z:number,drop:number)=>{solid.push(b(x,ceil-drop,z,.006,drop,.006,I.dark));plants.push(b(x,ceil-drop-.08,z,.08,.11,.08,I.clay));lights.push(b(x,ceil-drop-.2,z,.04,.02,.04));};
 const lattice=(x0:number,x1:number,y:number,z:number,h:number)=>{for(let x=x0;x<=x1+1e-6;x+=.2)solid.push(b(x,y,z,.05,h,.03,I.lattice));};
 const niches=(xs:number[],y:number,z:number)=>{for(const x of xs){solid.push(b(x,y,z,.36,.46,.012,I.niche));round.push(b(x,y+.02,z+.05,.1,.16,.1,I.clay));}};
 // Level 1: lounge around a round rug (left) and a clay drum counter (right), lattice and niches on the back wall.
 rug(10.6,.16,10.9,1.7);round.push(b(10.6,.16,10.9,.45,.13,.45,I.clay));
 puff(9.85,.16,11.25,.36,.2);puff(10.75,.16,11.55,.32,.18);puff(10.15,.16,10.25,.38,.2);puff(11.4,.16,10.55,.2,.2);
 for(let x=14.3;x<=15.71;x+=.35)round.push(b(x,.16,10.65,.36,.42,.36,I.clay));solid.push(b(15,.58,10.65,1.85,.03,.46,I.top));
 rug(16.3,.16,11.3,.9);puff(16.3,.16,11.3,.3,.2);
 lattice(13.2,16.8,.16,9.64,1.02);niches([9.5,10.2,10.9],.42,9.64);
 for(const [x,z,d]of [[10.4,10.8,.25],[10.8,11.05,.35],[10.6,10.6,.3],[14.6,10.65,.3],[15.4,10.65,.3]] as const)pendant(x,1.2,z,d);
 // Level 2: bedroom with timber headboard, layered bed, curved lounger and niches.
 rug(10.6,1.35,10.25,2.2);
 solid.push(b(10.6,1.35,9.05,1.4,.55,.08,I.timber),b(10.6,1.36,10,1.1,.14,1.4,I.timber),b(10.6,1.5,10.03,1.02,.08,1.32,I.cream),b(10.6,1.585,10.45,1.04,.012,.3,I.throw));
 plants.push(b(10.35,1.62,9.35,.14,.05,.08,I.cream),b(10.85,1.62,9.35,.14,.05,.08,I.cream));
 for(const x of [9.75,11.45])round.push(b(x,1.35,9.35,.24,.24,.24,I.clay));for(const x of [9.75,11.45])pendant(x,2.34,9.35,.35);
 puff(12.6,1.35,11.2,.4,.2);round.push(b(13.1,1.35,11.3,.2,.2,.2,I.clay));
 lattice(12.2,14.4,1.35,8.94,.97);niches([13.2,13.9],1.6,8.95);
 // Level 3: lounge under a cluster of clay pendants.
 rug(14,2.49,10.4,1.8);round.push(b(14,2.49,10.4,.4,.12,.4,I.clay));
 puff(13.3,2.49,10.8,.34,.2);puff(14.7,2.49,10.8,.34,.2);puff(14,2.49,9.75,.4,.18);
 for(const [x,z,d]of [[13.85,10.35,.2],[14.15,10.45,.28],[14,10.25,.34]] as const)pendant(x,3.2,z,d);
 lattice(12.3,13.5,2.49,8.74,.69);niches([15,15.6],2.62,8.75);
 plants.push(b(16.6,.4,11.5,.18,.25,.18,I.cactus),b(9.3,1.6,11.4,.15,.22,.15,I.cactus),b(12.3,2.72,11.3,.15,.2,.15,I.cactus));
 round.push(b(16.6,.16,11.5,.26,.22,.26,I.clay),b(9.3,1.35,11.4,.24,.2,.24,I.clay),b(12.3,2.49,11.3,.22,.18,.22,I.clay));
 glow.push(b(13,.16,9.62,8.2,1.02,.02,I.plaster),b(11.8,1.35,8.92,5.8,.98,.02,I.plaster),b(14,2.49,8.72,4.2,.7,.02,I.plaster));
 glow.push(b(13,1.18,10.8,8.2,.015,2.4,I.ceiling),b(11.8,2.32,10.4,5.8,.015,3,I.ceiling),b(14,3.18,10.3,4.2,.015,2.8,I.ceiling));
 for(const [x,y,z,w]of [[13,1.17,9.75,8],[11.8,2.31,9.05,5.6],[14,3.17,8.85,4]])lights.push(b(x,y,z,w,.012,.05));
 // The tall timber stair core runs through every slab, like the reference's dark central tower.
 solid.push(b(11.3,.15,12.2,.6,3.2,.5,C.timber));
 return {solid,glass,plants,lights,glow,round};
}
