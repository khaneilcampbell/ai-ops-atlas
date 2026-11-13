import {AIRCRAFT_LAYOUT,AIRPORT_LAYOUT,BOARDING_LAYOUT,boardingBridge,type FlightCircuit} from './airport';
import {ARRIVAL_GATES,arrivalGate,arrivalLegs} from './airportArrivals';
import {FLIGHT_SCHEDULE,fleetPose,flightPhase,loopTiming,SHARED_SLOT} from './flightSchedule';
import type {Livery} from './airlineLiveries';
import {GOLD_JET_PASSENGERS} from './goldJetIds';

/**
 * The gold private jet (Khaneil, 2026-11-13: "add a private jet that is bigger and gold in the airport loop and I'm
 * able to enter to see people on flight after boarding from the terminal and see the fly route when inside the plane").
 * It takes over one of the loop's airliner slots, so traffic stays the same: it flies the same closed loop, lands, parks
 * nose-in at the terminal's third gate under the jet bridge, lets its passengers off, boards the next group, pushes back and flies again.
 *
 * Decorative only: the flight, its route and its passengers are a visual simulation. No agent, workflow or live data.
 */
export {GOLD_JET_ID,GOLD_JET_KEY,GOLD_JET_NAME,GOLD_JET_OFFICE_ID,GOLD_JET_PASSENGERS} from './goldJetIds';
/** Slot 2: an even slot, so it parks at arrival gate 0 (the terminal's third jet bridge). Never the shared slot. */
export const GOLD_JET_SLOT=2;
export const GOLD_JET_GATE=ARRIVAL_GATES[arrivalGate(GOLD_JET_SLOT)];
/** Drawn this much larger than the airliners, scaled about the forward door so the door still meets the jet bridge. */
export const GOLD_JET_SCALE=1.18;
/** The scale's fixed point in aircraft-local coordinates: the forward door, at ground level. */
export const GOLD_JET_PIVOT:[number,number,number]=[AIRCRAFT_LAYOUT.doorX,0,AIRCRAFT_LAYOUT.doorZ];

/** Half span and the nose/tail reach of the scaled jet, in aircraft-local x and z. */
export const GOLD_JET_EXTENT={
 left:AIRCRAFT_LAYOUT.doorX+(-AIRCRAFT_LAYOUT.halfSpan-AIRCRAFT_LAYOUT.doorX)*GOLD_JET_SCALE,
 right:AIRCRAFT_LAYOUT.doorX+(AIRCRAFT_LAYOUT.halfSpan-AIRCRAFT_LAYOUT.doorX)*GOLD_JET_SCALE,
 nose:AIRCRAFT_LAYOUT.doorZ+(-AIRCRAFT_LAYOUT.halfLength-AIRCRAFT_LAYOUT.doorZ)*GOLD_JET_SCALE,
 tail:AIRCRAFT_LAYOUT.doorZ+(AIRCRAFT_LAYOUT.halfLength-AIRCRAFT_LAYOUT.doorZ)*GOLD_JET_SCALE,
} as const;
/** Largest distance from the jet's pose point to any part of it, seen from above. */
export const GOLD_JET_HALF_SPAN=Math.max(-GOLD_JET_EXTENT.left,GOLD_JET_EXTENT.right);

/**
 * Polished gold nose and forward fuselage fading to white toward a white tail (from Khaneil's reference), with gold
 * engines. The fade is drawn by GOLD_JET_FADE sleeves over the white tube. No crest, logo or name on the tail.
 */
export const GOLD_JET_LIVERY:Livery={id:'atlas-gold',name:'Atlas Gold',fuselage:'#f6f2e7',belly:'#efe7d2',cockpit:'#1c1a17',engine:'#d4a63d',intake:'#2a2620',wing:'#e9e3d3',tail:'#f6f2e7',tailLow:'#d4a63d',tailHigh:'#e2c98a',winglet:'#d4a63d',windows:'#2a2620'};
/** Gold sleeves over the fuselage from the nose back, darkest and shortest on the outside: a stepped gold-to-white fade.
 * `to` is the sleeve's aft end in aircraft-local z (the tube starts at the nose, -0.95). */
export const GOLD_JET_FADE=[
 {to:.6,c:'#f1e3b6'},
 {to:.25,c:'#e9cf82'},
 {to:-.1,c:'#e0b95a'},
 {to:-.45,c:'#d4a63d'},
] as const;

export type GoldJetStage='hold'|'taxi'|'takeoff'|'flight'|'approach'|'landing'|'taxi-in'|'deplaning'|'boarding'|'pushback';
export interface GoldJetState {stage:GoldJetStage;label:string;/** Passengers on board now. */aboard:number;/** 0..1 through the stand, while parked. */standU:number;}
const LABELS:Record<GoldJetStage,string>={hold:'Holding short of runway 1',taxi:'Taxiing to runway 1',takeoff:'Taking off',flight:'Circling the city',approach:'Descending to land',landing:'Landing on the landing runway',"taxi-in":'Taxiing to the terminal',deplaning:'At the gate · Passengers leaving',boarding:'At the gate · Boarding from the terminal',pushback:'Pushing back from the gate'};
/** Seconds after release that count as the takeoff roll and climb-out, before the circuit. */
const TAKEOFF_SECONDS=14;

