import {planStreetLights} from './streetLighting';
import {airportFootprint} from './airport';
import {TERRACE_H,type Scene3D,type Tree} from './scene';

/**
 * Palm boulevards (Khaneil, 2026-11-13). The first pass lined every street, walk and the airport road
 * and read as a jungle; Khaneil asked for a luxury metropolitan look instead. So only the city's
 * streets get palms, as a formal avenue: one species (a tall fan palm, all the same height and
 * upright), on both sidewalks, at the lamp spacing and halfway between the lamps, so palm and lamp
 * alternate in an even rhythm. Walks, plaza rings, the highway and the airport grounds stay bare.
 * Spots use the street lamp planner, so palms stay off carriageways, sidewalks, junctions and buildings.
 */
export const STREET_PALMS={spacing:3.6,start:3,setbacks:[.55,.8,1.1],lampClear:.6,airportMargin:2,max:260,size:.26} as const;

export function planStreetPalms(s:Scene3D):Tree[]{
 const lamps=planStreetLights(s),avoidBoxes=[];
 if(s.airport){const a=airportFootprint(s.airport),m=STREET_PALMS.airportMargin;avoidBoxes.push({x:a.x+a.w/2,z:a.z+a.d/2,w:a.w+2*m,d:a.d+2*m});}
 const spots=planStreetLights(s,{streetsOnly:true,spacing:STREET_PALMS.spacing,start:STREET_PALMS.start,bothSides:true,setbacks:STREET_PALMS.setbacks,skipHighway:true,minSeparation:1.5,max:STREET_PALMS.max,avoid:lamps,avoidRadius:STREET_PALMS.lampClear,avoidBoxes});
 return spots.map(p=>({x:p.x,y:TERRACE_H,z:p.z,s:STREET_PALMS.size,kind:'avenue' as const}));
}

/** Lawn trees standing in an avenue's row give way to it, so the rhythm is never broken. */
export function clearForAvenues(trees:Tree[],palms:Tree[],r:number=STREET_PALMS.lampClear):Tree[]{
 const cells=new Map<string,Tree[]>();for(const p of palms){const k=`${Math.floor(p.x)}:${Math.floor(p.z)}`;cells.set(k,[...(cells.get(k)??[]),p]);}
 return trees.filter(t=>{if(t.kind==='palm')return true;for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(cells.get(`${Math.floor(t.x)+dx}:${Math.floor(t.z)+dz}`)?.some(p=>Math.hypot(p.x-t.x,p.z-t.z)<r))return false;return true;});
}
