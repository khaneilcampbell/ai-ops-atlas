import * as THREE from 'three';

/**
 * Atlas Stadium's shell skin, one tile = 4 x 4 panels: fine panel joints and a scatter of small
 * perforation dots, thicker towards each panel's lower edge. The glow map lights about two thirds
 * of the dots warm, so at night the shells sparkle with tiny static points. Drawn on a canvas:
 * no images, no downloads, no animation.
 */
export function stadiumSkinTexture(seed=7){
 let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
 const dots:{x:number;y:number;r:number;lit:boolean}[]=[];
 for(let py=0;py<4;py++)for(let px=0;px<4;px++)for(let k=0;k<40;k++){
  const fy=Math.pow(rnd(),.7);dots.push({x:px*64+5+rnd()*54,y:py*64+5+fy*54,r:.55+rnd()*.6,lit:rnd()<.66});
 }
 const make=(lit:boolean)=>{
  const c=document.createElement('canvas');c.width=256;c.height=256;const g=c.getContext('2d')!;
  g.fillStyle=lit?'#000':'#f4efe4';g.fillRect(0,0,256,256);
  if(!lit){
   // Each panel a touch warmer or cooler, so the skin reads as many pieces.
   for(let py=0;py<4;py++)for(let px=0;px<4;px++){g.fillStyle=`rgba(${rnd()<.5?'214,204,186':'236,232,224'},${.25+rnd()*.25})`;g.fillRect(px*64,py*64,64,64);}
   g.fillStyle='rgba(150,138,116,.75)';for(let k=0;k<4;k++){g.fillRect(k*64,0,2,256);g.fillRect(0,k*64,256,2);}
  }
  for(const d of dots){if(lit&&!d.lit)continue;g.fillStyle=lit?'#ffcf8a':'rgba(128,118,100,.32)';g.beginPath();g.arc(d.x,d.y,lit?d.r*1.2:d.r,0,Math.PI*2);g.fill();}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
 };
 return {map:make(false),glow:make(true)};
}
