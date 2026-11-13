import {useMemo} from 'react';
import {gardenParts,type Garden} from './gardenPlan';
import {LAND_TOP} from './scene';
import {Instanced,type useGeometries,type useMaterials} from './models';
/** Topiary gardens: five shared instanced meshes for every garden. No frame callbacks, lights or textures. */
export default function Gardens({gardens,g,m}:{gardens?:Garden[];g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>}){
 const parts=useMemo(()=>gardenParts(gardens??[],LAND_TOP),[gardens]);
 if(!gardens?.length)return null;
 return <group name="topiary-gardens">
  <Instanced items={parts.boxes} geometry={g.box} material={m.plain}/>
  <Instanced items={parts.balls} geometry={g.ball} material={m.plain}/>
  <Instanced items={parts.cones} geometry={g.cone} material={m.plain}/>
  <Instanced items={parts.cyls} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.beads} geometry={g.bead} material={m.plain} shadow={false}/>
 </group>;
}
