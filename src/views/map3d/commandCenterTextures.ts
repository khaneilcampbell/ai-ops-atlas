import * as THREE from 'three';
import {HQ_PALETTE as P} from './atlasHqPalette';

/**
 * Atlas Command Center window textures, drawn once on canvases (Khaneil's concept, 2026-11-17).
 * The Blender model carries the stone, slabs and mullions as geometry; these only paint what is
 * seen through the glass. glTF UVs run downward, so row 0 of a canvas is the top of a storey.
 * The glow map lights the offices (softly by day, fully at night).
 */
function canvasTexture(draw:(g:CanvasRenderingContext2D)=>void){
 const c=document.createElement('canvas');c.width=256;c.height=256;draw(c.getContext('2d')!);
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
 t.flipY=false;return t;
}

/**
 * Office glass: one tile is 8 panes by 4 storeys (the model's UVs). Green sky reflection across
 * the top of each pane, warm-lit offices below with a darker band of desks, varied pane by pane.
 */
export function ccGlassTexture(seed=17){
 let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
 const lit=Array.from({length:32},()=>.5+rnd()*.5);
 const map=canvasTexture(g=>{
  for(let r=0;r<4;r++)for(let c=0;c<8;c++){
   const x=c*32,y=r*64,b=lit[r*8+c];
   const gr=g.createLinearGradient(0,y,0,y+64);
   gr.addColorStop(0,'#2f5a48');gr.addColorStop(.28,'#5f8c74');
   gr.addColorStop(.36,`rgb(${Math.round(226+24*b)},${Math.round(176+30*b)},${Math.round(92+30*b)})`);
   gr.addColorStop(1,`rgb(${Math.round(190+30*b)},${Math.round(132+30*b)},${Math.round(70+20*b)})`);
   g.fillStyle=gr;g.fillRect(x,y,32,64);
   // Desks and people: a soft darker band low in the room.
   g.fillStyle='rgba(90,70,45,.35)';g.fillRect(x+3,y+44,26,8);
   // A slim transom where the sky reflection ends.
   g.fillStyle='rgba(44,74,59,.8)';g.fillRect(x,y+18,32,2);
  }
 });
 const glow=canvasTexture(g=>{
  g.fillStyle='#000';g.fillRect(0,0,256,256);
  for(let r=0;r<4;r++)for(let c=0;c<8;c++){const b=lit[r*8+c];g.fillStyle=`rgba(255,${Math.round(200+40*b)},${Math.round(120+40*b)},${b})`;g.fillRect(c*32+2,r*64+22,28,38);}
 });
 return {map,glow};
}

/** The lobby: tall gold-lit glass, four panes per tile, one tile the lobby's height. */
export function ccLobbyTexture(){
 const map=canvasTexture(g=>{
  for(let c=0;c<4;c++){
   const x=c*64,gr=g.createLinearGradient(0,0,0,256);
   gr.addColorStop(0,'#f8e2a8');gr.addColorStop(.7,'#f0cd85');gr.addColorStop(1,'#d9ad62');
   g.fillStyle=gr;g.fillRect(x,0,64,256);
   g.fillStyle='rgba(120,90,50,.25)';g.fillRect(x+6,200,52,30);
  }
  g.fillStyle=P.brass;g.fillRect(0,52,256,4);g.fillRect(0,246,256,10);
 });
 const glow=canvasTexture(g=>{g.fillStyle='#000';g.fillRect(0,0,256,256);g.fillStyle='#ffd88f';g.fillRect(0,60,256,180);});
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
