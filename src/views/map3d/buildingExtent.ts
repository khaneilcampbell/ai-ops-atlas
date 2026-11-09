import type {Box3} from './githubTowerPlan';
import type {Rect,Scene3D} from './scene';

/** A footprint by its centre, the way the map's selection anchors store it. */
export interface Footprint {x:number;z:number;w:number;d:number}

const toRect=(f:Footprint):Rect=>({x:f.x-f.w/2,z:f.z-f.d/2,w:f.w,d:f.d});
const toFootprint=(r:Rect):Footprint=>({x:r.x+r.w/2,z:r.z+r.d/2,w:r.w,d:r.d});

/** The smallest rectangle around every rectangle given. */
export function unionRect(rs:Rect[]):Rect|undefined{
 if(!rs.length)return undefined;
 const x0=Math.min(...rs.map(r=>r.x)),z0=Math.min(...rs.map(r=>r.z));
 const x1=Math.max(...rs.map(r=>r.x+r.w)),z1=Math.max(...rs.map(r=>r.z+r.d));
 return {x:x0,z:z0,w:x1-x0,d:z1-z0};
}

/**
 * One project, one district: every terrace carrying the project's id, as one rectangle. The
 * GitHub tower's podium adds a second terrace with Profile Tower's id beside the first
 * (githubAnnex.ts), so taking only the first one lit half of the district (KC, 2026-11-09:
 * "that entire building is a part of one district").
 */
export function districtRect(scene:Pick<Scene3D,'terraces'>,id:string):Rect|undefined{
 return unionRect(scene.terraces.filter(t=>t.id===id));
}

/**
 * The whole of a building that one click selects, when it spreads past its tower's lot. Today
 * that is the GitHub tower (Profile Tower): its glass podium and skybridge stand across the ring
 * road and pick the tower, so the outline and the camera must take them in too.
 */
export function wholeBuilding(tower:Footprint,parts:Box3[]):Footprint{
 return toFootprint(unionRect([toRect(tower),...parts.map(p=>({x:p.x0,z:p.z0,w:p.x1-p.x0,d:p.z1-p.z0}))])!);
}
