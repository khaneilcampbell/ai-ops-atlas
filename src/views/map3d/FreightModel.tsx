import {highwayLightPositions} from "./highwayDetails";
import {MODELS,SCALE} from "./vehicleModels";
import {useMemo,useRef} from "react";
import {useFrame} from "@react-three/fiber";
import type {Group} from "three";
import {Instanced,type Inst,type useGeometries,type useMaterials} from "./models";
import {TERRACE_H} from "./scene";
import {vehicleAt} from "./vehicles";
import type {FreightPlan} from "./freight";
import {freightParts} from "./freightParts";
export function Freight({plan,g,m,moving,visible=true}:{plan?:FreightPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;moving:boolean;visible?:boolean}){
 const ref=useRef<Group>(null),clock=useRef(0);
 const lightPositions=useMemo(()=>plan?highwayLightPositions(plan.highway,[...plan.exits,...plan.localJunctions]):[],[plan]);
 const parts=useMemo(()=>plan?freightParts(plan,lightPositions):[],[plan,lightPositions]);
 // Paint-thin markings cast no visible shadow; leaving them out of the shadow pass halves their cost.
 const [solid,flat]=useMemo(()=>[parts.filter(p=>p.s[1]>.02),parts.filter(p=>p.s[1]<=.02)],[parts]);
 const lights=useMemo<Inst[]>(()=>lightPositions.map(p=>({p:[p[0],TERRACE_H+.96,p[1]],s:[.07,.045,.07]})),[lightPositions]);
 const truck=useMemo<Inst[]>(()=>MODELS.semi.parts.map(p=>({p:p.at.map(v=>v*SCALE) as [number,number,number],s:p.size.map(v=>v*SCALE) as [number,number,number],c:p.color??'#294237'})),[]);
 useFrame((_,dt)=>{if(!plan||!ref.current)return;if(moving)clock.current+=Math.min(dt,.1);const p=vehicleAt(plan.truck,clock.current);ref.current.position.set(p.x,TERRACE_H+.03+p.y,p.z);ref.current.rotation.y=Math.atan2(-p.dz,p.dx);});
 if(!plan)return null;
 return <><group name="atlas-road-infrastructure"><Instanced items={solid} geometry={g.box} material={m.plain}/><Instanced items={flat} geometry={g.box} material={m.plain} shadow={false}/><Instanced items={lights} geometry={g.ball} material={m.lamp}/></group><group name="atlas-freight-truck" ref={ref} visible={visible} position={[plan.lot.x,TERRACE_H+.11,plan.lot.z]}><Instanced items={truck} geometry={g.box} material={m.plain}/></group></>;
}
