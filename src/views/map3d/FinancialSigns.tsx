import {BENJAIRE_MONOGRAM,BENJAIRE_WORDMARK} from './benjaireIdentity';
import {useEffect,useMemo} from 'react';
import * as THREE from 'three';
import {FINANCIAL_BRANDS,FINANCIAL_SIGN,financialSignPlacement,type FinancialBrand} from './financialBrands';
import {financialDimensions,financialSignLevel} from './financialArchitecture';
import {financialKey,type FinancialPlan} from './financialPlan';
import {TERRACE_H} from './scene';
import type {PickHandlerSet} from './models';
/** Original canvas signs follow Atlas's existing procedural sign texture pattern. */
function sign(brand:FinancialBrand){
 const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=384;const c=canvas.getContext('2d')!;
 c.fillStyle=brand.signBackground;c.fillRect(0,0,1536,384);c.fillStyle=brand.accent;c.fillRect(0,366,1536,18);
 if(brand.symbol==='octagon'){
  c.fillStyle=brand.accent;c.beginPath();for(let i=0;i<8;i++){const angle=Math.PI/8+i*Math.PI/4,x=190+120*Math.cos(angle),y=185+120*Math.sin(angle);if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.closePath();c.fill();c.fillStyle=brand.signBackground;c.fillRect(143,138,94,94);
 }else if(brand.symbol==='feather'){
  c.fillStyle=brand.accent;c.beginPath();c.moveTo(85,290);c.bezierCurveTo(80,140,190,58,299,59);c.bezierCurveTo(300,179,229,253,125,268);c.closePath();c.fill();c.strokeStyle=brand.signBackground;c.lineWidth=12;c.beginPath();c.moveTo(93,302);c.lineTo(252,105);c.stroke();
 }
 if(brand.symbol==='benjaire'){
  c.save();c.translate(52,56);c.scale(.42,.42);const ink=c.createLinearGradient(0,0,583,608);for(const [at,color]of [[0,'#18191c'],[.3,'#34373c'],[.52,'#6e737a'],[.74,'#34373c'],[1,'#18191c']] as const)ink.addColorStop(at,color);c.fillStyle=ink;c.fill(new Path2D(BENJAIRE_MONOGRAM));c.restore();
  c.save();c.translate(355,70);c.strokeStyle=brand.signText;c.lineWidth=18;c.lineJoin='round';c.stroke(new Path2D(BENJAIRE_WORDMARK));c.restore();
  c.fillStyle=brand.signText;c.font='500 94px sans-serif';c.textAlign='center';c.fillText('FINANCE',895,305,1080);
 }else{
 c.fillStyle=brand.signText;c.textBaseline='middle';c.textAlign=brand.symbol==='wordmark'?'center':'left';
 if(brand.symbol==='wordmark'&&brand.signLines.length>1){c.font='600 139px sans-serif';c.fillText(brand.signLines[0],768,128,1420);c.font='500 112px sans-serif';c.fillText(brand.signLines[1],768,274,1420);}
 else {const centered=brand.symbol==='wordmark';c.font=`600 ${brand.symbol==='feather'?172:185}px sans-serif`;c.fillText(brand.name,centered?768:350,198,centered?1420:1140);}
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
