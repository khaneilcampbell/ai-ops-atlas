import {planStreetLights} from './streetLighting';
import {AIRPORT_LANDING_RUNWAY,AIRPORT_LAYOUT,airportFootprint,type AirportPlan} from './airport';
import {AIRPORT_BUILDINGS} from './airportBuildings';
import {laTreeKind} from './laPlanting';
import {TERRACE_H,type Rect,type Scene3D,type Tree} from './scene';

/**
 * Palm boulevards (Khaneil, 2026-11-13). The first pass lined every street, walk and the airport road
 * and read as a jungle; Khaneil asked for a luxury metropolitan look instead. So only the city's
 * streets get palms, as a formal avenue: one species (a tall fan palm, all the same height and
 * upright), on both sidewalks, at the lamp spacing and halfway between the lamps, so palm and lamp
 * alternate in an even rhythm. Walks, plaza rings, the highway and the airport grounds stay bare.
 * Spots use the street lamp planner, so palms stay off carriageways, sidewalks, junctions and buildings.
 * Every palm stands on planted grass (Khaneil, 2026-11-13): past the walk that runs flush beside a street
 * (centre .6 from the street's centre line, .48 wide), so the setbacks start beyond it.
 */
export const STREET_PALMS={spacing:3.6,start:3,setbacks:[.8,1.05,1.3],walkClear:.55,streetClear:1.05,lampClear:.6,airportMargin:2,max:260,size:.26,litEvery:3} as const;

/**
 * Where palms belong (Khaneil, 2026-11-13: "still excessive ... keep them mostly in the places in the screenshots"):
 * the boulevard beside the Atlas Galleria, the Team Events Arena, and the airport's front road. Street avenues are
 * planted only inside these zones, and lawn palms outside them grow as olives and ficus instead. The Financial Park
 * keeps its own palms (financialParkPlanting), so the Financial District needs no zone here.
 */
export const PALM_ZONES={galleria:7,stadium:5,airport:6} as const;
export function palmZones(s:Pick<Scene3D,'galleria'|'stadium'|'airport'>):Rect[]{
 const grow=(r:Rect,m:number)=>({x:r.x-m,z:r.z-m,w:r.w+2*m,d:r.d+2*m}),out:Rect[]=[];
 if(s.galleria)out.push(grow(s.galleria.footprint,PALM_ZONES.galleria));
 if(s.stadium)out.push(grow(s.stadium,PALM_ZONES.stadium));
 if(s.airport)out.push(grow(airportFootprint(s.airport),PALM_ZONES.airport));
 return out;
}
export const inPalmZone=(zones:Rect[],x:number,z:number)=>zones.some(r=>x>=r.x&&x<=r.x+r.w&&z>=r.z&&z<=r.z+r.d);

export function planStreetPalms(s:Scene3D):Tree[]{
 const lamps=planStreetLights(s),avoidBoxes=[];
 if(s.airport){const a=airportFootprint(s.airport),m=STREET_PALMS.airportMargin;avoidBoxes.push({x:a.x+a.w/2,z:a.z+a.d/2,w:a.w+2*m,d:a.d+2*m});}
 const spots=planStreetLights(s,{streetsOnly:true,spacing:STREET_PALMS.spacing,start:STREET_PALMS.start,bothSides:true,setbacks:STREET_PALMS.setbacks,skipHighway:true,minSeparation:1.5,max:STREET_PALMS.max,avoid:lamps,avoidRadius:STREET_PALMS.lampClear,avoidBoxes,walkClear:STREET_PALMS.walkClear,streetClear:STREET_PALMS.streetClear,extraWalks:s.financial?[s.financial.walk,...s.financial.buildings.map(b=>b.approach)].filter(w=>w.length>1):[]});
 const zones=palmZones(s),kept=spots.filter(p=>inPalmZone(zones,p.x,p.z));
 // One avenue palm in every three wears string lights, an even rhythm along each street rather than all of them.
 return kept.map((p,i)=>({x:p.x,y:TERRACE_H,z:p.z,s:STREET_PALMS.size,kind:'avenue' as const,lit:i%STREET_PALMS.litEvery===0}));
}

/** Campus-local x of the palm row in front of the terminal: on the lawn just behind the public road's sidewalk (Khaneil, 2026-11-13). */
export const AIRPORT_SIDEWALK_X=-.15;

/**
 * The palm row on the lawn in front of the terminal, behind the public sidewalk (Khaneil, 2026-11-13: "have them
 * match the other ones"). Same spots as before (one every 2.8, clear of buildings, the drop-off and the landing
 * lanes), now grown as the city's avenue palm. The campus is drawn mirrored when it faces west, so local x flips.
 */
export function airportSidewalkPalms(a:AirportPlan):Tree[]{
 const x=AIRPORT_SIDEWALK_X,out:Tree[]=[];
 for(let z=-11;z<25;z+=2.8){
  if(AIRPORT_BUILDINGS.some(b=>Math.abs(x-b.x)<b.w/2+.5&&Math.abs(z-b.z)<b.d/2+.5)||(z>-8.5&&z<-4.3)||[AIRPORT_LANDING_RUNWAY.laneZ,AIRPORT_LANDING_RUNWAY.southLaneZ].some(lz=>Math.abs(z-lz)<1.8))continue;
  // The terminal's front door: every palm wears string lights.
  out.push({x:a.west?a.x+AIRPORT_LAYOUT.mirrorWidth-x:a.x+x,y:TERRACE_H,z:a.z+z,s:STREET_PALMS.size,kind:'avenue',lit:true});
 }
 return out;
}

/** Lawn palms (date and fan) outside the palm zones grow as olives and ficus, so palms gather where Khaneil wants them. */
export function calmLawnPalms(trees:Tree[],zones:Rect[]):Tree[]{
 return trees.map(t=>{const k=laTreeKind(t);if((k!=='date'&&k!=='fan')||t.la||inPalmZone(zones,t.x,t.z))return t;return {...t,la:(Math.floor(Math.abs(t.x*7.3+t.z*3.1))%2?'olive':'ficus')};});
}

/** Lawn trees standing in an avenue's row give way to it, so the rhythm is never broken. */
export function clearForAvenues(trees:Tree[],palms:Tree[],r:number=STREET_PALMS.lampClear):Tree[]{
 const cells=new Map<string,Tree[]>();for(const p of palms){const k=`${Math.floor(p.x)}:${Math.floor(p.z)}`;cells.set(k,[...(cells.get(k)??[]),p]);}
 return trees.filter(t=>{if(t.kind==='palm')return true;for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(cells.get(`${Math.floor(t.x)+dx}:${Math.floor(t.z)+dz}`)?.some(p=>Math.hypot(p.x-t.x,p.z-t.z)<r))return false;return true;});
}
