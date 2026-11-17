import * as THREE from 'three';
import {HQ_PALETTE as P} from './atlasHqPalette';

/**
 * Atlas Command Center facade textures, drawn once on canvases (Khaneil's concept, 2026-11-17).
 * One tile is 4 window columns by 4 storeys, laid on by skin(): cream stone piers and floor
 * slabs framing recessed windows with dark green frames, green sky reflection over warm,
 * gold-lit offices. The glow map lights the offices (softly by day, fully at night).
 */
function canvasTexture(draw:(g:CanvasRenderingContext2D)=>void){
 const c=document.createElement('canvas');c.width=256;c.height=256;draw(c.getContext('2d')!);
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
 // skin() runs v upward; unflipped, row 0 of the canvas is the bottom of a storey.
 t.flipY=false;return t;
}
const FRAME='#2c4a3b';

/** Office floors: stone grid with punched windows. Row y counts from the floor upward. */
export function ccFacadeTexture(seed=17){
 let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
 const lit=Array.from({length:16},()=>.55+rnd()*.45);
 // Window inside one 64 px cell: a stone sill/slab below, a thin stone head above.
 const W={x:5,y:15,w:54,h:46};
 const map=canvasTexture(g=>{
  g.fillStyle=P.stone;g.fillRect(0,0,256,256);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++){
   const x=c*64+W.x,y=r*64+W.y,b=lit[r*4+c];
   // Shadowed reveal round the opening, so it reads recessed.
   g.fillStyle='rgba(120,100,70,.35)';g.fillRect(x-3,y-2,W.w+6,W.h+5);
   const gr=g.createLinearGradient(0,y,0,y+W.h);
   // Canvas rows run up the storey: warm offices low in the pane, green sky reflection above.
   gr.addColorStop(0,`rgba(${Math.round(215+30*b)},${Math.round(178+30*b)},${Math.round(105+25*b)},1)`);
   gr.addColorStop(.4,'#9aac82');gr.addColorStop(1,'#3f6f58');
   g.fillStyle=gr;g.fillRect(x,y,W.w,W.h);
   g.fillStyle=FRAME;
   g.fillRect(x,y,W.w,3);g.fillRect(x,y+W.h-3,W.w,3);g.fillRect(x,y,3,W.h);g.fillRect(x+W.w-3,y,3,W.h);
   g.fillRect(x+W.w/3-1,y,2,W.h);g.fillRect(x+2*W.w/3-1,y,2,W.h);g.fillRect(x,y+W.h-12,W.w,2);
  }
  // A darker line at each slab's lower edge, under the projecting stone ledge.
  g.fillStyle='rgba(140,120,90,.4)';for(let r=0;r<4;r++)g.fillRect(0,r*64+12,256,2);
 });
 const glow=canvasTexture(g=>{
  g.fillStyle='#000';g.fillRect(0,0,256,256);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++){
   const x=c*64+W.x,y=r*64+W.y,b=lit[r*4+c];
   g.fillStyle=`rgba(255,${Math.round(190+40*b)},${Math.round(110+40*b)},${b})`;g.fillRect(x+3,y+3,W.w-6,W.h*.55);
  }
 });
 return {map,glow};
}

/** The lobby: tall gold-lit glass in brass frames over a stone sill, one pane per column. */
export function ccLobbyTexture(){
 const pane=(g:CanvasRenderingContext2D,x:number,y:number)=>{
  const gr=g.createLinearGradient(0,y,0,y+58);gr.addColorStop(0,'#f6dc9c');gr.addColorStop(1,'#e2b867');
  g.fillStyle=gr;g.fillRect(x,y,64,58);
 };
 const map=canvasTexture(g=>{
  for(let r=0;r<4;r++){
   const y=r*64;g.fillStyle=P.stone;g.fillRect(0,y,256,64);
   for(let c=0;c<4;c++)pane(g,c*64,y+5);
   g.fillStyle=P.brass;
   for(let c=0;c<4;c++){g.fillRect(c*64,y+5,4,58);g.fillRect(c*64+31,y+5,2,58);}
   g.fillRect(0,y+46,256,3);g.fillRect(0,y+60,256,4);
  }
 });
 const glow=canvasTexture(g=>{
  g.fillStyle='#000';g.fillRect(0,0,256,256);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++){g.fillStyle='#ffd88f';g.fillRect(c*64+5,r*64+8,58,36);}
 });
 return {map,glow};
}

/** The bay's lettering: a gold Atlas mark over "Atlas / Command / Center" in dark green serif. */
export function ccNameplate(){
 const c=document.createElement('canvas');c.width=512;c.height=640;const g=c.getContext('2d')!;
 // The Atlas mark: four rising gold bars.
 const gold=g.createLinearGradient(0,40,0,210);gold.addColorStop(0,'#e3c27a');gold.addColorStop(1,'#a87f3c');
 g.fillStyle=gold;
 for(let i=0;i<4;i++){const h=60+i*36;g.fillRect(170+i*46,210-h,32,h);}
 g.fillStyle='#2b3f33';g.textAlign='center';g.textBaseline='middle';
 g.font='600 132px Georgia, "Times New Roman", serif';g.fillText('Atlas',256,320,490);
 g.font='600 100px Georgia, "Times New Roman", serif';g.fillText('Command',256,450,500);g.fillText('Center',256,560,500);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
