import {DEALERSHIP_KEY} from './dealershipPlan';
import {financialKey} from './financialPlan';
import type {Scene3D} from './scene';

/**
 * Business Operations HQ and its Vendor & Supplier Hub annex in the Financial District's east corner
 * (Khaneil, 2026-11-24). The model is built in Blender from
 * assets/business-operations-hq/build_business_operations_hq.py and shipped as
 * public/models/map/business-operations-hq.glb; the numbers below match that script.
 */
export const BOH_KEY='service:business-operations-hq';
export const BOH_ID='business-operations-hq';
export const BOH_NAME='Business Operations HQ';
export const SUPPLIER_HUB_KEY='service:supplier-hub';
export const SUPPLIER_HUB_ID='supplier-hub';
export const SUPPLIER_HUB_NAME='Vendor & Supplier Hub';

/**
 * The map objects that stood on the corner plot. Only their map models are left out of what the map
 * draws: their records, modules, agents, data and ids are unchanged, and the buildings that house their
 * modules (workspace.yaml `merged`) still list them. Budget & Forecasting and Governance & Compliance
 * now sit inside the HQ as floors; Security & Infrastructure stays with the Security & Infrastructure
 * Center.
 */
export const CLEARED_FOR_BOH:readonly string[]=[financialKey('budget'),financialKey('records'),DEALERSHIP_KEY];

/** Model dimensions in map units (build_business_operations_hq.py). */
export const BOH_MODEL={
 podium:{w:9.6,d:6,h:2.1},
 tower:{w:6,d:4.2,back:.5,top:8.4},
 crown:8.4+.9,
 forecourt:3.1,
 annex:{dx:9.7,dz:1.2,w:3.4,d:3.2,h:1.72},
 walkway:{y:.7,h:.72},
} as const;

/** The HQ's floors, ground up: what each one holds. */
export const BOH_FLOORS=[
 {floor:'Lobby',label:'Lobby and atrium',summary:'Double-height lobby under the gold canopy, opening into the full-height glass atrium.'},
 {floor:'1',label:'Business operations',summary:'The Business Operations HQ module: clients, operations and the business tab.'},
 {floor:'2',label:'Budget & Forecasting',summary:'Budget vs actual and cash forecast datasets (finance.yaml), moved in from the Budget & Forecasting Center.'},
 {floor:'3',label:'Governance & Compliance',summary:'The Identity & Governance module and its records, moved in from the Governance & Compliance Center.'},
 {floor:'Roof',label:'Roof terrace',summary:'Planted terrace with a gold pergola.'},
] as const;

export interface BusinessHqPlan {
 /** Centre of the HQ footprint (podium), map units. */
 x:number;z:number;
 annex:{x:number;z:number};
}

/** Where the HQ stands: the corner plot east of the Investment Operations Center, on the Financial District street. */
export function planBusinessHq(scene:Pick<Scene3D,'dealership'>):BusinessHqPlan|undefined{
 const lot=scene.dealership?.lot;if(!lot)return undefined;
 const x=lot.x-1.75,z=lot.z+5.5;
 return {x,z,annex:{x:x+BOH_MODEL.annex.dx,z:z+BOH_MODEL.annex.dz}};
}

/** Footprints a click or the camera frames: the HQ with its forecourt, and the annex with its walkway. */
export function businessHqFootprints(p:BusinessHqPlan){
 const {podium,annex,forecourt,crown}=BOH_MODEL;
 return {
  hq:{x:p.x,z:p.z+forecourt/2,w:podium.w,d:podium.d+forecourt,y1:crown},
  annex:{x:p.annex.x,z:p.annex.z,w:annex.w,d:annex.d,y1:annex.h},
 };
}

/** The covered walkway between the HQ podium and the annex. */
function walkway(p:BusinessHqPlan){const x0=p.x+BOH_MODEL.podium.w/2,x1=p.annex.x-BOH_MODEL.annex.w/2;return {x:(x0+x1)/2,z:p.annex.z,w:x1-x0,d:.9};}

/**
 * The scene as drawn: the cleared corner objects left out and the HQ added. The planned scene is not
 * changed, so streets, rail, traffic and every planner keep the same ground.
 */
export function presentBusinessHq<S extends Scene3D>(scene:S):S{
 const hq=planBusinessHq(scene);if(!hq)return scene;
 const gone=new Set(CLEARED_FOR_BOH);
 // Trees and shrubs planted on the cleared plot would stand inside the HQ or its forecourt.
 const f=businessHqFootprints(hq),inside=(p:{x:number;z:number})=>[f.hq,f.annex,walkway(hq)].some(r=>Math.abs(p.x-r.x)<r.w/2+.35&&Math.abs(p.z-r.z)<r.d/2+.35);
 const fd=scene.financial,financial=fd&&{...fd,buildings:fd.buildings.filter(b=>!gone.has(financialKey(b.id))),perimeterTrees:fd.perimeterTrees.filter(([x,z])=>!inside({x:fd.x+x,z:fd.z+z}))};
 return {...scene,...(financial?{financial}:{}),dealership:gone.has(DEALERSHIP_KEY)?undefined:scene.dealership,businessHq:hq,
  trees:scene.trees.filter(t=>!inside(t)),bushes:scene.bushes.filter(b=>!inside(b))};
}
