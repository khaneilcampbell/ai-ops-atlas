import {planStreetLights} from './streetLighting';
import {TERRACE_H,type Scene3D,type Tree} from './scene';

/**
 * Palm-lined streets (Khaneil, 2026-11-13, a Los Angeles street photo): fan and date palms on both
 * sidewalks of every city street, set back the same way as the street lamps so they stay off the
 * carriageway, sidewalk, walks, junctions and buildings, and kept clear of the lamps themselves.
 * The highway stays bare. They stand on the one ground plane, like the lamps (StreetLights.tsx). Which palm grows at each spot is decided by laPlanting.ts.
 */
export const STREET_PALMS={spacing:1.8,start:.3,setbacks:[.55,.8],lampClear:.45,max:700,size:.26} as const;

export function planStreetPalms(s:Scene3D):Tree[]{
 const lamps=planStreetLights(s);
 const trees=[...s.trees];
 const spots=planStreetLights(s,{spacing:STREET_PALMS.spacing,start:STREET_PALMS.start,bothSides:true,setbacks:STREET_PALMS.setbacks,skipHighway:true,minSeparation:1,max:STREET_PALMS.max,avoid:[...lamps,...trees],avoidRadius:STREET_PALMS.lampClear});
 // Street palms are always palms: an alternating rhythm of tall fan palms with a date palm every third spot.
 return spots.map((p,i)=>({x:p.x,y:TERRACE_H,z:p.z,s:STREET_PALMS.size,kind:i%3===2?'date' as const:'fan' as const}));
}

