import type {Agent} from '../../catalog/types';
import {workplaceAgent} from '../../catalog/workplaces';
import {AGENCY_ROOMS,type AgencyRoom} from './agencyInteriorPlan';

export const AGENCY_BUILDING='Benjaire Marketing Agency';

/** The agent whose manifest seats it in this Agency room, if any. Placement comes from the catalog. */
export function agencyAssignedAgent(room:Pick<AgencyRoom,'id'|'level'>,agents:Agent[]){
 return room.level>=1?workplaceAgent(agents,AGENCY_BUILDING,room.level,room.id):undefined;
}
export const agencyRoom=(id:string)=>AGENCY_ROOMS.find(r=>r.id===id);

export interface AgencySeat{x:number;z:number;/** Yaw so the figure faces its desk or table. */yaw:number;desk:{x:number;z:number;w:number;d:number}|null}
/**
 * Where an assigned agent sits in its room, next to the furniture `furnish` already draws, so a
 * seat never needs its own table except in rooms without one. Pure; interior units.
 */
export function agencySeat(room:AgencyRoom):AgencySeat{
 const {x,z,w,d}=room,cx=x+w/2,cz=z+d/2;
 switch(room.kind){
  // Head of the meeting table, facing along it.
  case 'meeting':{const tw=Math.min(w-2,4.2);return {x:cx-tw/2-.5,z:cz,yaw:-Math.PI/2,desk:null};}
  // First desk of the grid (furnish: grid(2,3,1.4)), on its chair.
  case 'desk':return {x:x+1.4,z:z+1.4+.75,yaw:0,desk:null};
  // First lab desk (grid(2,2,1.8)), facing the data wall on the north side.
  case 'lab':return {x:x+1.8,z:z+1.8+.7,yaw:0,desk:null};
  // Reading table near the south end of the archive.
  case 'archive':return {x:cx,z:z+d-1.4+.85,yaw:0,desk:null};
  // Anywhere else: a small desk of its own in the room's middle.
  default:return {x:cx,z:cz+.7,yaw:0,desk:{x:cx,z:cz,w:1.6,d:.8}};
 }
}