/** Where the jet is in its loop at `seconds` on the airport clock, and how many of its passengers are on board. */
export function goldJetState(seconds:number,circuit?:FlightCircuit):GoldJetState{
 const f=FLIGHT_SCHEDULE,phase=flightPhase(seconds,GOLD_JET_SLOT),{leave,approach,dwell}=loopTiming(circuit),legs=arrivalLegs(approach);
 const s=(stage:GoldJetStage,aboard=GOLD_JET_PASSENGERS,standU=0):GoldJetState=>({stage,label:LABELS[stage],aboard,standU});
 if(phase<f.taxi)return s('taxi');
 if(phase<f.taxi+TAKEOFF_SECONDS)return s('takeoff');
 if(phase<leave)return s('flight');
 let r=phase-leave;
 if(r<legs.approach)return s('approach');r-=legs.approach;
 if(r<legs.final)return s('landing');r-=legs.final;
 if(r<legs.rollout)return s('taxi-in');r-=legs.rollout;
 if(r<dwell){
  // First half: the arriving passengers walk off; second half: the next group walks on, one by one.
  const u=r/dwell,n=GOLD_JET_PASSENGERS;
  return u<.5?s('deplaning',n-Math.min(n,Math.floor(boardedBy(u*2))),u):s('boarding',Math.min(n,Math.floor(boardedBy((u-.5)*2))),u);
 }
 r-=dwell;
 if(r<legs.push+legs.pause)return s('pushback');
 return phase<f.cycle-loopTiming(circuit).hold?s('taxi'):s('hold');
}
/** Walkers leave one after another: walker k starts at k*GAP of the half-stand and takes WALK of it. */
const GAP=.12,WALK=.3;
/** How many walkers have finished by `u` (0..1) of a half-stand. */
function boardedBy(u:number){let n=0;for(let k=0;k<GOLD_JET_PASSENGERS;k++)if(u>=k*GAP+WALK)n++;return n;}

/** The jet bridge walk at its gate, in airport-local coordinates: pier door to the cab, then into the forward door. */
export function goldJetBridgeWalk():[number,number][]{
 const b=boardingBridge(GOLD_JET_GATE.z);
 return [[BOARDING_LAYOUT.fromX+.05,b.z],[b.endX-.22,b.z],[b.endX-.22,b.door.z+.25],[b.door.x+.02,b.door.z+.05]];
}
const walkLength=(w:[number,number][])=>w.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-w[i][0],p[1]-w[i][1]),0);
/** Positions of the walkers on the jet bridge while the jet stands at the gate (empty otherwise). Boarding walks pier to
 * door, deplaning door to pier. */
export function goldJetWalkers(state:GoldJetState):{x:number;z:number;yaw:number}[]{
 if(state.stage!=='boarding'&&state.stage!=='deplaning')return [];
 const w=goldJetBridgeWalk(),total=walkLength(w),half=state.stage==='boarding'?(state.standU-.5)*2:state.standU*2,out:{x:number;z:number;yaw:number}[]=[];
 for(let k=0;k<GOLD_JET_PASSENGERS;k++){
  const u=(half-k*GAP)/WALK;if(u<0||u>1)continue;
  let d=(state.stage==='boarding'?u:1-u)*total;
  for(let i=1;i<w.length;i++){const a=w[i-1],b=w[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d<=l||i===w.length-1){const t=Math.min(1,d/l),dir=state.stage==='boarding'?1:-1;out.push({x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,yaw:Math.atan2((b[0]-a[0])*dir,(b[1]-a[1])*dir)});break;}d-=l;}
 }
 return out;
}

/** The whole loop as the in-flight map draws it: airport-local points sampled every `step` seconds, flagged airborne. */
export function goldJetRoute(circuit?:FlightCircuit,step=.5){
 const pts:{x:number;z:number;y:number}[]=[];
 for(let t=0;t<FLIGHT_SCHEDULE.cycle;t+=step){const p=fleetPose(t,GOLD_JET_SLOT,circuit);pts.push({x:p.x,z:p.z,y:p.y});}
 return pts;
}
/** Sanity: the gold jet never takes the shared slot (which alternates the executive jet and an airliner). */
export const GOLD_JET_SLOT_OK=GOLD_JET_SLOT!==SHARED_SLOT&&GOLD_JET_SLOT<FLIGHT_SCHEDULE.count&&AIRPORT_LAYOUT.gateZ.includes(GOLD_JET_GATE.z as never);

/**
 * The airport clock and circuit as the map last saw them, so the interior can pick the flight up where the map left it.
 * Written by the map's Airport frame loop; read once when you enter the aircraft.
 */
export const goldJetLive:{clock:number;circuit?:FlightCircuit;west?:boolean}={clock:0};
