import {useEffect,useMemo} from 'react';
import * as THREE from 'three';
import {FINANCIAL_BRANDS,FINANCIAL_SIGN,financialSignPlacement,type FinancialBrand} from './financialBrands';
import {financialDimensions,financialSignLevel} from './financialArchitecture';
import {financialKey,type FinancialPlan} from './financialPlan';
import {TERRACE_H} from './scene';
import type {PickHandlerSet} from './models';
/**
 * An original drawn logo: a rounded badge holding an open ring (the brand's initial) with three
 * rising bars in its opening, for steady growth. Plain shapes only, no lettering or borrowed marks.
 */
export function drawEmblem(c:CanvasRenderingContext2D,brand:Pick<FinancialBrand,'accent'|'signText'|'logoInk'>,x:number,y:number,size:number){
 const ink=brand.logoInk??brand.signText,cx=x+size/2,cy=y+size/2,r=size*.31;
 c.save();c.fillStyle=brand.accent;c.strokeStyle=ink;c.lineWidth=size*.03;c.beginPath();c.roundRect(x,y,size,size,size*.18);c.fill();c.stroke();
 c.strokeStyle=brand.signText;c.lineWidth=size*.085;c.lineCap='round';c.beginPath();c.arc(cx,cy,r,Math.PI*.24,Math.PI*1.76);c.stroke();
 c.fillStyle=ink;const bar=size*.07;for(const [i,h]of [[0,.16],[1,.26],[2,.38]] as const){const bx=cx+size*(.02+i*.1),bh=size*h;c.beginPath();c.roundRect(bx,cy+size*.17-bh,bar,bh,bar*.3);c.fill();}
 c.restore();
}
/** Original canvas signs follow Atlas's existing procedural sign texture pattern. */
function sign(brand:FinancialBrand){
 const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=384;const c=canvas.getContext('2d')!;
 c.fillStyle=brand.signBackground;c.fillRect(0,0,1536,384);c.fillStyle=brand.accent;c.fillRect(0,366,1536,18);
 if(brand.symbol==='emblem'){
  drawEmblem(c,brand,40,40,304);
  c.fillStyle=brand.signText;c.textAlign='left';c.textBaseline='alphabetic';c.letterSpacing='14px';c.font='600 150px sans-serif';c.fillText(brand.signLines[0].toUpperCase(),400,205,1090);
  c.letterSpacing='22px';c.font='500 78px sans-serif';c.fillStyle=brand.logoInk??brand.signText;c.fillText((brand.signLines[1]??'').toUpperCase(),404,316,1090);c.letterSpacing='0px';
 }else{
 c.fillStyle=brand.signText;c.textBaseline='middle';c.textAlign=brand.symbol==='wordmark'?'center':'left';
 if(brand.symbol==='wordmark'&&brand.signLines.length>1){c.font='600 139px sans-serif';c.fillText(brand.signLines[0],768,128,1420);c.font='500 112px sans-serif';c.fillText(brand.signLines[1],768,274,1420);}
 else {const centered=brand.symbol==='wordmark';c.font='600 185px sans-serif';c.fillText(brand.name,centered?768:350,198,centered?1420:1140);}
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const material=new THREE.MeshStandardMaterial({map:texture,emissiveMap:texture,emissive:'#ffffff',emissiveIntensity:0,roughness:.6});
 return {brand,texture,material,geometry:new THREE.PlaneGeometry(FINANCIAL_SIGN.width,FINANCIAL_SIGN.height)};
}
export function FinancialSigns({plan,night,pick}:{plan?:FinancialPlan;night:boolean;pick:PickHandlerSet}){
 const signs=useMemo(()=>FINANCIAL_BRANDS.filter(b=>!b.noSign).map(sign),[]);
 useEffect(()=>{for(const s of signs)s.material.emissiveIntensity=night?.35:0},[night,signs]);
 useEffect(()=>()=>{for(const s of signs){s.material.dispose();s.geometry.dispose();s.texture.dispose()}},[signs]);
 if(!plan)return null;
 return <>{signs.map(s=>{const b=plan.buildings.find(b=>b.id===s.brand.id);if(!b)return null;const size=financialDimensions(b.id),p=financialSignPlacement(financialSignLevel(b.id,b.height),size.depth,size.width),key=financialKey(b.id),handler=pick.of([key]);return [0,1].map(side=><mesh key={`${key}:${side}`} geometry={s.geometry} material={s.material} position={[plan.x+b.x+(side?p.frontX:0),TERRACE_H+(p.bottom+p.top)/2,plan.z+b.z+(side?0:p.frontZ)]} rotation={[0,side?Math.PI/2:0,0]} onPointerOver={e=>{e.stopPropagation();handler.over(key,e)}} onPointerOut={handler.out} onClick={e=>{e.stopPropagation();handler.click(key,e)}}/>);})}</>;
}
