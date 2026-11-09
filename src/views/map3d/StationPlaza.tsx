import {useMemo} from 'react';
import {Instanced,type Inst,type useGeometries,type useMaterials} from './models';
import {TERRACE_H} from './scene';
import type {StationPlaza as Plan} from './stationPlazaPlan';
/** Original compact station pavilion: ivory fins, red glass wings and an open central entrance. */
export function StationPlaza({plan,g,m,night}:{plan?:Plan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;night:boolean}){
 const parts=useMemo(()=>{
  const solid:Inst[]=[],glass:Inst[]=[],lights:Inst[]=[];if(!plan)return {solid,glass,lights};
  const a=plan.building,cx=a.x+a.w/2,cz=a.z+a.d/2;
  const box=(list:Inst[],x:number,y:number,z:number,w:number,h:number,d:number,c:string,r=0)=>list.push({p:[x,TERRACE_H+y,z],s:[w,h,d],c,r});
  box(solid,cx,.08,cz,a.w+.25,.16,a.d+.25,'#ded8c8');
  for(const side of [-1,1]){
   const x=cx+side*1.14;
   box(solid,x,1.05,cz,1.45,1.95,2.4,'#eeeade');
   box(glass,x,1.1,cz+1.22,1.4,1.65,.04,'#a34c46');
   box(solid,x,2.1,cz,1.58,.16,2.65,'#f2eee4',side*.08);
   for(let i=0;i<6;i++)box(solid,x-.62+i*.25,1.15,cz+1.26,.035,1.9,.08,'#ece8dc');
   box(lights,x,.55,cz+1.28,1.42,.035,.025,'#e8b76f');
  }
  box(solid,cx,1.9,cz, .85,.15,2.4,'#b4483e');
  box(solid,cx,.02,cz+1.25,.8,.025,1.1,'#294c40');
  for(let i=0;i<3;i++)box(solid,cx,.025+i*.025,cz+1.55-i*.15,1.05,.05,.2,'#ded8c8');
  for(const side of [-1,1])box(solid,cx+side*.9,.26,cz+2.25,.9,.5,.3,'#294c40');
  return {solid,glass,lights};
 },[plan]);
 if(!plan)return null;
 return <group name='stadium-station-plaza'><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.glass} geometry={g.box} material={m.glass}/><Instanced items={parts.lights} geometry={g.box} material={night?m.lamp:m.plain}/></group>;
}
