import type {Inst} from './models';
import {HILLS} from './hillsPlan';
/** Hills mansion, first draft (KC, 2026-10-31): stacked white slabs, dark timber, black-framed glass and a roof helipad.
 * Positions are local to the estate parcel with y measured from the terrace top; boxes are base-anchored. */
export const MANSION_COLORS={concrete:'#f2f1ec',stone:'#a39d90',timber:'#5a3f2c',frame:'#1f2326',rail:'#cfe2e4',pad:'#2f3437',green:'#5d8a4f',pink:'#e07fb0'} as const;
/** Highest point of the house (helipad markings); flight clearance allows HILLS.mansion.h + 1. */
export const MANSION_TOP=3.36;
export interface MansionParts {solid:Inst[];glass:Inst[];plants:Inst[];lights:Inst[]}
export function mansionParts():MansionParts{
 const C=MANSION_COLORS,solid:Inst[]=[],glass:Inst[]=[],plants:Inst[]=[],lights:Inst[]=[];
 const b=(x:number,y:number,z:number,w:number,h:number,d:number,c='#ffffff'):Inst=>({p:[x,y,z],s:[w,h,d],c});
 const front=HILLS.mansion.z+HILLS.mansion.d/2;
 // Stone plinth.
 solid.push(b(13,0,10,9.6,.15,5.6,C.stone));
 // Level 1: timber back rooms, a full-width glass living floor and white end walls.
 solid.push(b(13,.15,8.6,8.6,1.05,2,C.timber),b(8.75,.15,10,.3,1.05,4.9,C.concrete),b(17.25,.15,10,.3,1.05,4.9,C.concrete));
 glass.push(b(13,.15,10.8,8.4,1.05,2.4));
 for(let x=9.4;x<=16.6;x+=.8)solid.push(b(x,.15,front-.48,.04,1.05,.04,C.frame));
 // Slab 1 cantilevers over the entrance and carries a planted terrace on the right.
 solid.push(b(13,1.2,10.15,9.2,.14,5.3,C.concrete));
 // Level 2 steps back to the left.
 solid.push(b(11.8,1.34,8.3,6.4,1,1.2,C.timber),b(8.75,1.34,9.8,.3,1,4.3,C.concrete),b(14.85,1.34,9.8,.3,1,4.3,C.concrete));
 glass.push(b(11.8,1.34,10.4,6,1,3));
 for(let x=9.4;x<=14.4;x+=.7)solid.push(b(x,1.34,11.92,.04,1,.04,C.frame));
 solid.push(b(16.3,1.34,12.68,2.6,.26,.03,C.rail),b(16.3,1.34,12.25,2.2,.16,.3,C.stone));
 for(const [x,c]of [[15.4,C.green],[15.9,C.pink],[16.4,C.green],[16.9,C.pink],[17.3,C.green]] as const)plants.push(b(x,1.44,12.25,.42,.32,.32,c));
 // Slab 2, then a smaller top floor shifted right so the left side becomes a roof garden.
 solid.push(b(12.6,2.34,10,8.2,.14,5,C.concrete));
 solid.push(b(14,2.48,8.3,4.8,.72,.8,C.timber),b(11.75,2.48,9.8,.3,.72,3.8,C.concrete),b(16.25,2.48,9.8,.3,.72,3.8,C.concrete));
 glass.push(b(14,2.48,10.3,4.4,.72,2.8));
 for(let x=12.3;x<=15.8;x+=.7)solid.push(b(x,2.48,11.72,.04,.72,.04,C.frame));
 solid.push(b(10,2.48,12.42,2.9,.24,.03,C.rail),b(10,2.48,11.9,2.6,.14,.4,C.stone));
 for(const [x,c]of [[9,C.pink],[9.6,C.green],[10.2,C.green],[10.8,C.pink]] as const)plants.push(b(x,2.56,11.9,.45,.3,.35,c));
 // Roof slab and helipad with its H mark; pad lights glow only at night.
 solid.push(b(14,3.2,9.9,5.4,.12,4.4,C.concrete),b(14,3.32,9.9,2.6,.03,2.6,C.pad));
 solid.push(b(13.6,3.35,9.9,.12,.01,.9,C.concrete),b(14.4,3.35,9.9,.12,.01,.9,C.concrete),b(14,3.35,9.9,.8,.01,.12,C.concrete));
 for(const [x,z]of [[12.8,8.7],[15.2,8.7],[12.8,11.1],[15.2,11.1],[14,8.7],[14,11.1],[12.8,9.9],[15.2,9.9]])lights.push(b(x,3.32,z,.08,.04,.08));
 // The tall timber stair core runs through every slab, like the reference's dark central tower.
 solid.push(b(11.3,.15,12.2,.6,3.2,.5,C.timber));
 return {solid,glass,plants,lights};
}
