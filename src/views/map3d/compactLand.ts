import type {Rect} from './scene';
import {cityEnvelope} from './citySpacing';
import {squareCityBounds} from './cityPerimeter';
import {uncoveredLand} from './neighborhoodLinks';

/** Fill outer parcels once, preserving the original city's intentional canal grid. */
export function compactSquareLand(land:Rect[],core:Rect[]):Rect[]{
 const e=cityEnvelope(land);if(!e)return [];
 const b=squareCityBounds({left:e.x,right:e.x+e.w,top:e.z,bottom:e.z+e.d});
 const square={x:b.left,z:b.top,w:b.right-b.left,d:b.bottom-b.top};
 const city=cityEnvelope(core);
 // Existing core water gaps remain canals; new outer meadow meets parcels edge to edge.
 const outer=city?land.filter(r=>r.x<city.x||r.z<city.z||r.x+r.w>city.x+city.w||r.z+r.d>city.z+city.d):land;
 return uncoveredLand(square,[...(city?[city]:[]),...outer]).map(r=>({...r,w:r.w-1e-8,d:r.d-1e-8}));
}
