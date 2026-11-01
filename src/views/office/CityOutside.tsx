import {financialInteriorBrand} from "../map3d/financialBrands";
import {HILLS} from "../map3d/hillsPlan";
import {AIRPORT_BUILDINGS} from "../map3d/airportBuildings";
import {airportPoint} from "../map3d/airport";
import {clearInteriorFootprint} from "./exteriorClearance";
import {useMemo} from "react";
import {useAtlas} from "../../state";
import {useReducedMotion} from "../../lib/motion";
import {load} from "../../lib/storage";
import {layoutMap,type GroupBy} from "../mapLayout";
import {buildScene,TERRACE_H} from "../map3d/scene";
import {Traffic,Vehicles} from "../map3d/living";
import {Terrain,Landscape,Towers,Bridges,Kiosks,useGeometries,useMaterials,type PickHandlerSet} from "../map3d/models";
export default function CityOutside({building="",projectId,span=16,elevation=0,allFloors=false,anchorAt,extras}:{building?:string;projectId?:string;span?:number;elevation?:number;allFloors?:boolean;
  /** A map position to centre on, for buildings that are not towers or shops. */
  anchorAt?:(scene:ReturnType<typeof buildScene>)=>{x:number;z:number}|undefined;
  /** Extra map pieces drawn in the same frame as the city, such as a building's own plaza. */
  extras?:(c:{scene:ReturnType<typeof buildScene>;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>})=>import("react").ReactNode}) {
  const reduced=useReducedMotion();
  const traffic=load<boolean>("mapTraffic",true);
  const {catalog,uncataloged}=useAtlas();
  const grouping=load<GroupBy>("mapProjectGrouping","district");
  const source=useMemo(()=>buildScene(layoutMap(catalog,uncataloged,grouping)),[catalog,uncataloged,grouping]);
  const g=useGeometries(),m=useMaterials();
  const park=source.parks.find(p=>p.label==="Skyline");
  const pick=useMemo<PickHandlerSet>(()=>({of:keys=>({keys,over:()=>{},out:()=>{},click:()=>{}})}),[]);
  const airportBuilding=AIRPORT_BUILDINGS.find(b=>b.name===building);
  const airportAnchor=airportBuilding&&source.airport?{x:airportPoint(source.airport,airportBuilding.x,airportBuilding.z)[0],z:source.airport.z+airportBuilding.z}:undefined;
  const hillsAnchor=building==="Atlas Hills"&&source.hills?{x:source.hills.x+HILLS.mansion.x,z:source.hills.z+HILLS.mansion.z}:undefined;
  const financialBuilding=source.financial?.buildings.find(b=>b.id===financialInteriorBrand(building)?.id);
  const financialAnchor=financialBuilding&&source.financial?{x:source.financial.x+financialBuilding.x,z:source.financial.z+financialBuilding.z}:undefined;
  const mallAnchor=building==="Atlas Marketplace"&&source.mall?{x:source.mall.cx,z:source.mall.cz}:undefined;
  const anchor=mallAnchor??anchorAt?.(source)??financialAnchor??hillsAnchor??airportAnchor??(projectId?source.towers.find(t=>t.projectId===projectId):[...source.retail,...source.kiosks].find(k=>k.name===building));
  // The mall interior is drawn to its map footprint, so the city around it lines up with the lot.
  const scale=mallAnchor&&source.mall?span/(source.mall.rx*2):Math.max(4,span/4),cx=anchor?.x??(park?park.x+park.w/2:0),cz=anchor?.z??(park?park.z+park.d/2:0);
  const scene=useMemo(()=>clearInteriorFootprint(source,cx,cz,(span/2+2)/scale),[source,cx,cz,span,scale]);
  const visible=(p:{x:number;z:number})=>!allFloors||p.x<cx||p.z<cz||Math.hypot(p.x-cx,p.z-cz)>span/scale+5;
  if(!park&&!anchor)return null;
  return <group scale={scale} position={[-cx*scale,-TERRACE_H*scale-0.35-elevation,-cz*scale]}>
    <Traffic scene={scene} g={g} m={m} moving={!reduced}/>{traffic&&<Vehicles scene={scene} g={g} m={m} moving={!reduced}/>}
    <Terrain scene={scene} g={g} m={m} onTerrace={pick.of([])}/><Bridges scene={scene} g={g} m={m}/><Landscape scene={scene} g={g} m={m}/><Towers towers={scene.towers.filter(t=>t.projectId!==projectId&&visible(t))} strays={scene.strays.filter(visible)} health={new Map()} g={g} m={m} pick={pick}/><Kiosks kiosks={[...scene.kiosks,...scene.retail].filter(k=>k.name!==building&&visible(k))} g={g} m={m} pick={pick}/>{extras?.({scene,g,m})}
  </group>;
}
