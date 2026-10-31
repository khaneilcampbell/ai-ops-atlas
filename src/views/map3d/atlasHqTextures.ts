import * as THREE from 'three';

/**
 * Facade glass, one tile = 4 bays by 4 floors: a mullion each bay, a spandrel each floor and a
 * soft sky reflection. The emissive map lights about two thirds of the windows at night.
 */
export function glassTexture(top:string,bottom:string,spandrel:string,seed:number){
 const make=(lit:boolean)=>{
  const c=document.createElement('canvas');c.width=256;c.height=256;const g=c.getContext('2d')!;
  let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
  for(let fy=0;fy<4;fy++)for(let bx=0;bx<4;bx++){
   const x=bx*64,y=fy*64;
   if(lit){g.fillStyle=rnd()<.58?`rgba(255,${200+Math.floor(rnd()*40)},${130+Math.floor(rnd()*50)},1)`:'#1a1408';g.fillRect(x+3,y+3,58,46);continue;}
   const grad=g.createLinearGradient(x,y,x+64,y+52);grad.addColorStop(0,top);grad.addColorStop(1,bottom);
   g.fillStyle=grad;g.fillRect(x,y,64,56);
   g.fillStyle='rgba(255,255,255,.18)';g.fillRect(x+6+bx*5,y,10,56);
  }
  if(!lit){
   g.fillStyle=spandrel;for(let fy=0;fy<4;fy++)g.fillRect(0,fy*64+56,256,8);
   g.fillStyle='rgba(235,240,242,.85)';for(let bx=0;bx<4;bx++)g.fillRect(bx*64,0,3,256);
  }else{g.fillStyle='#000';for(let fy=0;fy<4;fy++)g.fillRect(0,fy*64+50,256,14);}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
  // Texture v grows upward in the skin's UVs; flip so the spandrel sits under each floor.
  t.flipY=false;
  return t;
 };
 return {map:make(false),glow:make(true)};
}

