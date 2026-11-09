import {useMemo} from 'react';
import {Instanced,type Inst,type useGeometries,type useMaterials} from './models';
import {TERRACE_H} from './scene';
import type {StationPlaza as Plan} from './stationPlazaPlan';

/** Station and stadium palette, so the pavilion reads as part of one centre with both. */
const C={podium:'#d9d9d4',steel:'#f2f2ef',glass:'#a9cfd2',shell:'#e2dccd',rib:'#f4f2ec',gold:'#c9a35a'};
/** Rotation about x that lays a box's local z along the direction (dz, dy), as in parkStationPlan. */
const tilt=(dz:number,dy:number)=>Math.atan2(-dy,dz);

/**
 * Stadium Station pavilion: the stadium's white podium, glass wall and white steel, under a small
 * copy of the station's vaulted shell with white ribs and gold end ribs. The entrance faces the plaza walk.
 */
export function StationPlaza({plan,g,m,night}:{plan?:Plan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;night:boolean}){
 const parts=useMemo(()=>{
  const solid:Inst[]=[],lights:Inst[]=[];if(!plan)return {solid,lights};
  const a=plan.building,cx=a.x+a.w/2,cz=a.z+a.d/2,y0=TERRACE_H;
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string,rx=0)=>solid.push({p:[x,y0+y,z],s:[w,h,d],c,rx});
  // Podium and a glass hall set back from its edge, with white mullions and a gold entrance canopy.
  const podium=.22,hallH=1.05,hw=a.w-.5,hd=a.d-.7;
  box(cx,podium/2,cz,a.w,podium,a.d,C.podium);
  // The glass hall is drawn with the night lights so its windows glow warm after dark.
  lights.push({p:[cx,y0+podium+hallH/2,cz],s:[hw,hallH,hd],c:C.glass});
  for(const side of [-1,1])for(let x=-hw/2;x<=hw/2+.001;x+=hw/12)box(cx+x,podium+hallH/2,cz+side*(hd/2+.015),.035,hallH,.03,C.steel);
  for(const side of [-1,1])box(cx+side*(hw/2+.015),podium+hallH/2,cz,.03,hallH,hd,C.steel);
  box(cx,podium+.82,cz+hd/2+.2,1.1,.05,.42,C.gold);
  box(cx,podium/2,cz+a.d/2+.12,1.1,podium*.6,.24,C.podium);
  // Vaulted shell over the hall, sprung from white columns at the podium edge.
  const across=a.d/2-.1,up=.62,maxA=72*Math.PI/180,slats=15,step=2*maxA/(slats-1),spring=podium+hallH+.05,cy=spring-up*Math.cos(maxA);
  const at=(t:number):[number,number]=>[cz+across*Math.sin(t),cy+up*Math.cos(t)];
  for(let i=0;i<slats;i++){const t=-maxA+i*step,[pz,py]=at(t),[qz,qy]=at(t+step/2),[oz,oy]=at(t-step/2);box(cx,py,pz,a.w-.2,.05,Math.hypot(qz-oz,qy-oy)+.06,C.shell,tilt(qz-oz,qy-oy));}
  // A solid ceiling closes the hall under the vault, so the lit glass never shows through the roof.
  box(cx,podium+hallH+.02,cz,hw+.04,.04,hd+.04,C.shell);
  const ribs=[-1,-.5,0,.5,1].map(k=>k*(a.w/2-.15));
  for(const rx of ribs){
   const end=Math.abs(rx)>a.w/2-.2,c=end?C.gold:C.rib;
   for(let i=0;i<slats;i++){const t=-maxA+i*step,[pz,py]=at(t),[qz,qy]=at(t+step/2),[oz,oy]=at(t-step/2);box(cx+rx,py+Math.cos(t)*.05,pz+Math.sin(t)*.05,.08,.06,Math.hypot(qz-oz,qy-oy)+.03,c,tilt(qz-oz,qy-oy));}
   for(const t of [-maxA,maxA]){const [pz,py]=at(t);box(cx+rx,(podium+py)/2,pz,.07,py-podium,.07,C.steel);}
  }
  // Warm strip lights along the base of the glass.
  for(const side of [-1,1])lights.push({p:[cx,y0+podium+.06,cz+side*(hd/2+.03)],s:[hw,.03,.02],c:'#e8b76f'});
  return {solid,lights};
 },[plan]);
 if(!plan)return null;
 return <group name='stadium-station-plaza'><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.lights} geometry={g.box} material={night?m.lamp:m.plain}/></group>;
}
