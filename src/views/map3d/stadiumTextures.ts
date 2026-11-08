import * as THREE from 'three';

/**
 * Atlas Stadium's roof sheeting: dark grey-blue standing seams running across the short span, eave to eave, with a
 * faint lighter ridge on each seam and a slight variation between sheets. Drawn on a canvas: no
 * images, no downloads, no animation.
 */
export function stadiumRoofTexture(seed=7){
 let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
 const c=document.createElement('canvas');c.width=128;c.height=128;const g=c.getContext('2d')!;
 g.fillStyle='#3b4652';g.fillRect(0,0,128,128);
 const sheets=8,step=128/sheets;
 for(let k=0;k<sheets;k++){
  g.fillStyle=`rgba(${rnd()<.5?'70,82,96':'52,62,74'},${.25+rnd()*.3})`;g.fillRect(k*step,0,step,128);
  g.fillStyle='rgba(150,166,182,.55)';g.fillRect(k*step,0,1.5,128);
  g.fillStyle='rgba(20,26,32,.45)';g.fillRect(k*step+1.5,0,1,128);
 }
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
