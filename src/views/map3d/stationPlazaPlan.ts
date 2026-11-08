import type {Rect,Scene3D} from './scene';
export const PLAZA_WHEEL={width:4.1,depth:1.5} as const;
export interface StationPlaza {wheel:{x:number;z:number};building:Rect;bounds:Rect;walk:[number,number][];entranceWalk:[number,number][]}
/** The open meadow east of the stadium, inside its existing perimeter stop. No rail or airport relocation. */
export function planStationPlaza(s:Pick<Scene3D,'stadium'|'communityRail'>):StationPlaza|undefined {
 const stadium=s.stadium,stop=s.communityRail?.loop?.stops.find(s=>s.id==='service:stadium-station');
 if(!stadium||!stop)return;
 const x=stadium.x+stadium.w+5.8,z=stadium.z+3.2;
 const ground=[...stop.walk].reverse().find(p=>p[1]===0);if(!ground)return;
 return {wheel:{x,z},building:{x:x-1.9,z:z+5.3,w:3.8,d:2.8},bounds:{x:x-2.25,z:z-1.05,w:4.5,d:9.5},walk:[[x,z+.8],[x,z+4.3],[ground[0],z+4.3],[ground[0],ground[2]]],entranceWalk:[[ground[0],ground[2]],[ground[0],z+8.6],[x,z+8.6],[x,z+8.15]]};
}
