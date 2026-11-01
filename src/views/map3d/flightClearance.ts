import type {Scene3D} from './scene';
import {headquartersEnvelope} from './financialPlan';
import {financialDimensions} from './financialArchitecture';
import {AIRPORT_BUILDINGS} from './airportBuildings';
import {AIRPORT_LAYOUT,type AirportPlan,type FlightCircuit} from './airport';
import {toolOfficeHeight} from './toolBrand';
import {DEALERSHIP} from './dealershipPlan';
import {COMMUNITY_BUILDINGS} from './hillsCommunityPlan';
import {HILLS} from './hillsPlan';

export const FLIGHT_CLEARANCE={roofGap:4,minimumCruise:14,aircraftRadius:1.95} as const;
/** Conservative roof envelope, including crowns and the new Financial District skyline.
 * Computed once per scene, not by testing every building on every animation frame. */
export function flightClearance(scene:Pick<Scene3D,'towers'|'financial'|'strays'|'houses'|'kiosks'|'retail'>){
 const roof=Math.max(8,headquartersEnvelope(scene.towers),DEALERSHIP.height+.7,HILLS.mansion.h+1,...COMMUNITY_BUILDINGS.map(b=>b.h+1),...scene.strays.map(b=>b.height+1),...scene.houses.map(b=>b.h+b.roofH+.6),...[...scene.kiosks,...scene.retail].map(b=>toolOfficeHeight(b.name)+1),...AIRPORT_BUILDINGS.map(b=>b.h+1),...(scene.financial?.buildings.map(b=>b.height+financialDimensions(b.id).top)??[]));
 return {roof,altitude:Math.max(FLIGHT_CLEARANCE.minimumCruise,roof+FLIGHT_CLEARANCE.roofGap)};
}
/** Airport-local circuit, accounting for the renderer's west-facing mirror. */
export function airportFlightCircuit(a:AirportPlan,b:Scene3D['bounds'],altitude?:number):FlightCircuit{
 const centerX=(b.x0+b.x1)/2;
 return {x:(a.west?2*a.x+AIRPORT_LAYOUT.mirrorWidth-centerX:centerX)-(a.x+15),z:(b.z0+b.z1)/2-a.z-6.1,rx:(b.x1-b.x0)/2+2,rz:(b.z1-b.z0)/2+2,altitude};
}
/** Existing private-jet orbit, with the same scene-derived roof clearance. */
export function privateJetPose(b:Scene3D['bounds'],altitude:number,seconds:number){
 const cx=(b.x0+b.x1)/2,cz=(b.z0+b.z1)/2,rx=(b.x1-b.x0)/2+3,rz=(b.z1-b.z0)/2+3,t=seconds*.085;
 return {x:cx+Math.cos(t)*rx,y:altitude+Math.sin(t*2)*.2,z:cz+Math.sin(t)*rz,yaw:Math.atan2(-Math.cos(t)*rz,-Math.sin(t)*rx),roll:Math.sin(t)*.035};
}
/** Leave room below the airship gondola and balloon baskets, above the aircraft corridor. */
export const decorativeAerialHeights=(altitude:number)=>({airship:altitude+3,balloons:altitude+7});
