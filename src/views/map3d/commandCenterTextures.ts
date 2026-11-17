import * as THREE from 'three';
import {HQ_PALETTE as P} from './atlasHqPalette';

/**
 * Atlas Command Center window textures, drawn once on canvases (Khaneil's concept, 2026-11-17).
 * The Blender model carries the stone, slabs and mullions as geometry; these only paint what is
 * seen through the glass. glTF UVs run downward, so row 0 of a canvas is the top of a storey.
 * The glow map lights the offices (softly by day, fully at night).
 */
function canvasTexture(draw:(g:CanvasRenderingContext2D)=>void,size=256){
 const c=document.createElement('canvas');c.width=size;c.height=size;draw(c.getContext('2d')!);
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
 t.flipY=false;return t;
}

/**
 * Office glass: one tile is 8 panes by 4 storeys (the model's UVs), as in the concept: a band of
 * green sky reflection at the head of each pane, then bright warm-lit offices with a ceiling
 * light, desks with screens and people at them, varied pane by pane. Panes are tall and narrow on
 * the building, so things are drawn squat here and stretch upright on the glass.
 */
export function ccGlassTexture(seed=17){
 let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
 const W=64,H=128,lit=Array.from({length:32},()=>.6+rnd()*.4),seats=Array.from({length:32},()=>rnd());
 const map=canvasTexture(g=>{
  for(let r=0;r<4;r++)for(let c=0;c<8;c++){
   const x=c*W,y=r*H,b=lit[r*8+c],seat=seats[r*8+c];
   // Sky reflection over the head of the pane.
   const sky=g.createLinearGradient(0,y,0,y+H*.22);sky.addColorStop(0,'#2f5a48');sky.addColorStop(1,'#6f9a80');
   g.fillStyle=sky;g.fillRect(x,y,W,H*.22);
   // The room: warm light, brighter near the ceiling.
   const room=g.createLinearGradient(0,y+H*.22,0,y+H);
   room.addColorStop(0,`rgb(255,${Math.round(214+30*b)},${Math.round(140+40*b)})`);
   room.addColorStop(.55,`rgb(${Math.round(240+15*b)},${Math.round(182+30*b)},${Math.round(98+30*b)})`);
   room.addColorStop(1,`rgb(${Math.round(196+30*b)},${Math.round(136+25*b)},${Math.round(70+20*b)})`);
   g.fillStyle=room;g.fillRect(x,y+H*.22,W,H*.78);
   // Ceiling light.
   g.fillStyle='rgba(255,250,225,.95)';g.fillRect(x+8,y+H*.25,W-16,4);
   // Back wall shelving or a plant, every other pane.
   if(seat<.5){g.fillStyle='rgba(110,75,40,.7)';g.fillRect(x+6,y+H*.38,W*.35,H*.2);}
   else{g.fillStyle='#3f6e3a';g.beginPath();g.ellipse(x+W*.78,y+H*.6,7,9,0,0,Math.PI*2);g.fill();}
   // A person at a desk with a screen.
   const px=x+W*(.3+.4*seat);
   g.fillStyle='#2b231d';g.beginPath();g.ellipse(px,y+H*.66,5,5,0,0,Math.PI*2);g.fill();
   g.fillStyle=seat<.5?'#2f5a48':'#7a3f3a';g.fillRect(px-7,y+H*.7,14,H*.1);
   g.fillStyle='#3a3a3a';g.fillRect(px+8,y+H*.68,12,8);
   g.fillStyle='rgba(200,230,255,.9)';g.fillRect(px+9,y+H*.68+1,10,5);
   g.fillStyle='#5a3d22';g.fillRect(x+4,y+H*.79,W-8,6);
   g.fillStyle='rgba(80,55,35,.6)';g.fillRect(x+8,y+H*.79+5,3,H*.12);g.fillRect(x+W-11,y+H*.79+5,3,H*.12);
  }
 },512);
 const glow=canvasTexture(g=>{
  g.fillStyle='#000';g.fillRect(0,0,512,512);
  for(let r=0;r<4;r++)for(let c=0;c<8;c++){
   const b=lit[r*8+c],x=c*W,y=r*H,gr=g.createLinearGradient(0,y+H*.22,0,y+H);
   gr.addColorStop(0,`rgba(255,${Math.round(225+30*b)},${Math.round(160+40*b)},1)`);gr.addColorStop(1,`rgba(255,${Math.round(190+30*b)},${Math.round(110+40*b)},${.55*b})`);
   g.fillStyle=gr;g.fillRect(x,y+H*.22,W,H*.78);
  }
 },512);
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
