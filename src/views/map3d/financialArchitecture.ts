import type {Inst} from './models';
import {financialBrand} from './financialBrands';
import {CIRCA} from './circaPlan';

/** A stylized vertical scale, not a geospatial survey. HQ-relative minimums remain in force. */
export const FINANCIAL_METRES_PER_UNIT=18;
export const WELLS_FARGO_REFERENCE_METRES=235;
export const BALCONY={projection:.44,railHeight:.22,gardenEvery:5,walkClearance:.32} as const;
export function financialDimensions(id:string){
 const architecture=financialBrand(id)?.architecture;
 if(architecture==='twin')return {width:CIRCA.podium.w,depth:CIRCA.podium.d,projection:0,w:CIRCA.podium.w+.7,d:CIRCA.podium.d+.7,top:CIRCA.crown};
 const width=architecture==='hotel'||architecture==='bevelled'?3.6:architecture?3.4:3;
 const depth=architecture?2.8:2.6,projection=architecture==='biophilic'?BALCONY.projection:0;
 return {width,depth,projection,w:Math.max(width+.5,width+projection*2+.12),d:Math.max(depth+(architecture?.7:.5),depth+projection*2+.12),top:architecture?1.1:1.2};
}
export function financialHeight(id:string,reference:number,rise:number){return Math.max(reference*rise,id==='records'?WELLS_FARGO_REFERENCE_METRES/FINANCIAL_METRES_PER_UNIT:0);}
export const financialSignLevel=(id:string,height:number)=>financialBrand(id)?.architecture==='deco'?height*.5:height;
export interface TowerPalette{ivory:string;green:string;gold:string}
export interface ArchitecturePlan{solid:Inst[];glass:Inst[];clearGlass:Inst[];glow:Inst[];bevelled:Inst[];leaves:Inst[];trees:{x:number;y:number;z:number;floor:number}[];balconies:{y:number;innerW:number;innerD:number;outerW:number;outerD:number;garden:boolean}[]}
/** Local coordinates, bases at y=0. Rendering, bounds and clearance tests share dimensions. */
export function financialArchitecture(id:string,height:number,palette:TowerPalette):ArchitecturePlan{
 const solid:Inst[]=[],glass:Inst[]=[],clearGlass:Inst[]=[],glow:Inst[]=[],bevelled:Inst[]=[],leaves:Inst[]=[],trees:ArchitecturePlan['trees']=[],balconies:ArchitecturePlan['balconies']=[];
 const out={solid,glass,clearGlass,glow,bevelled,leaves,trees,balconies},brand=financialBrand(id);
 if(!brand?.architecture||brand.architecture==='twin')return out;
 const {width:w,depth:d}=financialDimensions(id),{body,trim,accent}=brand;
 const box=(target:Inst[],x:number,y:number,z:number,w:number,h:number,d:number,c:string,r=0)=>target.push({p:[x,y,z],s:[w,h,d],c,r});
 const slab=(y:number,ww:number,dd:number,c=trim,h=.045)=>box(solid,0,y,0,ww,h,dd,c);
 const tree=(x:number,y:number,z:number,floor:number)=>{
  const compact=floor>=0;box(solid,x,y,z,.28,compact?.08:.16,.28,palette.ivory);box(solid,x,y+(compact?.08:.16),z,.035,compact?.12:.25,.035,'#87785e');
  box(leaves,x,y+(compact?.23:.5),z,compact?.17:.19,compact?.11:.24,compact?.17:.19,'#6c9564');trees.push({x,y,z,floor});
 };
 const ring=(y:number,iw:number,idd:number,ow:number,od:number,garden:boolean)=>{
  const px=(ow-iw)/2,pz=(od-idd)/2;
  for(const side of [-1,1]){
   box(solid,0,y,side*(idd/2+pz/2),ow,.055,pz,palette.ivory);
   box(solid,side*(iw/2+px/2),y,0,px,.055,idd,palette.ivory);
   box(solid,0,y+BALCONY.railHeight,side*(od/2-.025),ow,.025,.025,palette.green);
   box(solid,side*(ow/2-.025),y+BALCONY.railHeight,0,.025,.025,od,palette.green);
   for(const offset of [-1,0,1]){
    box(solid,offset*(ow/2-.04),y+.055,side*(od/2-.025),.018,.165,.018,trim);
    box(solid,side*(ow/2-.025),y+.055,offset*(od/2-.04),.018,.165,.018,trim);
   }
  }
  balconies.push({y,innerW:iw,innerD:idd,outerW:ow,outerD:od,garden});
 };
 const levels=Math.max(1,Math.floor((height-2.3)/.42)),step=(height-2.3)/levels;
 const terraceLevels=[.54,.78].map(r=>Math.ceil((height*r-1.15)/step)),terraceY=terraceLevels.map(level=>1.15+level*step);
 for(let floor=0;floor<levels;floor++){
  const y=1.15+floor*step,garden=brand.architecture==='biophilic'&&floor%BALCONY.gardenEvery===4;
  const setback=brand.architecture==='deco'?(floor>=terraceLevels[1]?1.4:floor>=terraceLevels[0]?.7:0):garden?.62:0;
  const ww=w-setback,dd=brand.architecture==='deco'?d:d-setback;
  const signTop=financialSignLevel(id,height)-.25,signBottom=signTop-.65;
  const inSignBand=y+step*.8>signBottom-.04&&y<signTop+.04;
  box(brand.architecture==='bevelled'?bevelled:solid,0,y,0,ww,step,dd,body);
  const cut=brand.architecture==='bevelled'?.34:.08;
  if(!inSignBand)for(const side of [-1,1]){
   for(let col=0;col<6;col++)box(glass,-ww/2+cut+.2+col*(ww-2*cut-.4)/5,y+.065,side*(dd/2+.016),(ww-2*cut)/6-.055,step*.72,.025,brand.glass);
   for(let col=0;col<4;col++)box(glass,side*(ww/2+.016),y+.065,-dd/2+cut+.2+col*(dd-2*cut-.4)/3,.025,step*.72,(dd-2*cut)/4-.055,brand.glass);
  }
  if(brand.architecture==='biophilic'){
   ring(y,ww,dd,w+BALCONY.projection*2,d+BALCONY.projection*2,garden);
   if(garden)for(const side of [-1,1]){tree(side*(ww/2+.22),y+.06,0,floor);tree(0,y+.06,side*(dd/2+.22),floor);}
  }else if(brand.architecture==='bevelled'){
   box(bevelled,0,y-.025,0,w+.045,.035,d+.045,trim);
   for(const sx of [-1,1])for(const sz of [-1,1]){
    box(glass,sx*(w/2-cut/2+.01),y+.065,sz*(d/2-cut/2+.01),cut*Math.SQRT2*.85,step*.72,.025,brand.glass,sx*sz*Math.PI/4);
   }
  }else slab(y,ww+.07,dd+.07,brand.architecture==='hotel'?palette.ivory:trim);
 }
 // Separate the sign band from glazing and structural ribs.
 box(brand.architecture==='bevelled'?bevelled:solid,0,height-1.15,0,brand.architecture==='deco'?w-1.4:w,1.15,d,body);
 if(brand.architecture==='deco'){
  for(const side of [-1,1])for(const offset of [-.32,0,.32]){
   const signTop=financialSignLevel(id,height)-.25,signBottom=signTop-.65;
   for(const [lo,hi]of [[1.15,signBottom-.05],[signTop+.05,terraceY[0]]])if(hi>lo){box(solid,offset*w,lo,side*(d/2+.05),.055,hi-lo,.06,trim);box(solid,side*(w/2+.05),lo,offset*d,.06,hi-lo,.055,trim);}
  }
  for(const [y,ww,dd]of [[terraceY[0],w,d],[terraceY[1],w-.7,d]]){
   slab(y,ww+.1,dd+.1,palette.ivory);
   for(const side of [-1,1]){tree(side*(ww/2-.12),y+.05,0,-1);box(solid,side*(ww/2-.03),y+.06,0,.025,.18,dd,trim);}
  }
  slab(height+.12,w-1.25,d+.1);slab(height+.32,w-1.55,d*.8,palette.ivory,.22);slab(height+.54,w-1.8,d*.65,accent,.12);
  if(id==='budget')for(const x of [-.4,0,.4])box(solid,x,height+.66,0,.07,.28,d*.48,accent);
 }else if(brand.architecture==='hotel'){
  for(const sx of [-1,1])for(const sz of [-1,1])box(solid,sx*(w/2-.06),1.12,sz*(d/2-.06),.09,height-1.12,.09,trim);
  slab(height+.1,w+.14,d+.14,palette.ivory,.13);slab(height+.26,w*.8,d*.82,accent,.12);slab(height+.4,w*.56,d*.58,palette.ivory,.38);
  for(const sx of [-1,1])tree(sx*(w/2-.26),height+.25,0,-1);
 }else if(brand.architecture==='biophilic'){
  slab(height+.12,w+.18,d+.18,palette.ivory,.12);slab(height+.27,w*.8,d*.8,palette.green,.08);
  for(const sx of [-1,1])tree(sx*.9,height+.35,0,-1);
 }else if(brand.architecture==='pavilion'){
  // Three low-poly pavilion ribbons reference Benjaire's Build / Operate / Grow forms.
  slab(height+.08,w+.12,d+.12,accent,.08);
  for(const x of [-.9,0,.9])for(let i=0;i<8;i++){
   const a=-d*.39+i*d*.78/8,b=a+d*.78/8,ya=.16+.35*(1-Math.pow(a/(d*.39),2)),yb=.16+.35*(1-Math.pow(b/(d*.39),2));
   solid.push({p:[x,height+(ya+yb)/2,(a+b)/2],s:[.64,.055,Math.hypot(b-a,yb-ya)],rx:-Math.atan2(yb-ya,b-a),c:body});
  }
  for(const side of [-1,1])for(const x of [-w/2+.04,-w/6,w/6,w/2-.04])box(solid,x,1.15,side*(d/2+.045),.035,height-2.35,.035,trim);
 }else{
  box(bevelled,0,height+.08,0,w+.14,.09,d+.14,trim);box(bevelled,0,height+.2,0,w*.8,.35,d*.8,body);box(bevelled,0,height+.55,0,w*.8+.04,.065,d*.8+.04,accent);
 }
 // Hollow ground floor: the transparent foyer reveals a real reception, not a solid core.
 box(solid,0,.16,0,w,.045,d,palette.ivory);box(solid,0,.2,-d/2+.08,w,.88,.1,body);
 for(const side of [-1,1])box(solid,side*(w/2-.04),.2,0,.08,.88,d,trim);
 box(solid,-.68,.21,-.2,.95,.34,.38,body);box(solid,-.68,.55,-.2,1.02,.035,.43,accent);
 box(solid,.85,.22,-.35,.48,.25,.5,palette.ivory);box(solid,.85,.47,-.55,.48,.25,.07,trim);
 // Canopy and sign panels stay inside the planned envelope and off the entrance path.
 const signY=financialSignLevel(id,height)-.92;
 box(solid,0,signY-.015,d/2+.035,2.7,.69,.06,brand.signBackground);
 box(solid,w/2+.035,signY-.015,0,.06,.69,2.55,brand.signBackground);
 box(solid,0,.82,d/2+.12,brand.architecture==='hotel'?1.8:1.1,.055,.4,accent);
 for(const side of [-1,1])box(solid,side*.37,.17,d/2+.06,.025,.65,.025,trim);
 return out;
}
